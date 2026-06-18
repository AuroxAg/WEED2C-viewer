/* ============================================================
   Aurox Dataset Viewer — generic, config-driven viewer logic
   ------------------------------------------------------------
   Loads the registry (data/datasets.json) + the selected dataset's
   manifest (data/<id>.json) and renders entirely from them, so the
   same page serves any dataset. Pick the dataset via ?dataset=<id>.
   ============================================================ */
"use strict";

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = (n) => Number(n).toLocaleString("en-US");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const state = {
  reg: null,
  ds: null,                // registry entry for the active dataset
  data: null,              // manifest
  imgBase: "", thumbBase: "",
  classVis: [],            // per-class theme-aware display color
  classes: new Set(),      // selected class indices
  matchMode: "any",        // any | all | only
  facetSel: [],            // [Set] of selected value indices, per facet
  badgeFacet: -1,          // facet index used for the card badge (or -1)
  density: new Set(),      // selected density ids
  search: "",
  sort: "name",
  boxesOnGrid: false,
  filtered: [],
  lbIndex: -1,
};

const enc      = (file) => state.imgBase + encodeURIComponent(file);
const encThumb = (file) => state.thumbBase + encodeURIComponent(file);

/* ---------------- Boot ---------------- */
init();

async function init() {
  let reg;
  try {
    const res = await fetch("data/datasets.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    reg = await res.json();
  } catch (err) {
    return fail(`Could not load <code>data/datasets.json</code>.<br><small>${esc(err.message)}</small>`);
  }
  state.reg = reg;

  const params = new URLSearchParams(location.search);
  const wanted = params.get("dataset");
  const ds = reg.datasets.find((d) => d.id === wanted) || reg.datasets[0];
  if (!ds) return fail("No datasets are configured.");
  state.ds = ds;
  state.imgBase = `images/${ds.id}/`;
  state.thumbBase = `thumbs/${ds.id}/`;

  buildDatasetSwitch();

  try {
    const res = await fetch(`data/${ds.id}.json`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.data = await res.json();
  } catch (err) {
    return fail(`Could not load <code>data/${esc(ds.id)}.json</code>.<br>` +
      `Run <code>python3 prepare.py ${esc(ds.id)}</code> and serve over HTTP.<br><small>${esc(err.message)}</small>`);
  }

  state.facetSel = state.data.facets.map(() => new Set());
  state.badgeFacet = state.data.facets.findIndex((f) => f.badge);

  document.title = `${ds.name} · Dataset Viewer — Aurox`;
  refreshVisColors();
  renderHero();
  renderTelemetry();
  renderLegend();
  renderClassChips();
  renderFacets();
  renderDensityChips();
  configureSort();
  renderCredits();
  bindControls();
  document.addEventListener("themechange", onThemeChange);
  apply();
}

function fail(html) {
  $("#gallery").innerHTML = `<p class="empty">${html}</p>`;
}

/* ---------------- Theme-aware colors ---------------- */
function parseHex(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(rgb, target, t) {
  const r = Math.round(rgb[0] + (target[0] - rgb[0]) * t);
  const g = Math.round(rgb[1] + (target[1] - rgb[1]) * t);
  const b = Math.round(rgb[2] + (target[2] - rgb[2]) * t);
  return `rgb(${r},${g},${b})`;
}
function displayColor(hex) {
  const rgb = parseHex(hex);
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  // lighten on dark surfaces, gently darken on the bone-white light surface
  return dark ? mix(rgb, [236, 229, 211], 0.34) : mix(rgb, [14, 14, 11], 0.12);
}
function refreshVisColors() {
  state.classVis = state.data.classes.map((c) => displayColor(c.color));
}
function onThemeChange() {
  refreshVisColors();
  renderLegend();
  apply();
  if (state.lbIndex >= 0) drawStageBoxes();
}

/* ---------------- Dataset switch ---------------- */
function buildDatasetSwitch() {
  const sel = $("#dsSwitch");
  if (!sel) return;
  sel.innerHTML = state.reg.datasets
    .map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`)
    .join("");
  sel.value = state.ds.id;
  sel.addEventListener("change", () => {
    location.href = `viewer.html?dataset=${encodeURIComponent(sel.value)}`;
  });
}

/* ---------------- Hero / static panels ---------------- */
function renderHero() {
  const h = state.ds.hero || {};
  $("#heroEyebrow").textContent = h.eyebrow || "";
  $("#heroTitle").innerHTML = h.titleHtml || esc(state.ds.name);
  $("#heroLede").textContent = h.lede || "";
}

function renderTelemetry() {
  const d = state.data;
  const items = [
    ["Images", fmt(d.totals.images)],
    ["Annotations", fmt(d.totals.boxes)],
    ["Classes", d.classes.length],
  ];
  const coll = d.facets.find((f) => f.id === "collection");
  if (coll) items.push(["Collections", coll.values.length]);
  else items.push(["Avg / image", Math.round(d.totals.boxes / Math.max(1, d.totals.images))]);
  $("#telemetry").innerHTML = items
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");
}

function renderLegend() {
  $("#legend").innerHTML = state.data.classes
    .map((c, i) => `<span><i style="background:${state.classVis[i]}"></i>${esc(c.label)}</span>`)
    .join("");
}

function renderClassChips() {
  $("#classLegend").textContent = state.data.classLabel || "Class";
  const wrap = $('[data-role="classes"]');
  wrap.innerHTML = state.data.classes
    .map((c, i) => `
      <button class="chip" type="button" data-class="${i}" aria-pressed="false" title="${esc(c.sci || "")}">
        <span class="chip__swatch" style="background:${state.classVis[i]}"></span>${esc(c.label)}
        <span class="chip__n">${fmt(c.count)}</span>
      </button>`)
    .join("");
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-class]");
    if (!b) return;
    toggleSet(state.classes, +b.dataset.class, b);
    apply();
  });
}

function renderFacets() {
  const host = $("#facetFilters");
  host.innerHTML = state.data.facets.map((f, fi) => {
    const est = f.estimated
      ? ` <span class="est-tag" title="${esc(f.note || "")}">estimated</span>` : "";
    const chips = f.values.map((v, vi) => {
      const parts = [];
      if (v.desc) parts.push(v.desc);
      if (v.sub) parts.push(v.sub);
      if (v.canopy != null) parts.push(`canopy ${Math.round(v.canopy * 100)}%`);
      const cls = f.badge ? "chip chip--stage" : "chip";
      return `<button class="${cls}" type="button" data-facet="${fi}" data-val="${vi}"
                aria-pressed="false" title="${esc(parts.join(" · "))}">
                ${esc(v.label)}<span class="chip__n">${fmt(v.count)}</span></button>`;
    }).join("");
    return `<fieldset class="filter-group">
        <legend class="filter-label">${esc(f.label)}${est}</legend>
        <div class="chips">${chips}</div>
      </fieldset>`;
  }).join("");

  host.addEventListener("click", (e) => {
    const b = e.target.closest("[data-facet]");
    if (!b) return;
    toggleSet(state.facetSel[+b.dataset.facet], +b.dataset.val, b);
    apply();
  });
}

function renderDensityChips() {
  const wrap = $('[data-role="density"]');
  wrap.innerHTML = state.data.density
    .map((d) => `
      <button class="chip" type="button" data-density="${esc(d.id)}" aria-pressed="false">
        ${esc(d.label)}<span class="chip__n">${esc(d.hint)}</span>
      </button>`)
    .join("");
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-density]");
    if (!b) return;
    toggleSet(state.density, b.dataset.density, b);
    apply();
  });
}

function configureSort() {
  const opt = $('#sort option[data-metric="canopy"]');
  if (opt && !(state.data.metrics && state.data.metrics.canopy)) opt.remove();
}

function renderCredits() {
  const c = state.ds.credits || {};
  const links = (c.links || [])
    .map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`)
    .join("");
  const facts = (c.facts || [])
    .map(([dt, dd]) => `<dt>${esc(dt)}</dt><dd>${dd}</dd>`)   // dd may hold trusted <em>/<strong>
    .join("");
  $("#credits").innerHTML = `
    <div class="credits__inner">
      <div class="credits__col">
        <h2 class="credits__title">Credits &amp; Citation</h2>
        <p class="credits__lead">${c.lead || ""}</p>
        <blockquote class="citation">${c.citationHtml || ""}</blockquote>
        <p class="credits__links">${links}</p>
      </div>
      <div class="credits__col credits__col--meta">
        <dl class="credits__facts">${facts}</dl>
        <p class="credits__note">${c.note || ""}</p>
      </div>
    </div>`;
  const f = c.footer || {};
  $("#footSource").innerHTML = f.href
    ? `<a href="${esc(f.href)}" target="_blank" rel="noopener">${esc(f.text || "")}</a>`
    : esc(f.text || "");
}

function toggleSet(set, key, btn) {
  if (set.has(key)) { set.delete(key); btn.setAttribute("aria-pressed", "false"); }
  else { set.add(key); btn.setAttribute("aria-pressed", "true"); }
}

/* ---------------- Controls ---------------- */
function bindControls() {
  $("#search").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    apply();
  });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; apply(); });
  $("#boxesToggle").addEventListener("change", (e) => {
    state.boxesOnGrid = e.target.checked; apply();
  });
  $('[data-role="matchmode"]').addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    state.matchMode = b.dataset.mode;
    $$('[data-role="matchmode"] button').forEach((x) => x.classList.toggle("is-active", x === b));
    apply();
  });
  $("#resetBtn").addEventListener("click", resetFilters);

  $("#lightbox").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeLightbox();
    const nav = e.target.closest("[data-nav]");
    if (nav) step(+nav.dataset.nav);
  });
  $("#lbBoxes").addEventListener("change", (e) =>
    $("#stageBoxes").classList.toggle("hidden", !e.target.checked));
  $("#lbLabels").addEventListener("change", (e) =>
    $("#stageBoxes").classList.toggle("no-labels", !e.target.checked));
  document.addEventListener("keydown", (e) => {
    if ($("#lightbox").hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
  });
}

function resetFilters() {
  state.classes.clear();
  state.facetSel.forEach((s) => s.clear());
  state.density.clear();
  state.search = ""; state.matchMode = "any"; state.sort = "name";
  $("#search").value = "";
  $("#sort").value = "name";
  $$(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
  $$('[data-role="matchmode"] button').forEach((x) =>
    x.classList.toggle("is-active", x.dataset.mode === "any"));
  apply();
}

/* ---------------- Filtering ---------------- */
function totalBoxes(img) { return img.n.reduce((a, b) => a + b, 0); }

function matchClasses(img) {
  if (state.classes.size === 0) return true;
  const sel = [...state.classes];
  if (state.matchMode === "any") return sel.some((ci) => img.n[ci] > 0);
  if (state.matchMode === "all") return sel.every((ci) => img.n[ci] > 0);
  return img.n.every((c, ci) => state.classes.has(ci) ? c > 0 : c === 0);
}

function matchDensity(img) {
  if (state.density.size === 0) return true;
  const t = totalBoxes(img);
  return state.data.density.some((d) =>
    state.density.has(d.id) && t >= d.min && (d.max == null || t <= d.max));
}

function matchFacets(img) {
  return state.data.facets.every((f, fi) => {
    const set = state.facetSel[fi];
    return set.size === 0 || set.has(img[f.key]);
  });
}

function apply() {
  let out = state.data.images.filter((img) =>
    matchFacets(img) &&
    matchClasses(img) &&
    matchDensity(img) &&
    (state.search === "" || img.f.toLowerCase().includes(state.search))
  );

  if (state.sort === "most") out.sort((a, b) => totalBoxes(b) - totalBoxes(a));
  else if (state.sort === "least") out.sort((a, b) => totalBoxes(a) - totalBoxes(b));
  else if (state.sort === "canopy") out.sort((a, b) => (b.cv ?? -1) - (a.cv ?? -1));
  else out.sort((a, b) => a.f.localeCompare(b.f, "en", { numeric: true }));

  state.filtered = out;
  renderGallery();
  const total = state.data.totals.images;
  $("#resultCount").innerHTML =
    `<strong>${out.length}</strong> of ${total} images` +
    (out.length ? ` · <strong>${fmt(out.reduce((s, i) => s + totalBoxes(i), 0))}</strong> detections` : "");
}

/* ---------------- Gallery ---------------- */
function renderGallery() {
  const gal = $("#gallery");
  $("#empty").hidden = state.filtered.length > 0;
  const frag = document.createDocumentFragment();
  state.filtered.forEach((img, idx) => frag.appendChild(buildCard(img, idx)));
  gal.replaceChildren(frag);
}

function buildCard(img, idx) {
  const c = document.createElement("button");
  c.className = "card";
  c.type = "button";
  c.dataset.idx = idx;

  const total = totalBoxes(img);
  const tags = state.data.classes
    .map((cls, i) => img.n[i] > 0
      ? `<span class="tag"><i style="background:${state.classVis[i]}"></i>${esc(cls.label)} ${img.n[i]}</span>`
      : "")
    .join("");
  const badge = badgeFor(img);

  c.innerHTML = `
    <div class="card__media">
      <img loading="lazy" decoding="async" src="${encThumb(img.f)}" alt="${esc(img.f)}"
           width="${img.w}" height="${img.h}" />
      ${state.boxesOnGrid ? cardBoxes(img) : ""}
      ${badge ? `<span class="card__stage" title="${esc(badge.title)}">${esc(badge.label)}</span>` : ""}
      <span class="card__total">${total}</span>
    </div>
    <div class="card__body">
      <span class="card__name">${esc(img.f)}</span>
      <div class="card__tags">${tags}</div>
    </div>`;
  c.addEventListener("click", () => openLightbox(idx));
  return c;
}

function badgeFor(img) {
  if (state.badgeFacet < 0) return null;
  const f = state.data.facets[state.badgeFacet];
  const v = f.values[img[f.key]];
  if (!v) return null;
  return { label: v.label, title: (f.estimated ? "Estimated · " : "") + (v.desc || f.label) };
}

function boxStyle(img, ci, x, y, X, Y) {
  const l = (x / img.w * 100).toFixed(3);
  const t = (y / img.h * 100).toFixed(3);
  const w = ((X - x) / img.w * 100).toFixed(3);
  const h = ((Y - y) / img.h * 100).toFixed(3);
  return `--c:${state.classVis[ci]};left:${l}%;top:${t}%;width:${w}%;height:${h}%`;
}

function cardBoxes(img) {
  if (!img.b.length) return "";
  const spans = img.b
    .map(([ci, x, y, X, Y]) => `<b style="${boxStyle(img, ci, x, y, X, Y)}"></b>`)
    .join("");
  return `<div class="card__boxes">${spans}</div>`;
}

/* ---------------- Lightbox ---------------- */
function openLightbox(idx) {
  state.lbIndex = idx;
  renderLightbox();
  $("#lightbox").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  $("#lightbox").hidden = true;
  state.lbIndex = -1;
  document.body.style.overflow = "";
}
function step(dir) {
  const n = state.filtered.length;
  if (!n) return;
  state.lbIndex = (state.lbIndex + dir + n) % n;
  renderLightbox();
}

function renderLightbox() {
  const img = state.filtered[state.lbIndex];
  if (!img) return;
  const d = state.data;
  const total = totalBoxes(img);

  const stageImg = $("#stageImg");
  stageImg.src = enc(img.f);
  stageImg.alt = img.f;
  stageImg.onload = drawStageBoxes;
  requestAnimationFrame(drawStageBoxes);

  $("#metaFile").textContent = img.f;
  $("#metaOpen").href = enc(img.f);

  const rows = [];
  d.facets.forEach((f) => {
    const v = f.values[img[f.key]];
    if (!v) return;
    const est = f.estimated ? ` <span class="est-tag est-tag--sm">est.</span>` : "";
    rows.push([`${esc(f.label)}${est}`, `<span title="${esc(v.desc || "")}">${esc(v.label)}</span>`]);
  });
  if (d.metrics && d.metrics.canopy)
    rows.push(["Canopy", img.cv != null ? `${Math.round(img.cv * 100)}%` : "—"]);
  rows.push(["Resolution", `${img.w}×${img.h}`]);
  rows.push(["Annotations", total]);
  $("#metaGrid").innerHTML = rows.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join("");

  const maxN = Math.max(1, ...img.n);
  $("#metaCounts").innerHTML = d.classes.map((cls, i) => {
    const v = img.n[i];
    const pct = (v / maxN * 100).toFixed(1);
    return `
      <div>
        <div class="count-row">
          <span class="sw" style="background:${state.classVis[i]}"></span>
          <span class="nm">${esc(cls.label)} <span class="sci">· ${esc(cls.sci || "")}</span></span>
          <span class="val">${v}</span>
        </div>
        <div class="count-bar"><i style="width:${pct}%;background:${state.classVis[i]}"></i></div>
      </div>`;
  }).join("");
}

function drawStageBoxes() {
  const img = state.filtered[state.lbIndex];
  if (!img) return;
  $("#stageBoxes").innerHTML = img.b.map(([ci, x, y, X, Y]) => {
    const lbl = state.data.classes[ci].label;
    return `<div class="bx" style="${boxStyle(img, ci, x, y, X, Y)}">
      <span class="lbl">${esc(lbl)}</span></div>`;
  }).join("");
}
