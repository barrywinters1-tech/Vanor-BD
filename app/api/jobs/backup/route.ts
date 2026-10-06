// Daily JSON snapshot of the whole workspace into the private Supabase "backups" bucket.
// Keeps the last 30. Triggered by Vercel Cron (see vercel.json) with CRON_SECRET.
import { timingSafeEqual } from 'node:crypto';
import { runBackup } from '../../../../lib/backup-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
  const supplied = Buffer.from(request.headers.get('authorization') || '');
  if (!process.env.CRON_SECRET || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    return Response.json(await runBackup());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Backup failed' }, { status: 500 });
  }
}
