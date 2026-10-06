'use client';

// Landing page for the emailed sign-in link. The link's #fragment carries the session
// tokens; store them as the app's cookie session, then go to the board.
import { useEffect, useState } from 'react';
import { browserClient } from '../../../lib/supabase/browser';

export default function AuthLink() {
  const [message, setMessage] = useState('Signing you in…');
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get('access_token');
    const refresh_token = hash.get('refresh_token');
    if (!access_token || !refresh_token) {
      setMessage(hash.get('error_description') || 'This link has expired. Send a new one from the sign-in page.');
      return;
    }
    browserClient().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) setMessage('Sign-in failed. Send a new link from the sign-in page.');
      else window.location.replace('/');
    });
  }, []);
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f5f1', padding: 16 }}>
    <p>{message} <a href="/login">Back to sign-in</a></p>
  </main>;
}
