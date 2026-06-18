# Deploying on Render

The dataset archives and the generated images are **not committed to git** — the
build downloads each `.zip` and generates everything. The deploy therefore needs
a build step.

## Datasets and their sources

`build.sh` builds every id listed in `DATASETS` (default `weed2c soycotton`). For
each id `<x>`, it downloads the archive from `<X>_URL` (id upper-cased) and runs
`prepare.py <x>`. If an `<X>_URL` is empty, that dataset's **image build is
skipped** — its committed manifest still ships, but its thumbnails/full images
won't exist, so use a hosted mirror.

| id | env var | default | notes |
|----|---------|---------|-------|
| `weed2c` | `WEED2C_URL` | public Release mirror (`dataset-v1`) | ready to deploy |
| `soycotton` | `SOYCOTTON_URL` | public Release mirror (`soycotton-v1`) | ready to deploy |

Both default to this repo's public GitHub Release mirrors — nothing to configure:

```
https://github.com/AuroxAg/WEED2C-viewer/releases/download/dataset-v1/WEED2C-Dataset.zip
https://github.com/AuroxAg/WEED2C-viewer/releases/download/soycotton-v1/SoyCotton.zip
```

The SoyCotton-Leafs archive is CC BY 4.0 (canonical:
<https://doi.org/10.6084/m9.figshare.28466636.v3>); the Release asset is only a
deploy mirror. To use a different source, override the `*_URL` env var.

---

## Option A — Static Site (recommended)

Global CDN, free, no spin-down. Uses `render.yaml` + `build.sh`.

1. Push the repository to GitHub/GitLab.
2. On Render: **New + → Blueprint** and select the repo (it reads `render.yaml`).
   - Or **New + → Static Site** manually: **Build Command** `bash build.sh`,
     **Publish Directory** `public`.
3. Set `SOYCOTTON_URL` (and adjust `DATASETS` if needed) in the service env.
4. **Create**. The build installs Pillow/numpy in a venv, downloads each dataset,
   runs `prepare.py` per dataset and publishes `public/`.

---

## Option B — Docker (Web Service, fully reproducible)

Independent of Render's build environment — the image prepares the datasets and
serves them with nginx. On the free plan there is spin-down (~50 s cold start).

1. On Render: **New + → Web Service** → **Docker** pointing at the repo.
2. (Optional) set `WEED2C_URL` / `SOYCOTTON_URL` as Docker build args.
3. Render injects `PORT`; nginx already listens on it (`NGINX_ENVSUBST_FILTER=PORT`).

Test locally:

```bash
docker build -t aurox-viewers \
  --build-arg SOYCOTTON_URL="https://…/SoyCotton.zip" .
docker run --rm -e PORT=8080 -p 8080:8080 aurox-viewers
# open http://localhost:8080
```

---

## Notes

- **Deploy size:** WEED2C ≈ 433 MB (391 MB images + 42 MB thumbs); SoyCotton adds
  a similar order of magnitude. The grid uses thumbnails; only the lightbox loads
  the full image.
- **Build time:** dominated by the `.zip` downloads; generation takes ~10 s each.
- **Rebuilds:** every `git push` rebuilds (re-downloading the datasets). Release
  mirrors on GitHub's CDN keep this fast.
- **Adding a dataset:** see README → *Adding a dataset*, then add its id to
  `DATASETS` and set its `<ID>_URL`.
- **WEED2C stage mapping:** if the authors confirm the real per-area stage, edit
  `WEED2C_SESSION_STAGE` in `prepare.py` and redeploy.
