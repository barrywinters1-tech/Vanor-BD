import VanorWorkspace from './vanor-workspace';
import TodayApp from './today/today-app';
import './today/today.css';
import { redirect } from 'next/navigation';
import { isConfigured, serverClient } from '../lib/supabase/server';

export const dynamic = 'force-dynamic';

// Home is the refreshed screens (18 Nov 2026). Way back without a code change: set VANOR_HOME=board in Vercel.
export default async function Home() {
  if (!isConfigured()) return <main style={{ padding: 40 }}><h1>Vanor BD</h1><p>Set the Supabase environment variables to open the workspace.</p></main>;
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) redirect('/login');
  return process.env.VANOR_HOME === 'board' ? <VanorWorkspace /> : <TodayApp />;
}
