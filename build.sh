#!/usr/bin/env bash
# Render Static Site build: fetch each dataset archive, generate
# images/thumbs/manifests, and assemble a clean ./public to publish.
#
# Datasets are listed in DATASETS. For each <id>, the source archive URL comes
# from the env var <ID>_URL (id upper-cased), and prepare.py reads it via
# <ID>_ZIP. Add a dataset by appending its id here and setting its *_URL.
set -euo pipefail

DATASETS="${DATASETS:-weed2c soycotton}"

# Default download URLs (override per dataset with <ID>_URL).
# Original WEED2C source: http://evertontetila.ws.ufgd.edu.br/Datasets/WEED2C-Dataset.zip
WEED2C_URL="${WEED2C_URL:-https://github.com/AuroxAg/WEED2C-viewer/releases/download/dataset-v1/WEED2C-Dataset.zip}"
# SoyCotton-Leafs (CC BY 4.0): public Release mirror of this repo.
# Canonical source: https://doi.org/10.6084/m9.figshare.28466636.v3
SOYCOTTON_URL="${SOYCOTTON_URL:-https://github.com/AuroxAg/WEED2C-viewer/releases/download/soycotton-v1/SoyCotton.zip}"

echo "→ Python: $(python3 --version)"
echo "→ Creating virtualenv"
python3 -m venv /tmp/venv
# shellcheck disable=SC1091
. /tmp/venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet Pillow numpy

for id in $DATASETS; do
  UP="$(echo "$id" | tr '[:lower:]' '[:upper:]')"
  url_var="${UP}_URL"; url="${!url_var:-}"
  zip="/tmp/${id}.zip"

  if [ -z "$url" ] && [ ! -f "$zip" ]; then
    echo "⚠ ${id}: no ${UP}_URL set and no $zip — skipping image build (manifest stays committed)."
    continue
  fi
  if [ ! -f "$zip" ]; then
    echo "→ ${id}: downloading $url"
    if [ -n "${DATASET_TOKEN:-}" ]; then
      curl -fSL --retry 3 --retry-delay 5 -H "Authorization: Bearer ${DATASET_TOKEN}" "$url" -o "$zip"
    else
      curl -fSL --retry 3 --retry-delay 5 "$url" -o "$zip"
    fi
  fi
  echo "→ ${id}: archive $(du -h "$zip" | cut -f1)"
  echo "→ ${id}: preparing images, thumbnails and manifest"
  env "${UP}_ZIP=$zip" python3 prepare.py "$id"
done

echo "→ Assembling ./public"
rm -rf public
mkdir -p public
cp index.html viewer.html styles.css theme.js home.js app.js public/
cp -r assets data public/
# images/ and thumbs/ may not exist if every dataset was skipped
[ -d images ] && mv images public/ || true
[ -d thumbs ] && mv thumbs public/ || true

echo "→ public/ ready: $(du -sh public | cut -f1), $(find public -type f | wc -l | tr -d ' ') files"
