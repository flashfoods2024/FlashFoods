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
| `partials/student-bottomnav.ejs` | `currentPath`, `cartCount` | Existing shared student navigation partial; keep one instance outside the future F09 replaceable content boundary and mobile-only via CSS. |
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

---

## Section F — F09 navigation motion and continuity (planned)

F09 is a planned interaction upgrade; these rules do not claim that
persistent-shell navigation is implemented. The existing navbar-blinking fix is
complete and protected.

### Continuity invariants

- During supported student navigation between `/`, `/shops`, `/orders`, and
  `/cart`, keep the shared top header, one `.portal-nav`, its bottom clearance,
  and the Liquid Glass renderer mounted once the architecture has been proven.
- Replace only the destination content boundary. Never animate the navbar's
  opacity or position, create a duplicate navbar, or show a blank shell.
- Preserve the orange active indicator, current glass material/frost behavior,
  existing page entrance animation, and card staggering unless measurement
  proves a focused change is necessary.
- Direct URLs, refreshes, unsupported routes, auth redirects, mutations, and
  failures continue through ordinary server-rendered navigation.

### Motion starting targets

These are tuning targets for Phase 6, not reasons to add waiting now:

- Content-only transition: start around 160–220 ms.
- Motion: subtle opacity change and minimal translation; avoid large movement.
- Active tab: update immediately after a safe navigation decision, with rollback
  on failure.
- Loading: show lightweight feedback only after navigation starts; never delay
  the request or hold the old page artificially.
- Reduced motion: remove transition, entrance, and stagger motion while keeping
  content, focus, and navigation usable.

### Measurement policy

Before tuning motion, distinguish request/response latency, server rendering,
DOM replacement, page initialization, Liquid Glass work, browser paint, and
transition duration. A slower route must not be made to appear healthy by
adding a timeout or extending an animation.

### Lifecycle and interaction policy

Page-specific scripts must be initialized after content insertion and cleaned
up before replacement. Browse search/filtering, Cart controls/payment launch,
Home notification interaction, and order polling must remain usable and must
not accumulate handlers or timers. State-changing forms and payment redirects
retain their existing server flow and are not converted into visual-only
navigation.

### Responsive policy

The navigation work remains subject to Section D mobile scoping and Section E's
desktop-frozen policy. Verify at 393×852 and the 767/768 px boundary. Visual
continuity on desktop must not be achieved by changing frozen desktop styles.
