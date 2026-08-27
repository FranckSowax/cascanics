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
- Commission = % (réglable, défaut 5 %) du CA HT **encaissé** (commandes soldées).

## Interfaces

| Page | Rôle |
|---|---|
| `index.html` | Connexion e-mail / mot de passe |
| `commercial.html` | Tableau de bord (CA, commission, KPIs), prospection, commandes, propositions reçues |
| `admin.html` | Vue globale, validation des étapes, équipe (**création des comptes commerciaux**), propositions de zones, réglages |
| `bon-de-commande.html?cmd=ID` | BC imprimable A4 (Imprimer/PDF) — envoi e-mail via `mailto:` depuis le détail de commande |

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
