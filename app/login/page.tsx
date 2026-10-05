'use client';

import { useState } from 'react';
import { browserClient } from '../../lib/supabase/browser';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error } = await browserClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setMessage(error ? error.message : 'Check your email for a secure sign-in link.');
    setBusy(false);
  }
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f5f1', padding: 20 }}>
    <form onSubmit={signIn} style={{ width: 'min(100%, 420px)', background: '#fff', padding: 32, borderRadius: 16, boxShadow: '0 8px 40px #20303918' }}>
      <h1 style={{ fontSize: 30, marginBottom: 8 }}>Vanor BD</h1>
      <p style={{ color: '#52646b', marginBottom: 24 }}>Sign in to your shared business development workspace.</p>
      <label htmlFor="email">Work email</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)}
        style={{ display: 'block', width: '100%', padding: 12, margin: '8px 0 20px', border: '1px solid #b9c5c7', borderRadius: 8 }} />
      <button disabled={busy} style={{ width: '100%', padding: 12, border: 0, borderRadius: 8, color: '#fff', background: '#385d61', cursor: 'pointer' }}>
        {busy ? 'Sending link…' : 'Send sign-in link'}
      </button>
      {message && <p role="status" style={{ marginTop: 16 }}>{message}</p>}
    </form>
  </main>;
}
