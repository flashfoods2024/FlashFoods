# FlashFoods Student Portal UI Standard (F08)

Single source of truth for all student-portal UI work. Locked by human
decisions F08-D1 (orange→red CTA gradient), F08-D2 (35% card fill),
F08-D3 (Student Home desktop accepted as-is). Token values extracted from
committed HEAD (`9e6b131`); conflicts resolved per those decisions.

---

## Section A — Design tokens

```css
/* Brand + text */
--orange: #ff7a00;          /* legacy base, do not use for new gradients */
--orange-hover: #ff9a3d;
--green: #22c55e;
--ink: #1A0F08;             /* headings, dish names */
--ink-soft: #5C4033;        /* body, categories, card text */
--price: #FF6B00;           /* prices */
--muted: #6b7280;           /* fallback only, prefer --ink-soft on portal */

/* CTA gradient (LOCKED F08-D1 — orange-to-red wins everywhere) */
--cta-gradient: linear-gradient(135deg, #ff7225 0%, #ff3d3d 100%);
--cta-glow: 0 6px 18px rgba(255, 107, 0, 0.35);
--cta-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.35);

/* Card glass (LOCKED F08-D2 — 35% fill wins everywhere) */
--card-fill: rgb(255 255 255 / 35%);
--card-blur: blur(20px) saturate(160%);
--card-border-top: 1px solid rgba(255, 255, 255, 0.6);
--card-border-bottom: rgba(255, 180, 120, 0.55);
--card-radius: 16px;
--card-shadow: 0 8px 24px rgba(255, 107, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.7);

/* Background backdrop */
--bg-image-blur: 14px;
--bg-image-opacity: 1;
--bg-image-scale: 1.1;
```

Letter-spacing: headings `-0.02em`; labels/pills `+0.04…0.06em` uppercase.
Tap feedback: `:active { transform: scale(0.98) }` on primary CTAs only.

---

## Section B — Component recipes (all inside `@media (max-width: 767px)`)

```css
/* Card — dish, ticket strip, empty state, why-card, order rows */
.portal-card {
  background: var(--card-fill);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-bottom-color: var(--card-border-bottom);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}
/* Primary CTA */
.portal-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 100%; min-height: 52px; padding: 0 24px;
  background-image: var(--cta-gradient);
  color: #ffffff; border: none; border-radius: 12px;
  font-size: 16px; font-weight: 800; text-decoration: none;
  box-shadow: var(--cta-glow), var(--cta-highlight);
  -webkit-tap-highlight-color: transparent;
}
.portal-btn:active { transform: scale(0.98); }
/* Pills — orange label/pass */
.portal-pill {
  display: inline-flex; align-items: center; padding: 4px 10px;
  border-radius: 999px; background: rgba(255, 122, 0, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.6); color: #FF6B00;
  font-size: 11px; font-weight: 800; letter-spacing: 0.04em;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
/* Pills — green status */
.portal-pill--ok {
  background: rgba(16, 185, 129, 0.12); color: #10b981;
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.25);
}
/* Bottom nav — floating frosted pill, hidden on desktop */
.portal-nav {
  position: fixed; left: 12px; right: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 100;
  display: flex; background: rgba(255, 255, 255, 0.65);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.6); border-radius: 28px;
  box-shadow: 0 12px 32px rgba(255, 107, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  padding: 8px;
}
.portal-nav__link.is-active {
  background: rgba(255, 107, 0, 0.12); color: #FF6B00;
}
/* Backdrop layer per portal screen */
body:has(.portal-root)::before {
  content: ""; position: fixed; inset: 0; z-index: 0;
  background-size: cover; background-position: center top;
  background-repeat: no-repeat;
  filter: blur(var(--bg-image-blur));
  transform: scale(var(--bg-image-scale)); transform-origin: center;
  opacity: var(--bg-image-opacity); pointer-events: none;
}
@supports not (backdrop-filter: blur(1px)) {
  body:has(.portal-root)::before { filter: none; }
}
html.reduced-effects { --bg-image-blur: 0px; --bg-image-opacity: 1; }
```

Existing Student Home classes (`.btn-orange-grad`, `.home-dish-card`,
`.ticket-strip`, `.bottom-nav`, `.hero-pill`, `.pass-pill`, `.ready-pill`,
`.pill-status--ok`, `.why-card`) already implement these recipes and MUST
be reused — never redefined globally.

---

## Section C — Reusable EJS partials and props

| Partial | Props / locals | Notes |
|---|---|---|
| `partials/header.ejs` | `pageTitle`, `currentUser`, `currentPath`, `cartCount`, `assetVersion`, `hidePageBackground?` | Shared all roles. Student avatar + hamburger guard live here; do not fork per screen. |
| `partials/footer.ejs` | none | Shared; owns nav-toggle handler (null-guarded). |
| `partials/student-bottomnav.ejs` | **TO CREATE (F08.2):** `currentPath`, `cartCount` | Extract from `home.ejs` lines 134–144; mobile-only via CSS. |
| Card/pill/button | classes only, no partials | Apply `portal-*` (or legacy home equivalents); no per-screen CSS. |

---

## Section D — Mobile-only scoping rules

- New F08 CSS lives in `@media (max-width: 767px)` blocks, or under
  page-class selectors (`.student-home`, future `.portal-root` markers)
  that match student-portal markup only.
- Reference canvas: **393×852**. Verify no overlap/clipping and full
  CTA clickability at this width.
- Never use bare (unscoped, un-media-queried) selectors for new F08 rules.
- `backdrop-filter` always paired with `-webkit-` prefix and a readable
  semi-opaque fallback background.

---

## Section E — Desktop-frozen policy

```text
DO NOT MODIFY these at any viewport ≥768px:
- public/styles.css rules outside @media (max-width: 767px) that predate F08
- .topbar base (sticky, #fbf1e6), .card, .btn, .tag, .table, .hero, .footer
- Any vendor (views/vendor/*) or admin (views/admin/*) markup or style
- The ≥768px restore blocks for student-home (topbar, backdrop, cards)
```

**Sole exception (F08-D3):** Student Home desktop keeps its current
buttons, typography, grid, and hero illustration. All other screens'
desktop rendering must remain byte-identical to the F08 baseline commit.
