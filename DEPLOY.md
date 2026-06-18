# Deploying on Render

The dataset (≈389 MB) and the generated images (≈433 MB) are **not committed to
git** — the build downloads the `.zip` and generates everything. The deploy
therefore needs a build step.

## Dataset mirror (already set up)

The dataset is downloaded at build time from a **public GitHub Release** of this repo:

```
https://github.com/AuroxAg/WEED2C-viewer/releases/download/dataset-v1/WEED2C-Dataset.zip
```

This URL is already the default in `build.sh`, the `Dockerfile` and `render.yaml`
— nothing to configure. To use a different source, set `DATASET_URL`. The original
source (UFGD) remains valid as an alternative.

---

## Option A — Static Site (recommended)

Global CDN, free, no spin-down. Uses `render.yaml` + `build.sh`.

1. Push the repository to GitHub/GitLab.
2. On Render: **New + → Blueprint** and select the repo (it reads `render.yaml`).
   - Or **New + → Static Site** manually:
     - **Build Command:** `bash build.sh`
     - **Publish Directory:** `public`
3. **Create**. The build installs Pillow/numpy in a venv, downloads the dataset,
   runs `prepare.py` and publishes `public/`.

`build.sh` relies on `python3` being present in Render's build environment (it is,
by default). If it ever isn't, use Option B.

---

## Option B — Docker (Web Service, fully reproducible)

Independent of Render's build environment — the image prepares the dataset and
serves it with nginx. On the free plan there is spin-down (~50 s cold start).

1. On Render: **New + → Web Service** → **Docker** pointing at the repo.
2. (Optional) set `DATASET_URL` as a Docker build argument to override the source.
3. Render injects `PORT`; nginx already listens on it (`NGINX_ENVSUBST_FILTER=PORT`).

Test locally:

```bash
docker build -t weed2c .
docker run --rm -e PORT=8080 -p 8080:8080 weed2c
# open http://localhost:8080
```

---

## Notes

- **Deploy size:** ~433 MB (391 MB full-resolution images + 42 MB thumbnails). The
  grid uses thumbnails; only the lightbox loads the full image.
- **Build time:** dominated by the `.zip` download; generation takes ~10 s.
- **Rebuilds:** every `git push` rebuilds (re-downloading the dataset). The public
  Release mirror on GitHub's CDN keeps this fast.
- **Stage mapping:** if the authors confirm the real per-area stage, edit
  `SESSION_STAGE` in `prepare.py` and redeploy.
