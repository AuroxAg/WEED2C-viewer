/* ============================================================
   Aurox Dataset Viewers — landing / chooser
   Renders the dataset cards from data/datasets.json (the registry).
   Adding a dataset = adding an entry there; no code change needed.
   ============================================================ */
"use strict";

const fmt = (n) => Number(n).toLocaleString("en-US");

boot();

async function boot() {
  let reg;
  try {
    const res = await fetch("data/datasets.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    reg = await res.json();
  } catch (err) {
    document.getElementById("dsGrid").innerHTML =
      `<p class="empty">Could not load <code>data/datasets.json</code>.<br><small>${err.message}</small></p>`;
    return;
  }

  const site = reg.site || {};
  document.getElementById("homeEyebrow").textContent = site.eyebrow || "";
  document.getElementById("homeTitle").innerHTML = site.titleHtml || "Dataset Viewers";
  document.getElementById("homeLede").textContent = site.lede || "";
  document.getElementById("homeNote").textContent = site.note || "";

  const datasets = reg.datasets || [];
  document.getElementById("dsCount").textContent =
    `${datasets.length} available`;

  const grid = document.getElementById("dsGrid");
  grid.innerHTML = datasets.map(cardHtml).join("");

  // Cover images may not exist before the build (thumbs are generated) —
  // fall back to a branded gradient placeholder instead of a broken image.
  grid.querySelectorAll("img.ds-card__img").forEach((img) => {
    img.addEventListener("error", () => {
      const media = img.closest(".ds-card__media");
      if (media) media.classList.add("is-placeholder");
      img.remove();
    });
  });
}

function cardHtml(d) {
  const href = `viewer.html?dataset=${encodeURIComponent(d.id)}`;
  const accent = d.accent || "var(--accent)";
  const tags = (d.tags || [])
    .map((t) => `<span class="ds-tag">${t}</span>`)
    .join("");
  const stats = d.stats || {};
  const cover = d.cover
    ? `<img class="ds-card__img" loading="lazy" decoding="async" alt="${d.name}" src="${encodeURI(d.cover)}" />`
    : "";
  return `
    <a class="ds-card" href="${href}" style="--ds-accent:${accent}">
      <div class="ds-card__media">
        ${cover}
        <span class="ds-card__task">${d.task || ""}</span>
      </div>
      <div class="ds-card__body">
        <div class="ds-card__head">
          <h3 class="ds-card__name">${d.name}</h3>
          <span class="ds-card__go" aria-hidden="true">Open →</span>
        </div>
        <p class="ds-card__tagline">${(d.card && d.card.tagline) || ""}</p>
        <p class="ds-card__blurb">${(d.card && d.card.blurb) || ""}</p>
        <dl class="ds-stats">
          <div><dt>Images</dt><dd>${fmt(stats.images || 0)}</dd></div>
          <div><dt>Annotations</dt><dd>${fmt(stats.annotations || 0)}</dd></div>
          <div><dt>Classes</dt><dd>${fmt(stats.classes || 0)}</dd></div>
        </dl>
        <div class="ds-card__tags">${tags}</div>
      </div>
    </a>`;
}
