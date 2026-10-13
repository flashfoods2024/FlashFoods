// Shared Student-portal Liquid Glass loader (mobile only, ≤767px).
// Single init per page load; the vendored ESM bundle is imported relatively
// so no bundler or import-map is needed. Also owns the persisted
// "Bottom Navigation Frost" preference (localStorage) and applies it both to
// the CSS material (always) and to the live lens (verified: the render loop
// rebuilds uniforms from lens.options every frame, so assigning
// lens.options.frost updates frostiness with no re-init).
import liquidGL from "./vendor/liquidGL.js";

export const FROST_KEY = "flashfoods.navFrost.v1";
export const FROST_DEFAULT = 50;

const clampFrost = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return FROST_DEFAULT;
  return Math.min(100, Math.max(0, Math.round(n)));
};

export function readStoredFrost() {
  try {
    const raw = localStorage.getItem(FROST_KEY);
    if (raw === null) return FROST_DEFAULT;
    return clampFrost(raw);
  } catch {
    return FROST_DEFAULT;
  }
}

export function storeFrost(v) {
  try {
    localStorage.setItem(FROST_KEY, String(clampFrost(v)));
  } catch {
    /* private mode etc. — preference simply doesn't persist */
  }
}

// Slider 0–100 → GPU frost radius (px). 50 ≈ 1.0 keeps the current clear-glass look.
export const lensFrostFor = (v) => clampFrost(v) / 50;

// Slider 0–100 → CSS material. Defaults reproduce the current treatment
// (blur 24px, alpha 0.65, saturate 180%) at v=50.
export function paintFrostVars(v) {
  const n = clampFrost(v);
  const root = document.documentElement.style;
  root.setProperty("--nav-frost-blur", `${(6 + n * 0.36).toFixed(1)}px`);
  root.setProperty("--nav-frost-alpha", (0.45 + n * 0.004).toFixed(3));
  root.setProperty("--nav-frost-sat", `${Math.round(140 + n * 0.8)}%`);
}

function lenses() {
  const l = window.__liquidGLStudentNavLens;
  if (!l) return [];
  return Array.isArray(l) ? l : [l];
}

export function applyNavFrost(v, { persist = false } = {}) {
  const n = clampFrost(v);
  paintFrostVars(n);
  for (const lens of lenses()) {
    try {
      lens.options.frost = lensFrostFor(n);
    } catch {
      /* lens torn down mid-adjust — CSS vars still apply */
    }
  }
  if (persist) storeFrost(n);
  return n;
}

export function frostLabel(v) {
  const n = clampFrost(v);
  return n < 34 ? "Clear" : n < 67 ? "Balanced" : "Strong";
}

window.FlashFoodsGlass = {
  applyNavFrost,
  readStoredFrost,
  storeFrost,
  lensFrostFor,
  frostLabel,
  FROST_KEY,
  FROST_DEFAULT,
};

// Paint the stored preference immediately so the CSS material (and the
// fallback path) is correct even when GPU init is skipped.
paintFrostVars(readStoredFrost());

export function initStudentGlass() {
  try {
    if (window.__liquidGLStudentNav) return; // init no more than once
    if (new URLSearchParams(location.search).get("no-liquid") === "1") return;
    if (!matchMedia("(max-width: 767px)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (navigator.connection && navigator.connection.saveData) return;
    const nav = document.querySelector(".portal-nav");
    if (!nav) return;
    // Light capability gate; the library re-probes and CSS-falls-back itself.
    if (!("gpu" in navigator) && !("WebGLRenderingContext" in window)) return;
    // Snapshot must stay "body": the refracted photographic backdrop lives on
    // body.student-portal::before (a pseudo-element) which no smaller subtree
    // contains. Resolution is capped for low-end GPUs.
    const lens = liquidGL({
      snapshot: "body",
      target: ".portal-nav",
      resolution: 1.25,
      engine: "auto",
      refraction: 0.01,
      aberration: 0,
      bevelDepth: 0.08,
      bevelWidth: 0.15,
      frost: lensFrostFor(readStoredFrost()),
      shadow: true,
      specular: false,
        // "none": the navbar must stay visually stable while the next
        // full-document page enters; the CSS entrance applies to screen
        // content only and never delays a link navigation.
      reveal: "none",
      tilt: false,
      draggable: false,
      interaction: "none",
      magnify: 1,
      tint: null,
      on: {
        init() {
          document.documentElement.classList.add("liquidgl-on");
        },
      },
    });
    if (typeof lens === "undefined") return;
    window.__liquidGLStudentNav = true;
    window.__liquidGLStudentNavLens = lens;
  } catch (err) {
    console.warn("liquidGL trial skipped:", (err && err.message) || err);
  }
}
