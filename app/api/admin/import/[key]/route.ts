// One-time migration: the old ChatGPT-hosted app posts its full backup here (gzip JSON).
// Only works while the workspace is empty, only from the old app's origin, and only with VANOR_MCP_KEY.
import { gunzipSync } from 'node:zlib';
import { timingSafeEqual } from 'node:crypto';
import { tenantId } from '../../../../../lib/bd-store';
import { serviceClient } from '../../../../../lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OLD_APP = 'https://vanor-bd.vanor-adviso-7300.chatgpt.site';
const cors = { 'Access-Control-Allow-Origin': OLD_APP, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

function authorised(key: string) {
  const expected = process.env.VANOR_MCP_KEY || '';
  const a = Buffer.from(key), b = Buffer.from(expected);
  return expected.length >= 24 && a.length === b.length && timingSafeEqual(a, b);
}

export function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  if (!authorised((await context.params).key)) return reply({ error: 'Not found.' }, 404);
  try {
    const raw = Buffer.from(await request.arrayBuffer());
    const backup = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8'));
    if (backup?.schemaVersion !== 5 || !Array.isArray(backup.records) || !Array.isArray(backup.work) || !backup.decisions)
      return reply({ error: 'Not a Vanor V5 full backup.' }, 400);
    const db = serviceClient();
    const tenant = await tenantId();
    const { data: existing, error: lookupError } = await db.from('entities').select('id').eq('tenant_id', tenant).limit(1);
    if (lookupError) throw new Error(lookupError.message);
    if (existing?.length) return reply({ error: 'Workspace already has data; import refused.' }, 409);
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
      payload: { ...(backup.meta || {}), importedAt: now, importedFrom: OLD_APP } }, { onConflict: 'tenant_id,key' });
    if (error) throw new Error(error.message);
    return reply({ imported: true, counts });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Import failed' }, 500);
  }
}
