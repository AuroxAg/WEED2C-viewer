# Self-contained build: prepares every dataset, then serves it with nginx.
# Works on Render (Docker web service), Fly, Cloud Run, or locally.

# ---- stage 1: prepare images, thumbnails, manifests, assemble public/ ----
FROM python:3.12-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY prepare.py build.sh index.html viewer.html styles.css theme.js home.js app.js ./
COPY assets ./assets
COPY data ./data
# Dataset source URLs (override with --build-arg). Both default to this repo's
# public Release mirrors.
ARG WEED2C_URL=https://github.com/AuroxAg/WEED2C-viewer/releases/download/dataset-v1/WEED2C-Dataset.zip
ARG SOYCOTTON_URL=https://github.com/AuroxAg/WEED2C-viewer/releases/download/soycotton-v1/SoyCotton.zip
RUN WEED2C_URL="$WEED2C_URL" SOYCOTTON_URL="$SOYCOTTON_URL" bash build.sh

# ---- stage 2: nginx static server ----
FROM nginx:1.27-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
# Only substitute ${PORT} in the template (leave nginx's own $uri etc. intact).
ENV NGINX_ENVSUBST_FILTER=PORT
ENV PORT=10000
EXPOSE 10000
