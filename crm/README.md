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
| `commercial.html` | Tableau de bord (CA, commission, KPIs), prospection, commandes, propositions reçues |
| `admin.html` | Vue globale, validation des étapes, équipe (**création des comptes commerciaux**), prospection (**import JSON**), réglages |
| `bon-de-commande.html?cmd=ID` | BC imprimable A4 (Imprimer/PDF) — envoi e-mail via `mailto:` depuis le détail de commande |

## Alimenter la prospection (admin → commerciaux)

L'admin cherche les établissements à démarcher, puis les injecte en masse dans le CRM :

1. Onglet **Prospection** → « Importer des prospects (JSON) ».
2. Choisir le commercial destinataire et la zone, puis **« Copier le prompt de recherche »**.
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

Le bas de `supabase-schema.sql` contient un bloc « Migration 2026-09 » : il ajoute la colonne
`transport_ht` sur `commandes` et passe `commissionPct` à 10 dans les réglages. À exécuter une
seule fois dans le SQL Editor de Supabase. Sur une base neuve, le schéma complet suffit.

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
