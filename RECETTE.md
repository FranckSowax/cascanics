# Recette — points d'overlay & % de déclenchement

Chaque overlay est piloté par `data-in` / `data-out` (en % de la progression de la section pinnée), directement dans `index.html`. Les entrées/sorties durent 3 % (constantes `FADE_IN`/`FADE_OUT` dans js/main.js), les whips 2 %. Ajuster ces % après visionnage avec les vraies vidéos : modifier l'attribut, recharger, re-scroller — aucun autre fichier à toucher.

Règle de la spec : jamais deux blocs texte simultanés → garder ≥ 3 % d'écart entre le `data-out` d'un bloc et le `data-in` du suivant (le fade-out doit être terminé).

## Section 1 — Hero « The Reveal » (segment 1, pin 350 vh)

| # | Overlay | data-in | data-out | Fenêtre spec | Notes |
|---|---|---|---|---|---|
| 1 | Logo CASCANICS + baseline | 0 (visible d'emblée) | 9 | 0–8 % | Classe `is-on` : pas de tween d'entrée |
| 2 | « Chaque trajet laisse quelque chose… » | 30 | 42 | 30–45 % | Bas-gauche |
| 3 | « …plus contaminé qu'une lunette de toilettes. » | 45.5 | 52 | 45–52 % | `data-boost` : vignette renforcée synchrone |
| 4 | « Voici la réponse. » | 56 | 66 | 52–85 % | |
| 5 | « Cascanics. Le nettoyage professionnel… » | 70 | 82 | 52–85 % | |
| 6 | Flèche + « Découvrez le cycle » | 86 | — | 85–100 % | `data-stay` : reste jusqu'au dé-pin |

## Section 3 — « The Cycle » (segment 2, pin 400 vh)

| # | Overlay | data-in | stamp | data-out | Fenêtre spec | Notes |
|---|---|---|---|---|---|---|
| 7 | Titre « Un cycle. Trois technologies. » | 0.5 | — | 5 | 0–5 % | |
| 8 | Card 01 — Brume active 360° (droite, cyan) | 7 | 28 | 31 | 5–31 % | Sortie `whip-left` |
| 9 | Card 02 — Traitement UV-C (gauche, bleu) | 34 | 56 | 59 | 33–59 % | Sortie `whip-right` |
| 10 | Card 03 — Séchage air maîtrisé (droite, ambre) | 62 | — | 92 | 61–95 % | Sortie fade |
| 11 | « Sans eau. Sans démontage. Sans risque… » | 95 | — | — | 95–100 % | `data-stay` |

Teintes d'univers (js/main.js, `TINTS`) : cyan dès 5 %, bascule bleu-uv à 32 %, ambre à 60 %, retour neutre à 94 %.

## Section 5 — « The Orbit » (segment 3, pin 300 vh)

| # | Overlay | data-in | data-out | Fenêtre spec | Notes |
|---|---|---|---|---|---|
| 12 | Titre « Conçue pour encaisser. Pensée pour durer. » | 1 | 11 | 0–12 % | |
| 13a | Double caisson (gauche haut) | 13 | 23 | 12–70 % | Caler sur la face avant |
| 13b | Écran tactile (droite haut) | 24 | 34 | 12–70 % | Caler sur l'écran |
| 13c | Paiement universel (gauche bas) | 35 | 45 | 12–70 % | Caler sur le terminal |
| 13d | Supervision à distance (droite bas) | 46 | 56 | 12–70 % | Caler sur le dos |
| 13e | Acier traité / CE (gauche milieu) | 57 | 68 | 12–70 % | Caler sur le profil |
| 14 | Wordmark filigrane | 70 | — | 70–74 % | `data-stay`, opacité 10 % |
| 15 | Bloc CTA « Installez Cascanics chez vous » | 77 | — | 74–100 % | `data-stay` + `data-fx-in="slide-right"` |

## À vérifier après intégration de nouvelles vidéos

- [ ] Le freeze du choc hygiène (S1, 45–52 %) tombe bien sur le casque suspendu — **validé avec les rushes actuels**
- [ ] Les whips des cards 01/02 partent dans le sens du balayage vidéo (31–33 % et 59–61 %)
- [ ] Les 5 points d'ancrage S5 coïncident avec la face visible pendant l'orbite (ajuster `sp-1`…`sp-5` dans main.css pour la position, `data-in/out` pour le timing)
- [ ] Le tiers droit du cadre est vide au pull-back final (74–100 %) pour accueillir le bloc CTA
- [ ] Lisibilité des cards sur l'univers brume (fond très clair) — scrim sombre des `.glass` validé
- [ ] Test complet : Chrome / Safari / Firefox desktop, iOS Safari, Android Chrome — trackpad, molette, touch
