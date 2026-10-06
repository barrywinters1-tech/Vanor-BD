// One-time migration of a full V5 backup into an EMPTY workspace (service role). Shared by the import routes.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { tenantId } from './bd-store';
import { serviceClient } from './supabase/server';

export const OLD_APP = 'https://vanor-bd.vanor-adviso-7300.chatgpt.site';
const TICKET_KEY = 'import_ticket';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export function parseBackup(raw: Buffer) {
  const backup = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8'));
  if (backup?.schemaVersion !== 5 || !Array.isArray(backup.records) || !Array.isArray(backup.work) || !backup.decisions)
    throw Object.assign(new Error('Not a Vanor V5 full backup.'), { status: 400 });
  return backup;
}

export async function workspaceIsEmpty(tenant: string) {
  const { data, error } = await serviceClient().from('entities').select('id').eq('tenant_id', tenant).limit(1);
  if (error) throw new Error(error.message);
  return !data?.length;
}

/** Issue a single-use ticket (10 minutes) that lets the old app post its backup once. Caller must be an admin. */
export async function issueTicket(tenant: string) {
  if (!(await workspaceIsEmpty(tenant))) throw Object.assign(new Error('Workspace already has data.'), { status: 409 });
  const ticket = randomBytes(24).toString('base64url');
  const { error } = await serviceClient().from('workspace_metadata').upsert({ tenant_id: tenant, key: TICKET_KEY,
    payload: { hash: hash(ticket), expiresAt: new Date(Date.now() + 10 * 60000).toISOString() } }, { onConflict: 'tenant_id,key' });
  if (error) throw new Error(error.message);
  return ticket;
}

/** Validate and consume a ticket. */
export async function redeemTicket(ticket: string) {
  const tenant = await tenantId();
  const db = serviceClient();
  const { data } = await db.from('workspace_metadata').select('payload').eq('tenant_id', tenant).eq('key', TICKET_KEY).maybeSingle();
  const stored = data?.payload as { hash?: string; expiresAt?: string } | undefined;
  if (!stored?.hash || !stored.expiresAt || Date.parse(stored.expiresAt) < Date.now()) return null;
  const a = Buffer.from(stored.hash), b = Buffer.from(hash(ticket));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await db.from('workspace_metadata').delete().eq('tenant_id', tenant).eq('key', TICKET_KEY);
  return tenant;
}

export async function importBackup(backup: any, tenant: string, importedFrom: string) {
  if (!(await workspaceIsEmpty(tenant))) throw Object.assign(new Error('Workspace already has data; import refused.'), { status: 409 });
  const db = serviceClient();
  const now = new Date().toISOString();
  const strip = (v: Record<string, unknown>) => { const c = { ...v }; delete c._rev; return c; };
  const groups: [string, Record<string, any>[]][] = [
    ['source', backup.records], ['decision', Object.values(backup.decisions)], ['work', backup.work],
    ['event', backup.events || []], ['planned_event', backup.plannedEvents || []],
  ];
  const counts: Record<string, number> = {};
  for (const [scope, values] of groups) {
    const rows = values.filter(v => v && typeof v.id === 'string').map(v => ({
      tenant_id: tenant, scope, id: v.id, payload: strip(v), revision: Number(v._rev) > 0 ? Number(v._rev) : 1, updated_at: now,
    }));
    for (let i = 0; i < rows.length; i += 250) {
      const { error } = await db.from('entities').upsert(rows.slice(i, i + 250), { onConflict: 'tenant_id,scope,id' });
      if (error) throw new Error(`${scope}: ${error.message}`);
    }
    counts[scope] = rows.length;
  }
  const { error } = await db.from('workspace_metadata').upsert({ tenant_id: tenant, key: 'source',
    payload: { ...(backup.meta || {}), importedAt: now, importedFrom } }, { onConflict: 'tenant_id,key' });
  if (error) throw new Error(error.message);
  return counts;
}
