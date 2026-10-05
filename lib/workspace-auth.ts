import { serverClient } from './supabase/server';

export async function workspaceAccess(required: 'viewer' | 'editor' | 'admin' = 'viewer') {
  const db = await serverClient();
  const { data: claims, error: authError } = await db.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (authError || !userId) throw Object.assign(new Error('Sign in to open Vanor BD.'), { status: 401 });
  const { data: membership, error } = await db.from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!membership) throw Object.assign(new Error('Your account has not been added to a Vanor workspace.'), { status: 403 });
  const rank = { viewer: 0, editor: 1, admin: 2 };
  const role = membership.role as keyof typeof rank;
  if (rank[role] < rank[required]) throw Object.assign(new Error('This action needs workspace editor access.'), { status: 403 });
  return { db, tenantId: membership.tenant_id as string, userId, role };
}
