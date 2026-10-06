// Daily market + planning scan. New signals land in the board's review queue as leads.
// Triggered by Vercel Cron (see vercel.json) with CRON_SECRET.
import { timingSafeEqual } from 'node:crypto';
import { runIntel } from '../../../../lib/intel-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
  const supplied = Buffer.from(request.headers.get('authorization') || '');
  if (!process.env.CRON_SECRET || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    return Response.json(await runIntel({ write: true }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Scan failed' }, { status: 500 });
  }
}
