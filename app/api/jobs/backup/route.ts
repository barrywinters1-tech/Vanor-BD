// Daily JSON snapshot of the whole workspace into the private Supabase "backups" bucket.
// Keeps the last 30. Triggered by Vercel Cron (see vercel.json) with CRON_SECRET.
import { timingSafeEqual } from 'node:crypto';
import { fullBackup } from '../../../../lib/bd-store';
import { serviceClient } from '../../../../lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const KEEP = 30;

export async function GET(request: Request) {
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
  const supplied = Buffer.from(request.headers.get('authorization') || '');
  if (!process.env.CRON_SECRET || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    const backup = await fullBackup();
    const name = `vanor-bd-${backup.exportedAt.slice(0, 10)}.json`;
    const storage = serviceClient().storage.from('backups');
    const { error } = await storage.upload(name, JSON.stringify(backup), { contentType: 'application/json', upsert: true });
    if (error) throw error;
    const { data: files } = await storage.list('', { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
    const old = (files || []).filter(f => f.name.startsWith('vanor-bd-')).slice(KEEP).map(f => f.name);
    if (old.length) await storage.remove(old);
    return Response.json({ saved: name, records: backup.records.length, work: backup.work.length, pruned: old.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Backup failed' }, { status: 500 });
  }
}
