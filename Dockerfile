# Self-contained build: prepares the dataset, then serves it with nginx.
# Works on Render (Docker web service), Fly, Cloud Run, or locally.

# ---- stage 1: prepare images, thumbnails, manifest ----
FROM python:3.12-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir Pillow numpy
COPY prepare.py index.html styles.css app.js ./
COPY assets ./assets
# Default: this repo's public Release mirror. Override: --build-arg DATASET_URL=...
ARG DATASET_URL=https://github.com/AuroxAg/WEED2C-viewer/releases/download/dataset-v1/WEED2C-Dataset.zip
RUN curl -fSL --retry 3 --retry-delay 5 "$DATASET_URL" -o /tmp/w2c.zip \
 && WEED2C_ZIP=/tmp/w2c.zip python3 prepare.py \
 && rm -f /tmp/w2c.zip

# ---- stage 2: nginx static server ----
FROM nginx:1.27-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/index.html /app/styles.css /app/app.js /usr/share/nginx/html/
COPY --from=build /app/assets  /usr/share/nginx/html/assets
COPY --from=build /app/data    /usr/share/nginx/html/data
COPY --from=build /app/images  /usr/share/nginx/html/images
COPY --from=build /app/thumbs  /usr/share/nginx/html/thumbs
COPY nginx.conf /etc/nginx/templates/default.conf.template
# Only substitute ${PORT} in the template (leave nginx's own $uri etc. intact).
ENV NGINX_ENVSUBST_FILTER=PORT
ENV PORT=10000
EXPOSE 10000
