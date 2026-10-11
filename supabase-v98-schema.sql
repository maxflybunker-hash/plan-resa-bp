-- V98 Plan de Salle : base partagée entre PC, tablette et téléphone.
-- À exécuter UNE SEULE FOIS dans Supabase > SQL Editor du projet
-- bljkyveagyclbxmyjjjj. Le script est idempotent pour pouvoir être relancé.

create table if not exists public.bp_kv (
  workspace_id text not null,
  key text not null,
  value text not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

alter table public.bp_kv enable row level security;
grant select, insert, update, delete on public.bp_kv to authenticated;

drop policy if exists "bp_kv_workspace_read" on public.bp_kv;
create policy "bp_kv_workspace_read"
  on public.bp_kv for select to authenticated
  using (workspace_id = 'bunker-paillettes');

drop policy if exists "bp_kv_workspace_insert" on public.bp_kv;
create policy "bp_kv_workspace_insert"
  on public.bp_kv for insert to authenticated
  with check (workspace_id = 'bunker-paillettes');

drop policy if exists "bp_kv_workspace_update" on public.bp_kv;
create policy "bp_kv_workspace_update"
  on public.bp_kv for update to authenticated
  using (workspace_id = 'bunker-paillettes')
  with check (workspace_id = 'bunker-paillettes');

drop policy if exists "bp_kv_workspace_delete" on public.bp_kv;
create policy "bp_kv_workspace_delete"
  on public.bp_kv for delete to authenticated
  using (workspace_id = 'bunker-paillettes');

-- Realtime doit surveiller explicitement la table pour notifier les autres appareils.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bp_kv'
  ) then
    alter publication supabase_realtime add table public.bp_kv;
  end if;
exception when undefined_object then
  raise notice 'Publication supabase_realtime absente : activez Realtime dans Supabase après la création de la table.';
end $$;

-- Table de réception ResaBP : l'application n'y accède que via la fonction
-- serveur Cloudflare (clé service-role uniquement côté serveur).
create table if not exists public.resabp_reservations (
  external_id text primary key,
  date date,
  first_name text,
  last_name text,
  guest_count integer,
  time_slot text,
  phone text,
  notes text,
  area_name text,
  area_id text,
  status text not null default 'confirmed',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists resabp_reservations_date_time_idx
  on public.resabp_reservations (date, time_slot);
alter table public.resabp_reservations enable row level security;
revoke all on public.resabp_reservations from anon, authenticated;
