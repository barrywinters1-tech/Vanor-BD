// Server-side data access for automation (Claude connector, cron jobs).
// Uses the service-role key, so every caller must authenticate first.
import { serviceClient } from './supabase/server';

export type Entity = { id: string; _rev?: number; [key: string]: any };
export type Scope = 'source' | 'decision' | 'work' | 'event' | 'planned_event';

const db = () => serviceClient();
const fail = (error: { message?: string; details?: string }): never => {
  throw new Error(`Database error: ${error.message || 'unknown'}${error.details ? ' (' + error.details + ')' : ''}`);
};
let cachedTenant = '';

export async function tenantId() {
  if (process.env.VANOR_TENANT_ID) return process.env.VANOR_TENANT_ID;
  if (cachedTenant) return cachedTenant;
  const { data, error } = await db().from('tenants').select('id').order('created_at').limit(1).maybeSingle();
  if (error) fail(error);
  if (!data) throw new Error('No Vanor workspace exists. Run supabase/setup.sql first.');
  return (cachedTenant = data.id as string);
}

const strip = (entity: Entity) => { const copy = { ...entity }; delete copy._rev; return copy; };

export async function listScope(scope: Scope): Promise<Entity[]> {
  const tenant = await tenantId();
  const rows: Entity[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db().from('entities').select('payload,revision')
      .eq('tenant_id', tenant).eq('scope', scope).order('id').range(start, start + 999);
    if (error) fail(error);
    rows.push(...(data || []).map(row => ({ ...(row.payload as Entity), _rev: row.revision })));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function getOne(scope: Scope, id: string): Promise<Entity | null> {
  const { data, error } = await db().from('entities').select('payload,revision')
    .eq('tenant_id', await tenantId()).eq('scope', scope).eq('id', id).maybeSingle();
  if (error) fail(error);
  return data ? { ...(data.payload as Entity), _rev: data.revision } : null;
}

/** Optimistic write: fails (returns null) if someone else changed the record first. */
export async function saveEntity(scope: Scope, entity: Entity, expectedRev: number): Promise<Entity | null> {
  const tenant = await tenantId();
  const now = new Date().toISOString();
  const payload = { ...strip(entity), updatedAt: now };
  if (!expectedRev) {
    const { data, error } = await db().from('entities')
      .upsert({ tenant_id: tenant, scope, id: entity.id, payload, revision: 1, updated_at: now },
        { onConflict: 'tenant_id,scope,id', ignoreDuplicates: true }).select('revision');
    if (error) fail(error);
    return data?.length ? { ...payload, _rev: 1 } : null;
  }
  const { data, error } = await db().from('entities')
    .update({ payload, revision: expectedRev + 1, updated_at: now })
    .eq('tenant_id', tenant).eq('scope', scope).eq('id', entity.id).eq('revision', expectedRev).select('revision');
  if (error) fail(error);
  return data?.length ? { ...payload, _rev: expectedRev + 1 } : null;
}

/** Read-modify-write with retry, so Claude never overwrites a founder's concurrent edit. */
export async function updateEntity(scope: Scope, id: string, change: (current: Entity) => Entity, createIfMissing = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getOne(scope, id);
    if (!current && !createIfMissing) throw new Error(`No ${scope} record with id ${id}.`);
    const next = change(current ? strip(current) : { id });
    const saved = await saveEntity(scope, { ...next, id }, current?._rev || 0);
    if (saved) return saved;
  }
  throw new Error('That record kept changing while Claude was updating it. Try again.');
}

export async function logEvent(event: { entityId: string; recordId?: string; type: string; note: string; actor?: string; [key: string]: unknown }) {
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  await saveEntity('event', { ...event, id, actor: event.actor || 'Claude', at }, 0);
  return id;
}

export async function searchSources(query: string, limit = 20) {
  const tenant = await tenantId();
  const q = query.replace(/[%,()*\\]/g, ' ').trim();
  if (!q) return [];
  const pattern = `%${q}%`;
  const { data, error } = await db().from('entities').select('payload,revision')
    .eq('tenant_id', tenant).eq('scope', 'source')
    .or(['name', 'company', 'email', 'jobTitle'].map(field => `payload->>${field}.ilike.${pattern}`).join(','))
    .limit(limit);
  if (error) fail(error);
  return (data || []).map(row => ({ ...(row.payload as Entity), _rev: row.revision }) as Entity);
}

export async function findByEmail(email: string) {
  const { data, error } = await db().from('entities').select('payload,revision')
    .eq('tenant_id', await tenantId()).eq('scope', 'source')
    .ilike('payload->>email', email.trim()).limit(5);
  if (error) fail(error);
  return (data || []).map(row => ({ ...(row.payload as Entity), _rev: row.revision }) as Entity);
}

export async function fullBackup() {
  const [records, decisions, work, events, plannedEvents] = await Promise.all(
    (['source', 'decision', 'work', 'event', 'planned_event'] as Scope[]).map(listScope));
  return {
    schemaVersion: 5, backup: true, exportedAt: new Date().toISOString(),
    records, decisions: Object.fromEntries(decisions.map(item => [item.id, item])),
    work, events, plannedEvents, meta: { name: 'Vanor BD (Supabase)', sourceType: 'supabase', live: true },
  };
}

export async function workspaceRevision() {
  const { data, error } = await db().from('entities').select('updated_at')
    .eq('tenant_id', await tenantId()).order('updated_at', { ascending: false }).limit(1);
  if (error) fail(error);
  return data?.[0]?.updated_at || '';
}
