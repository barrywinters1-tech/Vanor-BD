import { NextRequest, NextResponse } from 'next/server';
import { categoriseLead } from '../../../../lib/lead-categorisation';

import { workspaceAccess } from '../../../../lib/workspace-auth';
import { issueTicket } from '../../../../lib/import-backup';
import { researchCompany, normCompany } from '../../../../lib/company-intel';
import { saveIntel, researchBatch } from '../../../../lib/company-intel-store';
import { autoClassify, generateDrafts } from '../../../../lib/outreach';
import { runIntel } from '../../../../lib/intel-ingest';
import { runBackup } from '../../../../lib/backup-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Entity = { id: string; _rev?: number; [key: string]: any };
type Access = Awaited<ReturnType<typeof workspaceAccess>>;
type Context = { params: Promise<{ action?: string[] }> };
const allowedScopes = ['source', 'decision', 'work', 'event', 'planned_event'] as const;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const actionFor = async (context: Context) => (await context.params).action?.[0] || '';
const withoutRevision = (entity: Entity) => { const copy = { ...entity }; delete copy._rev; return copy; };
const fail = (error: unknown) => reply({ error: error instanceof Error ? error.message : 'Unexpected workspace error.' }, (error as { status?: number })?.status || 500);

async function list(access: Access, scope: string): Promise<Entity[]> {
  const rows: Entity[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await access.db.from('entities')
      .select('id,payload,revision')
      .eq('tenant_id', access.tenantId).eq('scope', scope)
      .order('id').range(start, start + 499);
    if (error) throw error;
    rows.push(...(data || []).map(row => ({ ...(row.payload as Entity), _rev: row.revision })));
    if (!data || data.length < 500) break;
  }
  return rows;
}

async function one(access: Access, scope: string, id: string): Promise<Entity | null> {
  const { data, error } = await access.db.from('entities')
    .select('payload,revision').eq('tenant_id', access.tenantId)
    .eq('scope', scope).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? { ...(data.payload as Entity), _rev: data.revision } : null;
}

async function save(access: Access, scope: string, entity: Entity, expectedRev: number, event?: Record<string, unknown>) {
  const now = new Date().toISOString();
  const history = event ? { ...event, id: crypto.randomUUID(), entityId: entity.id, at: now } : null;
  const { data, error } = await access.db.rpc('save_workspace_entity', {
    target_tenant: access.tenantId,
    target_scope: scope,
    target_id: entity.id,
    next_payload: withoutRevision(entity),
    expected_revision: expectedRev,
    history_event: history,
  });
  if (error) throw error;
  if (!data) throw Object.assign(new Error('This record changed in another session. Reload before retrying.'), { status: 409 });
  return { ...withoutRevision(entity), _rev: data, updatedAt: now };
}

async function metadata(access: Access) {
  const { data, error } = await access.db.from('workspace_metadata')
    .select('payload').eq('tenant_id', access.tenantId).eq('key', 'source').maybeSingle();
  if (error) throw error;
  return data?.payload || {};
}

async function importSource(access: Access, seed: any) {
  if (seed?.schemaVersion !== 5 || !Array.isArray(seed.records)) throw Object.assign(new Error('Expected a Vanor V5 source snapshot.'), { status: 400 });
  const previous = new Map((await list(access, 'source')).map(record => [record.id, record]));
  const changed: Entity[] = [];
  let added = 0, unchanged = 0;
  for (const record of seed.records as Entity[]) {
    if (!record?.id || !['lead', 'relationship', 'opportunity'].includes(String(record.kind))) continue;
    const before = previous.get(record.id);
    if (before && JSON.stringify(withoutRevision(before)) === JSON.stringify(withoutRevision(record))) { unchanged++; continue; }
    if (!before) added++;
    changed.push(withoutRevision(record));
  }
  for (let offset = 0; offset < changed.length; offset += 100) {
    const { error } = await access.db.from('entities').upsert(changed.slice(offset, offset + 100).map(record => ({
      tenant_id: access.tenantId, scope: 'source', id: record.id,
      payload: record, revision: (previous.get(record.id)?._rev || 0) + 1,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'tenant_id,scope,id' });
    if (error) throw error;
  }
  const { error } = await access.db.from('workspace_metadata').upsert({
    tenant_id: access.tenantId, key: 'source',
    payload: { ...(seed.meta || {}), importedAt: new Date().toISOString() },
  }, { onConflict: 'tenant_id,key' });
  if (error) throw error;
  if (changed.length) await applyCategorisations(access, changed.map(record => record.id));
  return { added, changed: changed.length - added, unchanged, missing: Math.max(0, previous.size - seed.records.length) };
}

function protectedCategories(decision: Entity) {
  const overrides = { ...(decision.categoryOverrides || {}) };
  if (!decision.autoCategorisation) {
    for (const field of ['segment', 'service', 'priority']) if (decision[field]) overrides[field] = true;
  }
  return overrides;
}

async function categorisationPreview(access: Access, ids?: string[]) {
  const [sources, decisions] = await Promise.all([list(access, 'source'), list(access, 'decision')]);
  const existing = new Map(decisions.map(item => [item.id, item]));
  const selected = ids ? new Set(ids) : null;
  return Promise.all(sources.filter(lead => ['relationship', 'lead'].includes(String(lead.kind)) && (!selected || selected.has(lead.id))).map(async lead => {
    const current = existing.get(lead.id) || { id: lead.id, _rev: 0 };
    const overrides = protectedCategories(current);
    const input = { ...lead, nextAsk: current.nextAsk || lead.nextAsk };
    const proposal = { ...categoriseLead(input), provider: 'rules' };
    const effective = {
      segment: overrides.segment ? current.segment : proposal.segment,
      service: overrides.service ? current.service : proposal.service,
      priority: overrides.priority ? current.priority : proposal.priority,
    };
    const previousProposal = current.autoCategorisation ? { ...current.autoCategorisation } : null;
    if (previousProposal) delete previousProposal.appliedAt;
    const willChange = ['segment', 'service', 'priority'].some(field => effective[field as keyof typeof effective] !== current[field])
      || JSON.stringify(proposal) !== JSON.stringify(previousProposal);
    return { id: lead.id, name: lead.name || lead.company || lead.id, company: lead.company || '',
      current: { segment: current.segment || '', service: current.service || '', priority: current.priority || '' },
      proposal, effective, overrides, willChange, revision: current._rev || 0 };
  }));
}

async function applyCategorisations(access: Access, ids?: string[]) {
  const preview = await categorisationPreview(access, ids);
  let applied = 0;
  for (const item of preview.filter(item => item.willChange)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await one(access, 'decision', item.id) || { id: item.id, _rev: 0 };
      const overrides = protectedCategories(current);
      const proposal = item.proposal;
      const stored = {
        ...withoutRevision(current),
        segment: overrides.segment ? current.segment : proposal.segment,
        service: overrides.service ? current.service : proposal.service,
        priority: overrides.priority ? current.priority : proposal.priority,
        categoryOverrides: overrides,
        autoCategorisation: { ...proposal, appliedAt: new Date().toISOString() },
      };
      try { await save(access, 'decision', stored, current._rev || 0); applied++; break; }
      catch (error) { if ((error as { status?: number })?.status !== 409 || attempt === 2) throw error; }
    }
  }
  return { applied, reviewed: preview.length, needsReview: preview.filter(item => item.proposal.needsReview).length };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const access = await workspaceAccess();
    const action = await actionFor(context);
    if (action === 'user') {
      const { data } = await access.db.auth.getUser();
      const email = data.user?.email || '';
      return reply({ actor: /graeme/i.test(email) ? 'Graeme' : /barry/i.test(email) ? 'Barry' : email || 'Unassigned', role: access.role });
    }
    if (action === 'ready') {
      const { data, error } = await access.db.from('entities').select('id')
        .eq('tenant_id', access.tenantId).eq('scope', 'source').limit(1);
      if (error) throw error;
      return reply({ ready: Boolean(data?.length), role: access.role });
    }
    if (action === 'revision') {
      const { data, error } = await access.db.from('entities').select('updated_at')
        .eq('tenant_id', access.tenantId).order('updated_at', { ascending: false }).limit(1);
      if (error) throw error;
      return reply({ revision: data?.[0]?.updated_at || '' });
    }
    if (action === 'entity') {
      const scope = request.nextUrl.searchParams.get('scope') || '';
      const id = request.nextUrl.searchParams.get('id') || '';
      if (!['decision', 'work', 'planned_event'].includes(scope) || !id) return reply({ error: 'Invalid record.' }, 400);
      const row = await one(access, scope, id);
      return row ? reply(row) : reply({ error: 'Record not found.' }, 404);
    }
    const [records, decisions, work, events, plannedEvents, meta] = await Promise.all([
      list(access, 'source'), list(access, 'decision'), list(access, 'work'),
      list(access, 'event'), list(access, 'planned_event'), metadata(access),
    ]);
    const body = { records, decisions: Object.fromEntries(decisions.map(item => [item.id, item])), work, events, plannedEvents, meta };
    return reply(action === 'backup' ? { schemaVersion: 5, backup: true, exportedAt: new Date().toISOString(), ...body } : body);
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const action = await actionFor(context);
    const access = await workspaceAccess(['restore', 'import-ticket', 'run-scan', 'run-research', 'run-backup'].includes(action) ? 'admin' : 'editor');
    if (action === 'import-ticket') return reply({ ticket: await issueTicket(access.tenantId) });
    if (action === 'run-scan') return reply(await runIntel({ write: true }));
    if (action === 'run-research') return reply(await researchBatch({ limit: 25, budgetMs: 45000 }));
    if (action === 'run-backup') return reply(await runBackup());
    if (action === 'run-drafts') return reply({ classified: await autoClassify({ limit: 120 }), drafts: await generateDrafts({ limit: 40 }) });
    const body: any = await request.json();
    if (action === 'draft') {
      const id = String(body?.id || '');
      if (!id) return reply({ error: 'Give a contact id.' }, 400);
      const made = await generateDrafts({ ids: [id], limit: 1 });
      const stored = await one(access, 'decision', id);
      return reply({ ...made, decision: stored });
    }
    if (action === 'research') {
      const name = String(body?.company || '').trim();
      if (name.length < 2) return reply({ error: 'Give a company name.' }, 400);
      const intel = await researchCompany(name);
      const ids = (await list(access, 'source')).filter(r => normCompany(r.company) === normCompany(name)).map(r => r.id);
      if (ids.length && body?.save !== false) await saveIntel(ids, intel);
      return reply({ ...intel, savedOn: body?.save === false ? 0 : ids.length });
    }
    if (action === 'bootstrap') return reply({ error: 'Import a fresh backup to initialise this workspace.' }, 409);
    if (action === 'import') return reply(await importSource(access, body));
    if (action === 'categorize') {
      if (body?.mode === 'preview') return reply({ items: await categorisationPreview(access, body.ids) });
      if (body?.mode === 'apply') return reply(await applyCategorisations(access, body.ids));
      return reply({ error: 'Choose preview or apply.' }, 400);
    }
    if (action === 'source') {
      if (!body?.id || !['relationship', 'lead'].includes(body.kind)) return reply({ error: 'Invalid lead record.' }, 400);
      const previous = await one(access, 'source', body.id);
      const stored = await save(access, 'source', body, previous?._rev || 0);
      await applyCategorisations(access, [body.id]);
      return reply(stored);
    }
    if (action === 'entity') {
      const { scope, entity, expectedRev, event } = body as { scope: string; entity: Entity; expectedRev: number; event?: Record<string, unknown> };
      if (!allowedScopes.includes(scope as typeof allowedScopes[number]) || scope === 'source' || scope === 'event' || !entity?.id)
        return reply({ error: 'Invalid record.' }, 400);
      let stored = withoutRevision(entity);
      if (scope === 'decision') {
        const previous = await one(access, scope, entity.id);
        const overrides = protectedCategories(previous || { id: entity.id });
        for (const field of ['segment', 'service', 'priority']) {
          if (stored[field] && stored[field] !== previous?.[field]) overrides[field] = true;
        }
        stored = { ...stored, categoryOverrides: overrides };
        const pd = previous?.draft as Record<string, unknown> | undefined, nd = stored.draft as Record<string, unknown> | undefined;
        if (nd && pd && (nd.subject !== pd.subject || nd.body !== pd.body) && ['suggested', 'edited'].includes(String(nd.status)))
          stored = { ...stored, draft: { ...nd, status: 'edited', origin: 'founder', editedAt: new Date().toISOString() } };
      }
      return reply(await save(access, scope, stored, expectedRev || 0, event));
    }
    if (action === 'restore') {
      if (body?.schemaVersion !== 5 || !Array.isArray(body.records) || !Array.isArray(body.work) || !body.decisions)
        return reply({ error: 'Invalid Vanor backup.' }, 400);
      const { data: existing, error: lookupError } = await access.db.from('entities').select('id')
        .eq('tenant_id', access.tenantId).limit(1);
      if (lookupError) throw lookupError;
      if (existing?.length) return reply({ error: 'This workspace already has data. Restore is restricted to an empty workspace.' }, 409);
      await importSource(access, { schemaVersion: 5, records: body.records, meta: body.meta || {} });
      const groups: [string, Entity[]][] = [
        ['decision', Object.values(body.decisions)], ['work', body.work],
        ['event', body.events || []], ['planned_event', body.plannedEvents || []],
      ];
      for (const [scope, values] of groups) for (let offset = 0; offset < values.length; offset += 100) {
        const { error } = await access.db.from('entities').upsert(values.slice(offset, offset + 100).map(value => ({
          tenant_id: access.tenantId, scope, id: value.id, payload: withoutRevision(value),
          revision: value._rev || 1, updated_at: new Date().toISOString(),
        })), { onConflict: 'tenant_id,scope,id' });
        if (error) throw error;
      }
      return reply({ restored: true, counts: { records: body.records.length, decisions: Object.keys(body.decisions).length,
        work: body.work.length, events: (body.events || []).length, plannedEvents: (body.plannedEvents || []).length } });
    }
    return reply({ error: 'Unknown action.' }, 404);
  } catch (error) { return fail(error); }
}
