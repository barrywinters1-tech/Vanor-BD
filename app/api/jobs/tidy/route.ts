// Self-tidy (18 Nov 2026): closes dead to-dos (past meetings, passed slots, drafts unsent after 10 days, stale questions)
// so the partners never clear the board by hand. Each close is logged with its reason and can be undone on the board.
// Triggered by Vercel Cron (see vercel.json) with CRON_SECRET; ?dry=1 previews without writing.
import { timingSafeEqual } from 'node:crypto';
import { expireTodos, jobRan } from '../../../../lib/todos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
  const supplied = Buffer.from(request.headers.get('authorization') || '');
  if (!process.env.CRON_SECRET || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  let result: Awaited<ReturnType<typeof expireTodos>> | null = null, error = '';
  try { result = await expireTodos({ apply: !dry }); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  if (!dry) await jobRan({ job: 'board-tidy', name: 'Board tidy (06:30 daily)', ok: !error, note: error || `${result?.closed ?? 0} dead to-dos closed of ${result?.checked ?? 0} open`, expectHours: 50 }).catch(() => {});
  return Response.json(error ? { error } : result);
}
