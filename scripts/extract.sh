#!/usr/bin/env bash
# Cascanics — extraction des frames de scrub depuis les MP4 sources.
#
# Usage : ./scripts/extract.sh [fps] [qualité]
#   fps      : cadence d'extraction (défaut 10 ; passer à 8 si budget poids dépassé)
#   qualité  : qualité WebP 0-100 (défaut 75)
#
# Sorties :
#   frames/segN/frame_XXX.webp      — set desktop (1920px de large)
#   frames/segN/m/frame_XXX.webp    — set mobile  (960px de large, source portrait si dispo)
#   frames/manifest.json            — nombre de frames par set (lu par js/scrub.js)
#
# Budgets cibles : ≤ 60 Mo desktop, ≤ 25 Mo mobile (cf. spec §7).

set -euo pipefail
cd "$(dirname "$0")/.."

FPS="${1:-10}"
Q="${2:-75}"

# Sources — attention : segment_1 et segment_2 ont un espace avant .mp4
declare -a DESKTOP=("segment_1 .mp4" "segment_2 .mp4" "segment_3.mp4")
declare -a MOBILE=("segment_mobile_1.mp4" "segment_mobile_2.mp4" "segment_mobile_3.mp4")

# ffmpeg local sans libwebp : on passe par des PNG temporaires puis cwebp (parallélisé)
extract () {
  local src="$1" out="$2" width="$3"
  mkdir -p "$out"
  rm -f "$out"/frame_*.webp "$out"/frame_*.png
  ffmpeg -y -v error -i "$src" \
    -vf "fps=${FPS},scale=${width}:-2:flags=lanczos" \
    "$out/frame_%03d.png"
  ls "$out"/frame_*.png | xargs -P "$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" -I{} \
    sh -c 'cwebp -quiet -q '"$Q"' "{}" -o "${0%.png}.webp"' {}
  rm -f "$out"/frame_*.png
}

echo "Extraction desktop (1920px, fps=${FPS}, q=${Q})…"
for i in 1 2 3; do
  extract "${DESKTOP[$((i-1))]}" "frames/seg${i}" 1920
done

echo "Extraction mobile (960px)…"
for i in 1 2 3; do
  extract "${MOBILE[$((i-1))]}" "frames/seg${i}/m" 960
done

# Manifest : compte des frames par set
count () { ls "$1"/frame_*.webp 2>/dev/null | wc -l | tr -d ' '; }
cat > frames/manifest.json <<EOF
{
  "fps": ${FPS},
  "seg1": { "desktop": $(count frames/seg1), "mobile": $(count frames/seg1/m) },
  "seg2": { "desktop": $(count frames/seg2), "mobile": $(count frames/seg2/m) },
  "seg3": { "desktop": $(count frames/seg3), "mobile": $(count frames/seg3/m) }
}
EOF

echo "— Poids par set —"
for i in 1 2 3; do
  echo "seg${i} desktop : $(du -sh "frames/seg${i}" | cut -f1) (dont mobile : $(du -sh "frames/seg${i}/m" | cut -f1))"
done
echo "Total frames/ : $(du -sh frames | cut -f1)"
echo "Manifest écrit : frames/manifest.json"
