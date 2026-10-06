// Daily: market + planning scan into the review queue, then company research with the time left.
// Triggered by Vercel Cron (see vercel.json) with CRON_SECRET.
import { timingSafeEqual } from 'node:crypto';
import { runIntel } from '../../../../lib/intel-ingest';
import { researchBatch } from '../../../../lib/company-intel-store';

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
  try { result.companies = await researchBatch({ limit: 25, budgetMs: Math.max(5000, 50000 - (Date.now() - started)) }); }
  catch (e) { result.companiesError = e instanceof Error ? e.message : String(e); }
  return Response.json(result);
}
