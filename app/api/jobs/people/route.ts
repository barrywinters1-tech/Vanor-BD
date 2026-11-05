// Names the person to call for fresh in-lane signals (names and titles only; capped per day). Runs after the 05:40 scan.
// Triggered by Vercel Cron (see vercel.json) with CRON_SECRET.
import { timingSafeEqual } from 'node:crypto';
import { findCandidates } from '../../../../lib/candidates';
import { jobRan } from '../../../../lib/todos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
  const supplied = Buffer.from(request.headers.get('authorization') || '');
  if (!process.env.CRON_SECRET || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  const result: Record<string, unknown> = {};
  try { result.people = await findCandidates(); } catch (e) { result.error = e instanceof Error ? e.message : String(e); }
  const r = result.people as any;
  await jobRan({ job: 'signals-people', name: 'Signals: name the person (06:10 weekdays)', ok: !result.error, note: result.error ? String(result.error) : `${r?.found ?? 0} of ${r?.checked ?? 0} signals got a named person (${r?.used ?? 0}/${r?.cap ?? 0} searches today)`, expectHours: 80 }).catch(() => {});
  return Response.json(result);
}
