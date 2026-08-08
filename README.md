# Cascanics — Landing page scroll-scrub cinématique

One-page statique : HTML/CSS/JS vanilla + GSAP ScrollTrigger + Lenis. Trois segments vidéo (15 s, 24 fps) scrubbés frame par frame dans des `<canvas>` pinnés.

## Arborescence

```
index.html              Page complète (7 sections + navbar + footer)
css/main.css            Design system + layout + overlays + fallback statique
js/main.js              Lenis + ScrollTrigger : pins, timelines, overlays, compteurs, formulaire
js/scrub.js             Module canvas : chargement des frames WebP + rendu cover
frames/segN/            Frames desktop 1920px (~150 par segment)
frames/segN/m/          Frames mobile 960px (portrait pour seg1/seg2)
frames/manifest.json    Nombre de frames par set (généré par extract.sh)
scripts/extract.sh      Extraction ffmpeg + conversion cwebp
RECETTE.md              Les points d'overlay et leur % de déclenchement (réglage fin)
netlify.toml            Cache long sur /frames/
```

## Extraction des frames

Sources attendues à la racine : `segment_1 .mp4`, `segment_2 .mp4`, `segment_3.mp4` (1920×1080) + `segment_mobile_1.mp4`, `segment_mobile_2.mp4`, `segment_mobile_3.mp4` (1080×1920).

```bash
./scripts/extract.sh            # fps=10, qualité WebP 75 (défauts)
./scripts/extract.sh 8 70       # si budget poids dépassé : fps 8, qualité 70
```

Budgets (spec §7) : ≤ 60 Mo desktop, ≤ 25 Mo mobile. Mesuré avec les défauts : **~15 Mo desktop, ~13 Mo mobile**.

Prérequis : `ffmpeg` + `cwebp` (`brew install ffmpeg webp`).

## Développement local

```bash
python3 -m http.server 8642
```

Puis http://localhost:8642. Un serveur est requis (fetch du manifest + modules ES).

**QA du fallback reduced-motion** : http://localhost:8642/?static force la version statique (posters + texte + fades simples) sans changer les réglages système.

## Déploiement

- **Netlify** : glisser le dossier sur Netlify Drop, ou connecter le repo — aucune étape de build, `netlify.toml` ajoute un cache immutable sur `/frames/`.
- **Vercel** : `vercel deploy` — projet statique, zéro config.

Avant mise en ligne :
1. Remplacer `VOTRE_ID` dans l'action du formulaire (`index.html`, section contact) par l'identifiant Formspree du compte Cascanics.
2. Vérifier `og:image` et le `canonical` si le domaine final n'est pas `cascanics.com`.
3. Compléter `mentions-legales.html`.

## Points de réglage

| Réglage | Où | Valeur actuelle |
|---|---|---|
| Vitesse de pin par section | `data-pin` sur chaque `<section class="scrub">` | hero 350 vh · cycle 400 vh · orbit 300 vh |
| Lissage du scrub | `scrub` dans `setupScrubSection` (js/main.js) | 0.8 |
| Pacing Lenis | `duration` dans `setupLenis` | 1.1 |
| Seuils d'overlay | `data-in` / `data-out` (%) sur chaque `.ov` — voir RECETTE.md | — |
| Freeze « stamp » des cards | `data-stamp` (%) sur les cards du cycle | 28 / 56 |
| Sens des whips | `data-fx-out="whip-left|whip-right"` | card 01 → gauche, card 02 → droite |
| Teintes d'univers | objet `TINTS` + fenêtres dans js/main.js (§ color tints) | cyan 5–32 · bleu 32–60 · ambre 60–94 |
| Vignette choc | `data-boost="true"` sur l'overlay concerné | overlay « lunette de toilettes » |
| Frames préchargées avant affichage | `preloadHero(scrubber)` → `loadPriority(30, …)` | 30 |
| Seuil navbar | `setupNavbar` | 80 px |

## Performance (mesuré en dev)

- Scroll continu à travers le hero : **60 fps**, pire frame 17,5 ms.
- LCP : première frame servie en `<img fetchpriority="high">` + `<link rel="preload">` avant l'init canvas.
- Chargement : 30 premières frames du seg1 en priorité (loader avec barre si > 1,5 s), puis seg1 complet, puis seg2/seg3 en `requestIdleCallback`.
- DPR canvas plafonné à 2 (desktop) / 1,5 (mobile).

## Accessibilité

- Tous les overlays sont du texte réel dans le DOM (jamais d'images de texte).
- `prefers-reduced-motion` : version statique complète (posters + textes empilés + fade simple).
- Focus visibles (`:focus-visible`), skip-link vers le formulaire, labels sur tous les champs, statut d'envoi en `aria-live`.
