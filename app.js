/* ============================================================
   WEED2C Viewer — application logic
   ============================================================ */
"use strict";

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const enc = (file) => "images/" + encodeURIComponent(file);
const encThumb = (file) => "thumbs/" + encodeURIComponent(file);

const DENSITY = [
  { id: "sparse", label: "Sparse", hint: "1–3",  test: (t) => t >= 1 && t <= 3 },
  { id: "medium", label: "Medium", hint: "4–8",  test: (t) => t >= 4 && t <= 8 },
  { id: "dense",  label: "Dense",  hint: "9+",   test: (t) => t >= 9 },
];

const state = {
  data: null,
  classVis: [],          // per-class display color (theme-aware)
  classes: new Set(),    // selected class indices
  matchMode: "any",      // any | all | only
  groups: new Set(),     // selected group indices
  stages: new Set(),     // selected stage indices
  density: new Set(),    // selected density ids
  search: "",
  sort: "name",
  boxesOnGrid: false,
  filtered: [],          // current filtered image list (objects)
  lbIndex: -1,
};

/* ---------------- Boot ---------------- */
init();

async function init() {
  initTheme();
  try {
    const res = await fetch("data/index.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.data = await res.json();
  } catch (err) {
    $("#gallery").innerHTML =
      `<p class="empty">Could not load <code>data/index.json</code>.<br>` +
      `Run <code>python3 prepare.py</code> and serve the folder over HTTP.<br><small>${err.message}</small></p>`;
    return;
  }
  refreshVisColors();
  renderTelemetry();
  renderLegend();
  renderClassChips();
  renderStageChips();
  renderGroupChips();
  renderDensityChips();
  bindControls();
  apply();
}

/* ---------------- Theme ---------------- */
function initTheme() {
  const saved = localStorage.getItem("w2c-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  syncThemeLabel();
  $("#themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("w2c-theme", next);
    syncThemeLabel();
    refreshVisColors();
    renderLegend();
    // re-render so card overlay colors track the theme
    apply();
    if (state.lbIndex >= 0) drawStageBoxes();
  });
}
function syncThemeLabel() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  $("[data-theme-label]").textContent = dark ? "Light" : "Dark";
}
function refreshVisColors() {
  const cs = getComputedStyle(document.documentElement);
  state.classVis = [
    cs.getPropertyValue("--buva-vis").trim(),
    cs.getPropertyValue("--capim-vis").trim(),
  ];
}

/* ---------------- Static panels ---------------- */
function renderTelemetry() {
  const d = state.data;
  const items = [
    ["Images", d.totals.images],
    ["Annotations", d.totals.boxes.toLocaleString("en-US")],
    ["Classes", d.classes.length],
    ["Collections", d.groups.length],
  ];
  $("#telemetry").innerHTML = items
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");
}

function renderLegend() {
  $("#legend").innerHTML = state.data.classes
    .map((c, i) => `<span><i style="background:${state.classVis[i]}"></i>${c.label}</span>`)
    .join("");
}

function renderClassChips() {
  const wrap = $('[data-role="classes"]');
  wrap.innerHTML = state.data.classes
    .map((c, i) => `
      <button class="chip" type="button" data-class="${i}" aria-pressed="false" title="${c.sci}">
        <span class="chip__swatch" style="background:${c.color}"></span>${c.label}
        <span class="chip__n">${c.count}</span>
      </button>`)
    .join("");
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-class]");
    if (!b) return;
    toggleSet(state.classes, +b.dataset.class, b);
    apply();
  });
}

function renderStageChips() {
  const wrap = $('[data-role="stages"]');
  wrap.innerHTML = state.data.stages
    .map((s, i) => `
      <button class="chip chip--stage" type="button" data-stage="${i}" aria-pressed="false"
              title="${s.desc}${s.canopy != null ? ` · canopy ${Math.round(s.canopy * 100)}%` : ""}">
        ${s.label}<span class="chip__n">${s.count}</span>
      </button>`)
    .join("");
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-stage]");
    if (!b) return;
    toggleSet(state.stages, +b.dataset.stage, b);
    apply();
  });
}

function renderGroupChips() {
  const wrap = $('[data-role="groups"]');
  wrap.innerHTML = state.data.groups
    .map((g, i) => `
      <button class="chip" type="button" data-group="${i}" aria-pressed="false">
        ${g.label}<span class="chip__n">${g.count}</span>
      </button>`)
    .join("");
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-group]");
    if (!b) return;
    toggleSet(state.groups, +b.dataset.group, b);
    apply();
  });
}

function renderDensityChips() {
  const wrap = $('[data-role="density"]');
  wrap.innerHTML = DENSITY
    .map((d) => `
      <button class="chip" type="button" data-density="${d.id}" aria-pressed="false">
        ${d.label}<span class="chip__n">${d.hint}</span>
      </button>`)
    .join("");
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-density]");
    if (!b) return;
    toggleSet(state.density, b.dataset.density, b);
    apply();
  });
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
    $$('[data-role="matchmode"] button').forEach((x) =>
      x.classList.toggle("is-active", x === b));
    apply();
  });
  $("#resetBtn").addEventListener("click", resetFilters);

  // Lightbox
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
  state.classes.clear(); state.groups.clear(); state.stages.clear(); state.density.clear();
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
  if (state.matchMode === "any")
    return sel.some((ci) => img.n[ci] > 0);
  if (state.matchMode === "all")
    return sel.every((ci) => img.n[ci] > 0);
  // only: image contains *exactly* the selected classes (nothing else)
  return img.n.every((c, ci) => state.classes.has(ci) ? c > 0 : c === 0);
}

function matchDensity(img) {
  if (state.density.size === 0) return true;
  const t = totalBoxes(img);
  return [...state.density].some((id) => DENSITY.find((d) => d.id === id).test(t));
}

function apply() {
  const imgs = state.data.images;
  let out = imgs.filter((img) =>
    (state.groups.size === 0 || state.groups.has(img.g)) &&
    (state.stages.size === 0 || state.stages.has(img.s)) &&
    matchClasses(img) &&
    matchDensity(img) &&
    (state.search === "" || img.f.toLowerCase().includes(state.search))
  );

  if (state.sort === "most") out.sort((a, b) => totalBoxes(b) - totalBoxes(a));
  else if (state.sort === "least") out.sort((a, b) => totalBoxes(a) - totalBoxes(b));
  else if (state.sort === "canopy") out.sort((a, b) => (b.cv ?? -1) - (a.cv ?? -1));
  else out.sort((a, b) => (a.g - b.g) || a.f.localeCompare(b.f, "en", { numeric: true }));

  state.filtered = out;
  renderGallery();
  const total = state.data.totals.images;
  $("#resultCount").innerHTML =
    `<strong>${out.length}</strong> of ${total} images` +
    (out.length ? ` · <strong>${out.reduce((s, i) => s + totalBoxes(i), 0).toLocaleString("en-US")}</strong> detections` : "");
}

/* ---------------- Gallery ---------------- */
function renderGallery() {
  const gal = $("#gallery");
  const empty = $("#empty");
  empty.hidden = state.filtered.length > 0;

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
      ? `<span class="tag"><i style="background:${cls.color}"></i>${cls.label} ${img.n[i]}</span>`
      : "")
    .join("");

  c.innerHTML = `
    <div class="card__media">
      <img loading="lazy" decoding="async" src="${encThumb(img.f)}" alt="${img.f}"
           width="${img.w}" height="${img.h}" />
      ${state.boxesOnGrid ? cardBoxes(img) : ""}
      <span class="card__stage" title="Estimated stage">${state.data.stages[img.s].label}</span>
      <span class="card__total">${total}</span>
    </div>
    <div class="card__body">
      <span class="card__name">${img.f}</span>
      <div class="card__tags">${tags}</div>
    </div>`;
  c.addEventListener("click", () => openLightbox(idx));
  return c;
}

function cardBoxes(img) {
  if (!img.b.length) return "";
  const spans = img.b.map(([ci, x, y, X, Y]) => {
    const l = (x / img.w * 100).toFixed(3);
    const t = (y / img.h * 100).toFixed(3);
    const w = ((X - x) / img.w * 100).toFixed(3);
    const h = ((Y - y) / img.h * 100).toFixed(3);
    return `<b data-c="${ci}" style="left:${l}%;top:${t}%;width:${w}%;height:${h}%"></b>`;
  }).join("");
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
  // image cached → onload may not fire; draw on next frame as well
  requestAnimationFrame(drawStageBoxes);

  $("#metaFile").textContent = img.f;
  $("#metaOpen").href = enc(img.f);

  const grp = d.groups[img.g];
  const stg = d.stages[img.s];
  const canopy = img.cv != null ? `${Math.round(img.cv * 100)}%` : "—";
  $("#metaGrid").innerHTML = `
    <dt>Stage <span class="est-tag est-tag--sm">est.</span></dt>
      <dd title="${stg.desc}">${stg.label}</dd>
    <dt>Canopy</dt><dd>${canopy}</dd>
    <dt>Collection</dt><dd>${grp.label}</dd>
    <dt>Date</dt><dd>${grp.date}</dd>
    <dt>Resolution</dt><dd>${img.w}×${img.h}</dd>
    <dt>Detections</dt><dd>${total}</dd>`;

  const maxN = Math.max(1, ...img.n);
  $("#metaCounts").innerHTML = d.classes.map((cls, i) => {
    const v = img.n[i];
    const pct = (v / maxN * 100).toFixed(1);
    return `
      <div>
        <div class="count-row">
          <span class="sw" style="background:${state.classVis[i]}"></span>
          <span class="nm">${cls.label} <span class="sci">· ${cls.sci}</span></span>
          <span class="val">${v}</span>
        </div>
        <div class="count-bar"><i style="width:${pct}%;background:${state.classVis[i]}"></i></div>
      </div>`;
  }).join("");
}

function drawStageBoxes() {
  const img = state.filtered[state.lbIndex];
  if (!img) return;
  const layer = $("#stageBoxes");
  layer.innerHTML = img.b.map(([ci, x, y, X, Y]) => {
    const l = (x / img.w * 100).toFixed(3);
    const t = (y / img.h * 100).toFixed(3);
    const w = ((X - x) / img.w * 100).toFixed(3);
    const h = ((Y - y) / img.h * 100).toFixed(3);
    const lbl = state.data.classes[ci].label;
    return `<div class="bx" data-c="${ci}" style="left:${l}%;top:${t}%;width:${w}%;height:${h}%">
      <span class="lbl">${lbl}</span></div>`;
  }).join("");
}
