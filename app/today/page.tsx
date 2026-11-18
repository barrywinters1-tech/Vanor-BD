import { redirect } from 'next/navigation';
import { isConfigured, serverClient } from '../../lib/supabase/server';
import TodayApp from './today-app';
import './today.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vanor · Today' };

export default async function TodayPage() {
  if (!isConfigured()) return <main style={{ padding: 40 }}><h1>Vanor BD</h1><p>Set the Supabase environment variables to open the workspace.</p></main>;
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) redirect('/login');
  return <TodayApp />;
}
