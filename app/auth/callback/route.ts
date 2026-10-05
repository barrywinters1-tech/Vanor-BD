import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '../../../lib/supabase/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/login?error=missing_code', request.url));
  const db = await serverClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? '/login?error=sign_in_failed' : '/', request.url));
}
