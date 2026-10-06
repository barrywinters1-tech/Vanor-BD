// Email-link sign-in that works in any browser (no PKCE cookie needed).
// Supabase email templates link here with ?token_hash=...&type=...
import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { serverClient } from '../../../lib/supabase/server';

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = (request.nextUrl.searchParams.get('type') || 'email') as EmailOtpType;
  if (!tokenHash) return NextResponse.redirect(new URL('/login?error=missing_token', request.url));
  const db = await serverClient();
  const { error } = await db.auth.verifyOtp({ token_hash: tokenHash, type });
  return NextResponse.redirect(new URL(error ? '/login?error=link_expired' : '/', request.url));
}
