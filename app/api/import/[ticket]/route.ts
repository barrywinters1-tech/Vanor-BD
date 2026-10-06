// The old app posts its backup here with a single-use ticket issued to a signed-in admin.
import { OLD_APP, parseBackup, redeemTicket, importBackup } from '../../../../lib/import-backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const cors = { 'Access-Control-Allow-Origin': OLD_APP, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

export function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }

export async function POST(request: Request, context: { params: Promise<{ ticket: string }> }) {
  try {
    const backup = parseBackup(Buffer.from(await request.arrayBuffer()));
    const tenant = await redeemTicket((await context.params).ticket);
    if (!tenant) return reply({ error: 'Ticket invalid or expired.' }, 403);
    return reply({ imported: true, counts: await importBackup(backup, tenant, OLD_APP) });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Import failed' }, (error as { status?: number })?.status || 500);
  }
}
