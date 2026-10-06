'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const box: React.CSSProperties = { display: 'block', width: '100%', padding: 12, margin: '8px 0 16px', border: '1px solid #b9c5c7', borderRadius: 8, fontSize: 16 };
const btn: React.CSSProperties = { width: '100%', padding: 12, border: 0, borderRadius: 8, color: '#fff', background: '#385d61', cursor: 'pointer', fontSize: 16 };

// Implicit flow: the emailed link carries the session itself, so it works in whatever
// browser opens it (phone mail apps open links in their own browser).
const linkClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error'))
      setMessage('That link didn\'t work or has expired. Send a new one.');
  }, []);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error } = await linkClient().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/link` },
    });
    setBusy(false);
    setMessage(error ? error.message : 'Check your email and tap the link. It works on your phone or computer.');
  }

  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f5f1', padding: 16 }}>
    <form onSubmit={send} style={{ width: 'min(100%, 420px)', background: '#fff', padding: 28, borderRadius: 16, boxShadow: '0 8px 40px #20303918' }}>
      <h1 style={{ fontSize: 30, marginBottom: 8 }}>Vanor BD</h1>
      <p style={{ color: '#52646b', marginBottom: 20 }}>Sign in to your shared business development workspace.</p>
      <label htmlFor="email">Work email</label>
      <input id="email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} style={box} />
      <button disabled={busy} style={btn}>{busy ? 'Sending…' : 'Send sign-in link'}</button>
      {message && <p role="status" style={{ marginTop: 16, color: '#33464d' }}>{message}</p>}
    </form>
  </main>;
}
