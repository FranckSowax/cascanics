# Cascanics CRM — Espace équipe (prospection & ventes)

Module autonome dans `/crm/`, même stack que la landing (HTML/CSS/JS vanilla, zéro build),
branché sur **Supabase** (projet `gxhykvoamxqdljrbjwyu`) : authentification e-mail/mot de
passe + Postgres avec Row Level Security. Les données sont partagées entre tous les
appareils en temps réel de session à session.

Accès : `https://votre-domaine/crm/` (en dev : `python3 -m http.server 8642` puis
`http://localhost:8642/crm/`). Pages en `noindex` (outil interne).

## Workflow commercial

```
PROSPECTION                      VENTE                                    PRODUCTION & LIVRAISON
À visiter → Visité → Intéressé → BC envoyé → Signé → ACOMPTE 50 % ⟶ En production (25 j hors stock)
                                                        │                    ↓
                                                        │              Contrôle qualité OK
                                                        │                    ↓
                                                        └──────────→ SOLDE 50 % → Expédiée → Livrée
```

Règles :
- **Acompte 50 % TTC** dû à la commande — verrou avant production.
- **Solde 50 % TTC** dû après validation du contrôle qualité, avant expédition.
- **Fabrication 25 jours** (réglable) si pas de stock ; expédition rapide si stock.
- Le commercial avance les étapes commerciales (BC envoyé, Signé) ;
  l'admin valide paiements, production, contrôle qualité, expédition, livraison.
- Offre **Achat machine** active (5 000 € HT, réglable) ; **Placement en dépôt** visible mais
  verrouillée (« Bientôt disponible »).
- **Commission = 10 %** (réglable dans Réglages) du **montant HT des machines encaissé**, après remise
  et **hors transport** — uniquement sur les commandes soldées.
- Le **transport** est une ligne facturable du bon de commande (saisie à la création de la commande) :
  il apparaît sur le BC et dans le total TTC, mais n'entre jamais dans la base de commission.

## Interfaces

| Page | Rôle |
|---|---|
| `index.html` | Connexion e-mail / mot de passe |
| `commercial.html` | Tableau de bord (CA, commission, KPIs), **pool Cascanics**, mes prospects, commandes, propositions reçues |
| `admin.html` | Vue globale, validation des étapes, équipe (**création des comptes commerciaux**), prospection (**import JSON**), réglages |
| `bon-de-commande.html?cmd=ID` | BC imprimable A4 (Imprimer/PDF) — envoi e-mail via `mailto:` depuis le détail de commande |

## Pool commun de prospection

Un prospect **sans commercial** appartient au pool : tous les commerciaux le voient dans l'onglet
« Prospects Cascanics » et n'importe lequel peut le réserver.

- **Quota : 5 réservations par commercial et par semaine civile** (lundi → dimanche, heure de Paris),
  réglable dans Réglages. Le compteur repart à zéro le lundi.
- La réservation est **atomique** (RPC `reserver_prospect`) : deux commerciaux ne peuvent pas prendre
  la même ligne, et un verrou consultatif empêche un même commercial de dépasser son quota en
  cliquant depuis deux onglets. Une fois réservé, le prospect quitte le pool et bascule dans
  « Mes prospects ».
- Le quota n'est pas contournable depuis le navigateur : `commercial_id` et `reserve_le` sont
  retirés des droits d'écriture de `authenticated` (grant par colonne), elles ne changent que
  par les RPC. La semaine est calculée en heure de Paris des deux côtés, JS et SQL.
- **Restitution** : tant que le prospect est au statut « À visiter » et ne porte aucun bon de commande,
  le commercial peut le rendre au pool (`relacher_prospect`) — cela lui rend une réservation.
  L'admin peut remettre au pool n'importe quel prospect encore à visiter.
- **L'attribution nominative reste possible** (import vers un commercial précis) et ne consomme pas
  de quota.
- Tout remonte à l'admin, onglet Prospection : consommation du quota par commercial, contenu du pool,
  et pour chaque prospect pris en charge son origine, son statut et sa dernière note.

## Alimenter la prospection (admin → commerciaux)

L'admin cherche les établissements à démarcher, puis les injecte en masse dans le CRM :

1. Onglet **Prospection** → « Importer des prospects (JSON) ».
2. Choisir la destination — **Pool commun** (conseillé) ou un commercial précis — et la zone,
   puis **« Copier le prompt de recherche »**.
3. Coller ce prompt dans Cowork (ou tout assistant avec accès web) → il renvoie un JSON.
4. Coller le JSON (ou charger le fichier `.json`) : l'aperçu annonce en direct combien
   d'entrées seront importées, combien sont déjà en base et combien sont rejetées, avec la raison.
5. « Importer » : les prospects arrivent chez le commercial au statut **À visiter**,
   marqués « Importé ».

Format accepté — un objet `{ "zone": …, "prospects": [ … ] }`, un tableau brut, ou un bloc
` ```json ` copié tel quel. Par entrée : `entreprise` (seul champ obligatoire), `type`, `ville`,
`adresse`, `contact`, `tel`, `email`, `notes` (texte ou liste), et `commercial` (e-mail ou nom)
pour répartir un même lot entre plusieurs commerciaux. Le `type` est normalisé automatiquement
(« accessoiriste » → « Accessoiriste moto ») et retombe sur « Autre » si non reconnu.
Les doublons sont détectés sur entreprise + ville, sans tenir compte de la casse ni des accents.

Le texte du prompt vit dans `js/prompt-prospection.js` (source unique, lue par le bouton).

## Migration à jouer (base déjà en service)

Sur une base neuve, `supabase-schema.sql` s'exécute tel quel de haut en bas. Sur une base déjà
en service, copier **tout ce qui suit le titre « Migration 2026-09 » jusqu'à la fin du fichier**
dans le SQL Editor de Supabase — l'ordre est important et le bloc est rejouable sans dommage :

- **Migration 2026-09** — colonne `transport_ht` sur `commandes`, `commissionPct` à 10.
- **Migration 2026-09-b** — `commercial_id` rendu nullable et colonne `reserve_le` sur `prospects`,
  politiques RLS ouvrant le pool à toute l'équipe, quota par défaut à 5 (sans écraser une valeur
  déjà réglée).
- **Pool commun** — droits d'écriture par colonne sur `prospects` et fonctions `debut_semaine`,
  `reservations_semaine`, `reserver_prospect`, `relacher_prospect`.

Testé sur PostgreSQL 16 : installation neuve et migration d'une base existante, puis rejeu.

## Architecture

- `js/config.js` — URL du projet + clé publishable (publique par conception, RLS derrière).
- `js/store.js` — seule couche qui parle à Supabase : Auth, chargement en cache mémoire au
  démarrage, mutations en écriture directe (write-through). Les interfaces restent synchrones.
- `supabase-schema.sql` — schéma complet appliqué en base : tables `profiles`, `prospects`,
  `commandes` (numéro `BC-AAAA-NNNN` généré par séquence), `propositions`, `settings` ;
  politiques RLS (chaque commercial ne voit que ses données, l'admin voit tout) ;
  RPC `creer_commercial` (réservée admin) qui crée le compte de connexion.

## Comptes

- **Admin** : `admin@cascanics.com` (mot de passe initial transmis à la mise en service — à changer).
- **Commerciaux** : créés par l'admin dans l'onglet Commerciaux (e-mail + mot de passe initial).
- Un compte de test existe : `commercial.test@cascanics.com`.

## À compléter avant usage réel

- Coordonnées société : adresse, SIRET (Réglages admin) — apparaissent sur le BC.
- Changer les mots de passe initiaux ; supprimer le compte de test.
- Le mot de passe Postgres a circulé en clair : le régénérer dans le dashboard Supabase
  (Settings → Database) — l'app n'en dépend pas (elle utilise la clé publishable).
