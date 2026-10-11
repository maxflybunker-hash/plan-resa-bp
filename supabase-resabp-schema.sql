-- À exécuter une seule fois dans Supabase > SQL Editor.
-- Cette table contient les copies de lecture des réservations ResaBP pour le Plan.
-- Aucun accès anon/auth direct n'est accordé : seule la fonction serveur utilise la clé service_role.
create table if not exists reservations (
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

-- Par sécurité, ne crée aucune policy anon/auth pour cette table.
-- Les accès de lecture/écriture passent par la fonction Cloudflare côté serveur.
