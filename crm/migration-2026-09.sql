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
