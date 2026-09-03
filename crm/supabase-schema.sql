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
  -- NULL = prospect du pool commun, visible et réservable par tous les commerciaux.
  commercial_id uuid references public.profiles(id),
  -- Horodatage de la réservation depuis le pool (sert au quota hebdomadaire).
  reserve_le timestamptz,
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

-- Prospects : chacun voit les siens ET le pool commun ; l'admin voit tout.
-- Un commercial ne peut pas modifier une ligne du pool en direct : il passe par
-- reserver_prospect(), qui applique le quota et rend la prise atomique.
create policy prospects_select on public.prospects for select to authenticated
  using (commercial_id = auth.uid() or commercial_id is null or public.is_admin());
create policy prospects_insert on public.prospects for insert to authenticated
  with check (commercial_id = auth.uid() or public.is_admin());
create policy prospects_update on public.prospects for update to authenticated
  using (commercial_id = auth.uid() or public.is_admin())
  with check (commercial_id = auth.uid() or public.is_admin());
create policy prospects_delete on public.prospects for delete to authenticated
  using (public.is_admin());

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


-- ============================================================
-- Migration 2026-09-b — pool de prospection commun + quota hebdomadaire
-- À jouer une seule fois sur une base déjà en service.
-- ============================================================

-- 1. Un prospect sans commercial = prospect du pool commun.
alter table public.prospects alter column commercial_id drop not null;
alter table public.prospects add column if not exists reserve_le timestamptz;

-- 2. Le pool devient visible par toute l'équipe ; l'écriture directe reste
--    limitée à ses propres lignes (la prise passe par reserver_prospect).
drop policy if exists prospects_all on public.prospects;
drop policy if exists prospects_select on public.prospects;
drop policy if exists prospects_insert on public.prospects;
drop policy if exists prospects_update on public.prospects;
drop policy if exists prospects_delete on public.prospects;

create policy prospects_select on public.prospects for select to authenticated
  using (commercial_id = auth.uid() or commercial_id is null or public.is_admin());
create policy prospects_insert on public.prospects for insert to authenticated
  with check (commercial_id = auth.uid() or public.is_admin());
create policy prospects_update on public.prospects for update to authenticated
  using (commercial_id = auth.uid() or public.is_admin())
  with check (commercial_id = auth.uid() or public.is_admin());
create policy prospects_delete on public.prospects for delete to authenticated
  using (public.is_admin());

-- 3. Quota par défaut : 5 réservations par semaine civile.
update public.settings
   set data = jsonb_set(data, '{quotaHebdoProspects}', '5'::jsonb, true)
 where id = 1 and not (data ? 'quotaHebdoProspects');

-- 4. Les fonctions et le déclencheur de la section « Pool commun » ci-dessous
--    sont en « create or replace » : ils s'appliquent tels quels.


-- ============================================================
-- Pool commun : garde-fou, réservation, restitution
-- (après les ALTER TABLE ci-dessus : le corps des fonctions SQL
--  est analysé à la création et référence prospects.reserve_le)
-- ============================================================

-- Garde-fou : sans cela, un commercial pourrait remettre reserve_le à NULL
-- depuis le client (la clé anon et son jeton sont côté navigateur) et vider
-- son compteur de quota. On lui retire le droit d'écrire sur les deux colonnes
-- qui portent la propriété et le quota : elles ne changent plus que par les RPC
-- ci-dessous, qui s'exécutent avec les droits du propriétaire du schéma.
drop trigger if exists prospects_verrou on public.prospects;
drop function if exists public.prospects_verrou_proprietaire();

revoke update on public.prospects from authenticated;
grant update (entreprise, type, ville, adresse, contact, tel, email, statut, notes)
  on public.prospects to authenticated;

-- Début de la semaine civile courante : lundi 00:00, heure de Paris.
create or replace function public.debut_semaine()
returns timestamptz language sql stable set search_path = public as
$$ select (date_trunc('week', (now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris') $$;

-- Réservations déjà consommées cette semaine par l'appelant.
create or replace function public.reservations_semaine()
returns int language sql stable security definer set search_path = public as
$$ select count(*)::int from public.prospects
    where commercial_id = auth.uid() and reserve_le >= public.debut_semaine() $$;

-- Réserve un prospect du pool.
-- Le verrou consultatif sérialise les réservations d'un même commercial :
-- sans lui, deux onglets peuvent lire le même compteur et dépasser le quota.
create or replace function public.reserver_prospect(p_id uuid)
returns public.prospects language plpgsql security definer set search_path = public as $$
declare
  v_row   public.prospects;
  v_quota int;
  v_pris  int;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise';
  end if;
  if public.is_admin() then
    raise exception 'Le pool se réserve depuis un compte commercial. Attribuez le prospect depuis l''espace d''administration.';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  v_quota := coalesce((select (data->>'quotaHebdoProspects')::int from public.settings where id = 1), 5);
  v_pris  := public.reservations_semaine();
  if v_pris >= v_quota then
    raise exception 'Quota atteint : % réservation(s) cette semaine sur % autorisée(s). Le compteur repart lundi.', v_pris, v_quota;
  end if;

  update public.prospects
     set commercial_id = auth.uid(), reserve_le = now()
   where id = p_id and commercial_id is null
  returning * into v_row;

  if not found then
    raise exception 'Ce prospect n''est plus disponible : il vient d''être réservé par un autre commercial.';
  end if;
  return v_row;
end $$;

-- Rend un prospect au pool. Possible tant qu'il n'a pas été travaillé
-- (statut « À visiter ») et qu'aucun bon de commande vivant ne le vise ;
-- l'admin peut le faire sur n'importe quel prospect encore à visiter.
create or replace function public.relacher_prospect(p_id uuid)
returns public.prospects language plpgsql security definer set search_path = public as $$
declare v_row public.prospects;
begin
  update public.prospects
     set commercial_id = null, reserve_le = null, statut = 'a_visiter'
   where id = p_id
     and commercial_id is not null
     and (public.is_admin() or (commercial_id = auth.uid() and statut = 'a_visiter'))
     and not exists (
       select 1 from public.commandes c
        where c.client_id = p_id and c.statut <> 'annulee')
  returning * into v_row;

  if not found then
    raise exception 'Restitution impossible : le prospect a déjà été travaillé ou porte un bon de commande.';
  end if;
  return v_row;
end $$;

revoke all on function public.debut_semaine()          from public, anon;
revoke all on function public.reservations_semaine()   from public, anon;
revoke all on function public.reserver_prospect(uuid)  from public, anon;
revoke all on function public.relacher_prospect(uuid)  from public, anon;
grant execute on function public.debut_semaine()          to authenticated;
grant execute on function public.reservations_semaine()   to authenticated;
grant execute on function public.reserver_prospect(uuid)  to authenticated;
grant execute on function public.relacher_prospect(uuid)  to authenticated;
