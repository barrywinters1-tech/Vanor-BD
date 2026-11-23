import VanorWorkspace from './vanor-workspace';
import TodayApp from './today/today-app';
import LiveApp from './live/live-app';
import './today/today.css';
import { redirect } from 'next/navigation';
import { isConfigured, serverClient } from '../lib/supabase/server';

export const dynamic = 'force-dynamic';

// Home is Vanor Live (23 Nov 2026). The 18 Nov screens stay at /today and the full board at /board.
// Way back without a code change: set VANOR_HOME=today or VANOR_HOME=board in Vercel.
export default async function Home() {
  if (!isConfigured()) return <main style={{ padding: 40 }}><h1>Vanor BD</h1><p>Set the Supabase environment variables to open the workspace.</p></main>;
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) redirect('/login');
  if (process.env.VANOR_HOME === 'board') return <VanorWorkspace />;
  if (process.env.VANOR_HOME === 'today') return <TodayApp />;
  return <LiveApp />;
}
