'use client';

import { useEffect, useState } from 'react';
import { browserClient } from '../../lib/supabase/browser';

const box: React.CSSProperties = { display: 'block', width: '100%', padding: 12, margin: '8px 0 16px', border: '1px solid #b9c5c7', borderRadius: 8, fontSize: 16 };
const btn: React.CSSProperties = { width: '100%', padding: 12, border: 0, borderRadius: 8, color: '#fff', background: '#385d61', cursor: 'pointer', fontSize: 16 };

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get('error');
    if (error) setMessage('That link didn\'t work or has expired. Send a new one, or use the 6-digit code from the email.');
  }, []);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error } = await browserClient().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) return setMessage(error.message);
    setSent(true);
    setMessage('Check your email. Tap the link, or type the 6-digit code below.');
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error } = await browserClient().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) return setMessage('That code didn\'t work. Check it, or send a new one.');
    window.location.href = '/';
  }

  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f5f1', padding: 16 }}>
    <div style={{ width: 'min(100%, 420px)', background: '#fff', padding: 28, borderRadius: 16, boxShadow: '0 8px 40px #20303918' }}>
      <h1 style={{ fontSize: 30, marginBottom: 8 }}>Vanor BD</h1>
      <p style={{ color: '#52646b', marginBottom: 20 }}>Sign in to your shared business development workspace.</p>
      <form onSubmit={send}>
        <label htmlFor="email">Work email</label>
        <input id="email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} style={box} />
        <button disabled={busy} style={btn}>{busy && !sent ? 'Sending…' : sent ? 'Send a new link' : 'Send sign-in link'}</button>
      </form>
      {sent && <form onSubmit={verify} style={{ marginTop: 20 }}>
        <label htmlFor="code">6-digit code from the email</label>
        <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" required value={code} onChange={e => setCode(e.target.value)} style={box} />
        <button disabled={busy} style={btn}>{busy ? 'Checking…' : 'Sign in'}</button>
      </form>}
      {message && <p role="status" style={{ marginTop: 16, color: '#33464d' }}>{message}</p>}
    </div>
  </main>;
}
