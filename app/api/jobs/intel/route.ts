// Daily: market + planning scan (the Signals feed). Nothing else runs here: tasks, drafts and chases are retired (31 Oct 2026).
// Triggered by Vercel Cron (see vercel.json) with CRON_SECRET.
import { timingSafeEqual } from 'node:crypto';
import { runIntel } from '../../../../lib/intel-ingest';
import { jobRan } from '../../../../lib/todos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
  const supplied = Buffer.from(request.headers.get('authorization') || '');
  if (!process.env.CRON_SECRET || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  const started = Date.now();
  const result: Record<string, unknown> = {};
  try { result.scan = await runIntel({ write: true }); } catch (e) { result.scanError = e instanceof Error ? e.message : String(e); }
  const added = (result.scan as any)?.added?.length ?? 0;
  await jobRan({ job: 'signals-scan', name: 'Signals scan (05:40 weekdays)', ok: !result.scanError, note: result.scanError ? String(result.scanError) : `${added} new signals`, expectHours: 80 }).catch(() => {});
  return Response.json(result);
}
