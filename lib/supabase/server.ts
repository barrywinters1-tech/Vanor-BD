import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export function isConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export async function serverClient() {
  if (!isConfigured()) throw new Error('Supabase is not configured.');
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server components cannot write cookies. The Next proxy refreshes them.
          }
        },
      },
    },
  );
}

/** Describes a key's shape without revealing it, so errors can say which variable is wrong. */
export function keyShape(key: string) {
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  const parts = key.split('.');
  if (parts.length === 3) {
    try { return 'jwt:' + (JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role || 'unknown'); } catch { /* fall through */ }
  }
  return `unrecognised (${key.length} chars)`;
}

const KEY_VARS = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'Key001'] as const;

/** Picks the first configured variable holding a server key; falls back to the first non-empty one. */
export function serviceKey() {
  const found = KEY_VARS.map(name => ({ name, key: (process.env[name] || '').replace(/\s+/g, '') })).filter(k => k.key);
  const good = found.find(k => ['secret', 'jwt:service_role'].includes(keyShape(k.key))) || found[0];
  return good ? { ...good, shape: keyShape(good.key), checked: found.map(k => `${k.name}=${keyShape(k.key)}`).join(', ') } : null;
}

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const picked = serviceKey();
  if (!url || !picked) throw new Error('Server database credentials are not configured.');
  return createClient(url, picked.key, { auth: { persistSession: false, autoRefreshToken: false } });
}
