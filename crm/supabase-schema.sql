-- ============================================================
-- CASCANICS CRM — schéma Supabase
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Profils (lié à auth.users) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','commercial')),
  nom text not null,
  zone text default '',
  tel text default '',
  email text not null,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Réglages (ligne unique) ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null
);

-- ---------- Prospects / clients ----------
create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  commercial_id uuid not null references public.profiles(id),
  entreprise text not null,
  type text default 'Autre',
  ville text default '',
  adresse text default '',
  contact text default '',
  tel text default '',
  email text default '',
  statut text not null default 'a_visiter'
    check (statut in ('a_visiter','visite','interesse','devis','client','perdu')),
  source text not null default 'perso' check (source in ('perso','proposition_admin')),
  notes jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ---------- Commandes ----------
create sequence public.commande_seq start 1;

create table public.commandes (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique
    default 'BC-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.commande_seq')::text, 4, '0'),
  client_id uuid not null references public.prospects(id),
  commercial_id uuid not null references public.profiles(id),
  offre text not null default 'achat' check (offre in ('achat')),
  qty int not null default 1 check (qty > 0),
  prix_unitaire_ht numeric not null,
  remise_pct numeric not null default 0 check (remise_pct between 0 and 100),
  -- Transport facturé au client, exclu de la base de commission.
  transport_ht numeric not null default 0 check (transport_ht >= 0),
  statut text not null default 'brouillon'
    check (statut in ('brouillon','envoyee','signee','acompte_recu','en_production',
                      'controle_qualite','solde_recu','expediee','livree','annulee')),
  avec_stock boolean not null default false,
  historique jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ---------- Propositions de démarchage ----------
create table public.propositions (
  id uuid primary key default gen_random_uuid(),
  commercial_id uuid not null references public.profiles(id),
  zone text not null,
  cible text default '',
  message text default '',
  statut text not null default 'proposee' check (statut in ('proposee','acceptee','traitee')),
  created_at timestamptz not null default now()
);

-- ---------- Helper : l'appelant est-il admin ? ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.prospects enable row level security;
alter table public.commandes enable row level security;
alter table public.propositions enable row level security;

-- Profils : l'équipe voit les noms, chacun modifie sa fiche, l'admin gère tout.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy profiles_delete on public.profiles for delete to authenticated using (public.is_admin());

-- Réglages : lecture équipe, écriture admin.
create policy settings_select on public.settings for select to authenticated using (true);
create policy settings_update on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy settings_insert on public.settings for insert to authenticated with check (public.is_admin());

-- Prospects : chaque commercial voit/gère les siens, l'admin tout.
create policy prospects_all on public.prospects for all to authenticated
  using (commercial_id = auth.uid() or public.is_admin())
  with check (commercial_id = auth.uid() or public.is_admin());

-- Commandes : idem.
create policy commandes_all on public.commandes for all to authenticated
  using (commercial_id = auth.uid() or public.is_admin())
  with check (commercial_id = auth.uid() or public.is_admin());

-- Propositions : l'admin crée, le commercial concerné lit et met à jour le statut.
create policy propositions_select on public.propositions for select to authenticated
  using (commercial_id = auth.uid() or public.is_admin());
create policy propositions_insert on public.propositions for insert to authenticated
  with check (public.is_admin());
create policy propositions_update on public.propositions for update to authenticated
  using (commercial_id = auth.uid() or public.is_admin())
  with check (commercial_id = auth.uid() or public.is_admin());
create policy propositions_delete on public.propositions for delete to authenticated
  using (public.is_admin());

-- ---------- Création d'un utilisateur (interne) ----------
create or replace function public._creer_utilisateur(p_email text, p_password text)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, is_sso_user
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    lower(p_email), crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', '', '', '', '', false
  );
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_id,
    jsonb_build_object('sub', v_id::text, 'email', lower(p_email), 'email_verified', true, 'phone_verified', false),
    'email', v_id::text, now(), now(), now()
  );
  return v_id;
end $$;

revoke all on function public._creer_utilisateur(text, text) from public, anon, authenticated;

-- ---------- RPC admin : créer un compte commercial ----------
create or replace function public.creer_commercial(
  p_email text, p_password text, p_nom text, p_zone text default '', p_tel text default ''
) returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administration';
  end if;
  if length(p_password) < 8 then
    raise exception 'Mot de passe : 8 caractères minimum';
  end if;
  v_id := public._creer_utilisateur(p_email, p_password);
  insert into public.profiles (id, role, nom, zone, tel, email)
  values (v_id, 'commercial', p_nom, p_zone, p_tel, lower(p_email));
  return v_id;
end $$;

grant execute on function public.creer_commercial(text, text, text, text, text) to authenticated;


-- ============================================================
-- Migration 2026-09 — transport facturable + commission à 10 %
-- À jouer une seule fois sur une base déjà en service.
-- (Sur une base neuve, tout est déjà dans les définitions ci-dessus.)
-- ============================================================

-- 1. Ligne de transport sur le bon de commande, exclue de la commission.
alter table public.commandes
  add column if not exists transport_ht numeric not null default 0;

do $$ begin
  alter table public.commandes add constraint commandes_transport_ht_check check (transport_ht >= 0);
exception when duplicate_object then null;
end $$;

-- 2. Commission commerciaux portée à 10 % du HT machines encaissé, hors transport.
update public.settings
   set data = jsonb_set(data, '{commissionPct}', '10'::jsonb, true)
 where id = 1;
