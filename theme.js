/* Shared light/dark theme toggle (persisted). Emits a `themechange` event so
   the viewer can recompute theme-aware overlay colors. Included before the
   page script; the #themeBtn and [data-theme-label] elements precede it. */
"use strict";
(function () {
  const KEY = "w2c-theme";
  const saved = localStorage.getItem(KEY);
  if (saved) document.documentElement.setAttribute("data-theme", saved);

  function sync() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const el = document.querySelector("[data-theme-label]");
    if (el) el.textContent = dark ? "Light" : "Dark";
  }
  function toggle() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(KEY, next);
    sync();
    document.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  }

  sync();
  const btn = document.getElementById("themeBtn");
  if (btn) btn.addEventListener("click", toggle);
})();
