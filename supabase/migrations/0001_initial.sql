create extension if not exists pgcrypto;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create or replace function public.has_tenant_role(target_tenant uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members
    where tenant_id = target_tenant
      and user_id = (select auth.uid())
      and role = any(allowed_roles)
  );
$$;

create table public.entities (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope text not null check (scope in ('source', 'decision', 'work', 'event', 'planned_event')),
  id text not null,
  payload jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, scope, id)
);
create index entities_scope_updated on public.entities(tenant_id, scope, updated_at desc);

create table public.workspace_metadata (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  payload jsonb not null,
  primary key (tenant_id, key)
);

create or replace function public.save_workspace_entity(
  target_tenant uuid,
  target_scope text,
  target_id text,
  next_payload jsonb,
  expected_revision integer,
  history_event jsonb default null
) returns integer
language plpgsql security invoker set search_path = ''
as $$
declare saved_revision integer;
begin
  if expected_revision = 0 then
    insert into public.entities(tenant_id, scope, id, payload, revision)
    values (target_tenant, target_scope, target_id, next_payload, 1)
    on conflict do nothing returning revision into saved_revision;
  else
    update public.entities
       set payload = next_payload, revision = revision + 1, updated_at = now()
     where tenant_id = target_tenant and scope = target_scope and id = target_id
       and revision = expected_revision
     returning revision into saved_revision;
  end if;
  if saved_revision is not null and history_event is not null then
    insert into public.entities(tenant_id, scope, id, payload, revision)
    values (target_tenant, 'event', history_event->>'id', history_event, 1);
  end if;
  return coalesce(saved_revision, 0);
end;
$$;
revoke all on function public.save_workspace_entity(uuid,text,text,jsonb,integer,jsonb) from public, anon;
grant execute on function public.save_workspace_entity(uuid,text,text,jsonb,integer,jsonb) to authenticated;

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.entities enable row level security;
alter table public.workspace_metadata enable row level security;

create policy tenants_read on public.tenants for select to authenticated
  using (public.has_tenant_role(id, array['admin','editor','viewer']));
create policy members_read on public.tenant_members for select to authenticated
  using (public.has_tenant_role(tenant_id, array['admin','editor','viewer']));
create policy entities_read on public.entities for select to authenticated
  using (public.has_tenant_role(tenant_id, array['admin','editor','viewer']));
create policy entities_insert on public.entities for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['admin','editor']));
create policy entities_update on public.entities for update to authenticated
  using (public.has_tenant_role(tenant_id, array['admin','editor']))
  with check (public.has_tenant_role(tenant_id, array['admin','editor']));
create policy metadata_read on public.workspace_metadata for select to authenticated
  using (public.has_tenant_role(tenant_id, array['admin','editor','viewer']));
create policy metadata_write on public.workspace_metadata for all to authenticated
  using (public.has_tenant_role(tenant_id, array['admin','editor']))
  with check (public.has_tenant_role(tenant_id, array['admin','editor']));

-- Explicit table privileges (RLS above still decides which rows).
grant select on public.tenants, public.tenant_members to authenticated;
grant select, insert, update on public.entities, public.workspace_metadata to authenticated;

-- ---------------------------------------------------------------------------
-- Vanor workspace bootstrap: one workspace, two named members.
-- Anyone else who requests a sign-in link gets an account but no access.
-- ---------------------------------------------------------------------------
create table public.allowed_members (
  email text primary key,
  role text not null check (role in ('admin', 'editor', 'viewer'))
);
alter table public.allowed_members enable row level security;
revoke all on public.allowed_members from anon, authenticated;

insert into public.tenants (name) values ('Vanor Advisory');
insert into public.allowed_members (email, role) values
  ('barryw@vanoradvisory.co.uk', 'admin'),
  ('graemek@vanoradvisory.co.uk', 'admin');

create or replace function public.grant_vanor_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare member_role text;
begin
  select role into member_role from public.allowed_members where email = lower(new.email);
  if member_role is not null then
    insert into public.tenant_members (tenant_id, user_id, role)
    select id, new.id, member_role from public.tenants order by created_at limit 1
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created_grant_vanor
  after insert on auth.users
  for each row execute function public.grant_vanor_membership();

-- Private bucket for the app's daily JSON snapshots (written by the server only).
insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
  on conflict (id) do nothing;
