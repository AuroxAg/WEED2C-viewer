#!/usr/bin/env bash
# Render Static Site build: fetch the dataset, generate images/thumbs/manifest,
# and assemble a clean ./public directory to publish.
set -euo pipefail

ZIP="${WEED2C_ZIP:-/tmp/weed2c-dataset.zip}"
# Default: this repo's public Release mirror. Override with DATASET_URL.
# Original source: http://evertontetila.ws.ufgd.edu.br/Datasets/WEED2C-Dataset.zip
URL="${DATASET_URL:-https://github.com/AuroxAg/WEED2C-viewer/releases/download/dataset-v1/WEED2C-Dataset.zip}"

echo "→ Python: $(python3 --version)"
echo "→ Creating virtualenv"
python3 -m venv /tmp/venv
# shellcheck disable=SC1091
. /tmp/venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet Pillow numpy

if [ ! -f "$ZIP" ]; then
  echo "→ Downloading dataset: $URL"
  if [ -n "${DATASET_TOKEN:-}" ]; then
    # private GitHub Release asset: authorize the github.com request; curl drops
    # the header on the cross-host redirect to the signed CDN URL (as intended).
    curl -fSL --retry 3 --retry-delay 5 -H "Authorization: Bearer ${DATASET_TOKEN}" "$URL" -o "$ZIP"
  else
    curl -fSL --retry 3 --retry-delay 5 "$URL" -o "$ZIP"
  fi
fi
echo "→ Dataset: $(du -h "$ZIP" | cut -f1)"

echo "→ Preparing images, thumbnails and manifest"
WEED2C_ZIP="$ZIP" python3 prepare.py

echo "→ Assembling ./public"
rm -rf public
mkdir -p public
cp index.html styles.css app.js public/
cp -r assets data public/
mv images thumbs public/          # instant move (same filesystem)

echo "→ public/ ready: $(du -sh public | cut -f1), $(find public -type f | wc -l | tr -d ' ') files"
