# F08 Analysis — Student Portal UI Standardization (Mobile-Only)

> Phase 1 (analysis) + Phase 2 (report). No code changed. Stops at Phase 3 gate.
> Branch state at analysis time: HEAD `9e6b131`; worktree has UNCOMMITTED
> restructuring in `public/styles.css` (146+/188-) that partly undoes HEAD's
> media-query wrapping — token values below are taken from **committed HEAD**,
> verified via `git show HEAD:public/styles.css`.

---

## Section 1 — Commits analyzed

| # | Hash | Summary |
|---|------|---------|
| 1 | `602abbf` | Remove in-app FCM off banner, keep token registration intact |
| 2 | `5565b2c` | student home page ui 2.0 |
| 3 | `9e6b131` (HEAD) | Scope student-home frosted-glass UI to mobile (<=767px), restore solid desktop defaults |

`git show --stat HEAD~2..HEAD` touches: `public/styles.css` (596 lines),
`public/js/firebase-client.js` (banner removal, no visual-system JS),
`public/sw.template.js` (cache strategy, no visual impact),
`server.js` (`/` route now supplies `featuredItems` + `activeOrder`; `assetVersion`
cache-buster — data/plumbing, no visual classes), `views/home.ejs` (new
`.student-home` student block), `views/partials/header.ejs` (`?v=` link,
avatar-for-cart swap, student-home hamburger guard), `package.json` (`predev`),
2 reference PNGs under `ui_redesign/`, `public/images/student_home_background.png`.

---

## Section 2 — Design token / component extract

All values are the **winning (last-in-cascade) values at HEAD** for the
Student Home (`.student-home`) mobile view. Where two committed rules
conflict, the conflict is flagged — F08 execution must pick one.

### 2.1 CSS variables (`:root`, global — no rendering impact by themselves)

```css
--orange: #ff7a00;
--orange-hover: #ff9a3d;
--orange-soft: #fff1e3;
--bg: #fffaf5;
--card: #ffffff;
--text: #1f1f1f;
--muted: #6b7280;
--green: #22c55e;
--green-soft: #dcfce7;
--border: #e5e7eb;
--danger: #ef4444;
--danger-soft: #fee2e2;
--shadow: 0 16px 40px rgba(31, 31, 31, 0.08);
--shadow-sm: 0 8px 24px rgba(31, 31, 31, 0.06);
--radius: 8px;
--bg-image-blur: 14px;
--bg-image-opacity: 1;
--bg-image-scale: 1.1;
```

### 2.2 Colors + gradients

```css
/* Page backdrop (mobile): blurred photographic layer, dedicated fixed layer */
body:has(.student-home)::before {
  content: ""; position: fixed; inset: 0; z-index: 0;
  background-image: url("/images/student_home_background.png");
  background-size: cover; background-position: center top; background-repeat: no-repeat;
  filter: blur(var(--bg-image-blur));
  transform: scale(var(--bg-image-scale)); transform-origin: center;
  opacity: var(--bg-image-opacity); pointer-events: none;
}
/* Fallback + kill-switch */
@supports not (backdrop-filter: blur(1px)) {
  body:has(.student-home)::before { filter: none; }
}
html.reduced-effects { --bg-image-blur: 0px; --bg-image-opacity: 1; }
/* Desktop (≥768px): photographic layer OFF */
@media (min-width: 768px) {
  body:has(.student-home) { background: var(--bg); }
  body:has(.student-home)::before { display: none; }
}
/* ⚠️ TOKEN CONFLICT — two competing CTA gradients, later wins: */
.student-home .btn-orange-grad { background-image: linear-gradient(135deg, #FF6B00, #FF8A2B); }      /* earlier */
.student-home .btn-orange-grad { background-image: linear-gradient(135deg, #ff7225 0%, #ff3d3d 100%); } /* WINNER (red-orange) */
```

### 2.3 Cards (dish / ticket-strip / empty / why)

```css
/* ⚠️ TOKEN CONFLICT — two competing card fills, later wins: */
.student-home .home-dish-card,
.student-home .ticket-strip,
.student-home .home-empty,
.student-home .why-card {
  background: rgba(255, 255, 255, 0.72);            /* earlier rule */
  background: rgb(255 255 255 / 35%);               /* WINNER — much more translucent */
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-bottom-color: rgba(255, 180, 120, 0.55);
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(255, 107, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
/* Desktop restore (≥768px): */
.student-home .home-dish-card,
.student-home .home-empty,
.student-home .why-card {
  background: var(--card);
  -webkit-backdrop-filter: none; backdrop-filter: none;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
}
```

### 2.4 Buttons

```css
/* Base (UNSCOPED selector, but only home.ejs uses the class): */
.btn-orange-grad {
  display: inline-flex; align-items: center; justify-content: center;
  width: 100%; min-height: 52px; padding: 0 24px;
  background: linear-gradient(135deg, #ff8a00, #ff6b00);
  color: #ffffff; border: none; border-radius: 14px;
  font-size: 16px; font-weight: 700; text-decoration: none; cursor: pointer;
  box-shadow: 0 12px 32px -4px rgba(15, 23, 42, 0.16), 0 4px 12px -2px rgba(249, 115, 22, 0.2);
  -webkit-tap-highlight-color: transparent;
}
.btn-orange-grad:active { transform: scale(0.98); }
/* Student-home overlay (mobile): radius 12px, warm glow (gradient per §2.2 conflict) */
.student-home .btn-orange-grad {
  border-radius: 12px;
  box-shadow: 0 6px 18px rgba(255, 107, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  color: #ffffff; font-weight: 800; text-align: center;
}
/* NOTE: no desktop restore exists for .btn-orange-grad — desktop student-home
   keeps the gradient + press-shrink. See §5 item R3. */
```

### 2.5 Pills + badges

```css
.hero-pill { /* base: white-glass, orange text */
  display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 999px;
  background: rgb(255 255 255 / 62%); color: #ff6b00;
  font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
}
.student-home .hero-pill {
  border: 1px solid rgba(255, 255, 255, 0.6);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
.pass-pill {
  display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px;
  background: rgba(255, 107, 0, 0.12); color: #ff6b00;
  font-size: 11px; font-weight: 800; letter-spacing: 0.04em; white-space: nowrap;
}
.student-home .pass-pill {
  background: rgba(255, 122, 0, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.6); color: #FF6B00;
}
.ready-pill {
  display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px;
  background: rgba(16, 185, 129, 0.12); color: #10b981;
  font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap;
}
.student-home .ready-pill {
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.25);
}
.pill-status {
  display: inline-flex; align-items: center; min-height: 22px; padding: 2px 8px;
  border-radius: 999px; font-size: 10px; font-weight: 800; white-space: nowrap;
}
.pill-status--ok { background: rgba(16, 185, 129, 0.12); color: #10b981; }
.student-home .pill-status--ok {
  border: 1px solid rgba(255, 255, 255, 0.6);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
```

### 2.6 Typography

```css
/* Base (unscoped, home.ejs-only usage): */
.hero-title { margin: 10px 0 6px; font-size: 36px; font-weight: 800;
  letter-spacing: -0.025em; line-height: 44px; color: #111827; }
.hero-sub { margin: 0 0 14px; color: #6b7280; font-size: 14px; line-height: 20px; }
.express-title { margin: 0; font-size: 17px; font-weight: 800;
  letter-spacing: -0.01em; color: #111827; }
/* Student-home overlay (ALL widths — no desktop restore, see §5 R3): */
.student-home .hero-title,
.student-home .express-title,
.student-home .home-dish-card .dish-name { color: #1A0F08; letter-spacing: -0.02em; }
.student-home .hero-sub,
.student-home .home-dish-card .dish-cat,
.student-home .why-card p { color: #5C4033; }
.student-home .dish-price { color: #FF6B00; } /* + base: 16px/800/tabunglar */
```

### 2.7 Top bar / header

```css
/* Winning mobile behavior (all widths unless restored): transparent, scrolls away */
body:has(.student-home) .topbar {
  background: transparent; border: none; box-shadow: none;
  -webkit-backdrop-filter: none; backdrop-filter: none;
  position: relative; z-index: 1;   /* in normal flow: scrolls, stays above bg */
}
/* Desktop restore (≥768px): */
@media (min-width: 768px) {
  body:has(.student-home) .topbar {
    position: sticky; top: 0; z-index: 100;
    background-color: #fbf1e6; border-bottom: 1px solid var(--border);
    backdrop-filter: blur(14px); box-shadow: none;
  }
}
/* Avatar (student-gated in header.ejs, all widths): */
.profile-avatar-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; flex: 0 0 auto; border-radius: 50%;
  background: linear-gradient(135deg, #ff8a00, #ff6b00); color: #ffffff;
  font-size: 14px; font-weight: 800; text-decoration: none;
  box-shadow: 0 8px 24px rgba(255, 107, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
```

### 2.8 Bottom navigation

```css
/* Base now lives INSIDE @media (max-width: 767px) at HEAD (was global pre-9e6b131): */
@media (max-width: 767px) {
  .bottom-nav {
    position: fixed; left: 16px; right: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 100;
    display: flex; background: rgba(255, 255, 255, 0.82);
    -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
    border: 1px solid rgba(229, 231, 235, 0.7); border-radius: 1rem;
    box-shadow: 0 12px 32px -4px rgba(15, 23, 42, 0.16); padding: 8px;
  }
  .bottom-nav__link { flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 8px 4px; border-radius: 8px; color: #6b7280; font-size: 11px;
    font-weight: 700; letter-spacing: 0.04em; text-decoration: none; min-height: 48px; }
  .bottom-nav__link.is-active { background: #ff6b00; color: #ffffff; }
  .bottom-nav, .bottom-nav-spacer { display: none; } /* min-width:768px counterpart */
}
/* Student-home overlay (all widths): floating frosted pill */
.student-home .bottom-nav {
  left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  background: rgba(255, 255, 255, 0.65);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.6); border-radius: 28px;
  box-shadow: 0 12px 32px rgba(255, 107, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
.student-home .bottom-nav__link.is-active {
  background: rgba(255, 107, 0, 0.12); color: #FF6B00;
}
/* NOTE: no desktop restore for the pill geometry — desktop hides the nav
   entirely via the min-width:768px display:none. See §5 R3. */
```

### 2.9 Hero illustration layer

```css
.student-home .home-hero { position: relative; overflow: hidden; }
.student-home .home-hero::before {
  content: ""; position: absolute; top: 0; right: 0; width: 60%; height: 70%;
  z-index: 0; background: url("/background-image.png") no-repeat top right / contain;
  opacity: 0.75;
  -webkit-mask-image: linear-gradient(to left, black 40%, transparent 100%);
  mask-image: linear-gradient(to left, black 40%, transparent 100%);
  pointer-events: none;
}
.student-home .home-hero > * { position: relative; z-index: 1; }
@media (max-width: 480px) {
  .student-home .home-hero::before { width: 65%; height: 60%; }
}
/* NOTE: applies at ALL widths incl. desktop — no restore. See §5 R3. */
```

### 2.10 Food-media tray

```css
.student-home .home-dish-media {
  background: rgba(255, 255, 255, 0.5);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  backdrop-filter: blur(12px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.6); border-radius: 14px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
/* (Earlier 135deg #FFE8D6→#FFD4B8 gradient rule for the same selector is
   overridden by the above — dead but harmless.) */
```

### 2.11 Footer / info strips, inputs, icons, spacing, motion

- Footer strip: `.home-copyright` (12px `#6b7280`, centered) — no glass; keep as-is.
- Inputs: untouched by all 3 commits (`.input`, `.input--qty`, selects unchanged).
- Icons: untouched (inline SVGs only; avatar uses initials text).
- Spacing rhythm introduced: `.section-head` (20px/12px margins), `.dish-grid` (2-col, 12px gap), `.student-home` bottom clearance `calc(64+16+16px + safe-area)`, `.bottom-nav-spacer` 88px.
- Motion/tap: `.btn-orange-grad:active { transform: scale(0.98) }` only.
- JS hooks: **none** — the visual system is pure CSS. JS changes in range (FCM banner removal, SW cache strategy, `featuredItems`/`activeOrder` data, `assetVersion`) carry no visual-system hooks.

---

## Section 3 — Screen inventory

Student portal = routes rendering for `role === "student"`. No `views/student/` dir;
student views live alongside others. Guest branch of `home.ejs` (`.hero--home`)
is marketing, not portal — out of scope.

| Screen | File path | Route | Matches new system? | Missing components |
|---|---|---|---|---|
| Student Home | `views/home.ejs` (`.student-home` block) | `GET /` (student) | **Y** (reference) | — (resolve §2 conflicts) |
| Canteen list | `views/shops/index.ejs` | `GET /shops` | N | card material, button gradient, pills, section-head type, bottom nav, mesh bg |
| Canteen menu | `views/shops/menu.ejs` | `GET /shops/:slug` | N | same + `.tag`→pill mapping, breadcrumb treatment |
| Cart | `views/cart/index.ejs` | `GET /cart` | N | card material, primary CTA gradient, table→card rows, bottom nav |
| Orders | `views/orders/index.ejs` | `GET /orders` | N | card material, ticket-strip reuse for order rows, bottom nav |
| Order detail | `views/orders/show.ejs` | `GET /orders/:id` | N | card material, `.otp-box`/`.pickup-meta`/`.progress-tracker` restyle-or-keep decision, CTA gradient |
| Profile | `views/profile/index.ejs` | `GET /profile` | N | card material, `.profile-row` treatment, ghost buttons, bottom nav |
| Login | `views/auth/login.ejs` | `GET /login` | N — IN SCOPE (human decision) | card/form material, primary CTA gradient, mesh bg |
| Signup | `views/auth/signup.ejs` | `GET /signup` | N — IN SCOPE (human decision) | same as login |

Reusable partials in use: `partials/header.ejs` (topbar, avatar, hamburger guard),
`partials/footer.ejs`, `partials/page-background.ejs` (hidden on student home),
`partials/update-banner.ejs`. Bottom nav currently exists **only** in `home.ejs`
— F08 must decide: extract to a partial and reuse, or leave other screens
without it (recommend: extract + reuse, mobile-only).

Pre-F08 styling language on non-matching screens: solid `.card`
(`--card` + `--border` + `--shadow-sm`), flat `.btn` orange (`--orange`),
`.tag--*` status pills, `.muted` `#6b7280` body text, `.hero--compact` headers.

---

## Section 4 — Proposed standardization contract

(Lift-ready for `.ai/BUSINESS_RULES.md` or new `.ai/UI_STANDARD.md`.)

1. **Mobile-only scope is absolute.** All F08 UI rules live under
   `@media (max-width: 767px)` (reference canvas 393×852) or
   `.student-*`-style page scoping that only matches student-portal markup.
2. **Desktop is frozen.** No F08 rule may match at `min-width: 768px` unless
   it is a *restore* that reproduces the pre-F08 computed style. Any desktop
   pixel change is a regression → revert the work unit.
3. **Single source of truth:** tokens in §2 (after resolving the two flagged
   conflicts). No per-screen hex shopping: orange `#FF6B00` family, warm ink
   `#1A0F08`, warm grey `#5C4033`, success `#10B981`.
4. **Card recipe:** `rgba(255,255,255,0.35–0.72)` + `blur(20px) saturate(160%)`
   + 1px `rgba(255,255,255,0.6)` top / warm `rgba(255,180,120,0.55)` bottom +
   16px radius + `0 8px 24px rgba(255,107,0,0.08)` + top inner highlight.
   (Exact fill % = whichever side of the §2.3 conflict the human picks.)
5. **Primary-button recipe:** full-width 52px, `linear-gradient(135deg, …)`
   ( winning stops = whichever side of the §2.2 conflict the human picks),
   12px radius, `0 6px 18px rgba(255,107,0,0.35)` glow + top highlight,
   800-weight white centered text, `:active scale(0.98)`.
6. **Pill recipes:** as §2.5 (orange tint for labels/passes, green tint +
   green glow for status, `blur(8px)` glass, white 1px borders).
7. **Nav recipe:** floating 28px pill, 12px gaps + `env(safe-area-inset-bottom)`,
   `rgba(255,255,255,0.65)` + `blur(24px) saturate(180%)`, tinted-orange
   active tab; hidden ≥768px.
8. **Backdrop recipe:** per-screen `body:has(.page)::before` photographic or
   mesh layer with `--bg-image-blur` variable + `reduced-effects` kill-switch
   + `@supports` fallback; photographic layers `display:none` ≥768px.
9. **Forbidden:** touching vendor/admin markup or styles; touching routes,
   models, middleware, sockets, forms, or business logic; new dependencies;
   desktop style edits; unscoped (non-media, non-page-class) selectors for
   any new F08 rule; inline styles.

---

## Section 5 — Regression scan

Methods: `git diff f6cc3b7..HEAD` per-file; usage-grep of every new class
across `views/`; cascade-order check of restore blocks. **No desktop
regression to pre-existing screens found** — but three residue items and two
scope findings need human decisions (reported, NOT fixed, per guard rails).

- **R1 (cross-screen mobile impact, NOT desktop):** `602abbf…HEAD` changed
  `.brand { font-size: 30px → 33px }` inside `@media (max-width: 480px)`
  (`public/styles.css`, global selector). This restyles the topbar wordmark
  on **every** screen (student, vendor, admin, guest) on small phones.
  Viewport-compliant with mobile-only, but violates screen-scoping.
  Recommended fix (future feature, not F08): scope to
  `body:has(.student-home) .brand` or revert to 30px.
- **R2 (dead-but-harmless):** two overridden rules never win and should be
  deleted during F08 cleanup (not behavior): the `#FF6B00→#FF8A2B` CTA
  gradient and the `#FFE8D6→#FFD4B8` `.home-dish-media` gradient, plus the
  superseded mesh `::before` stacks. Deletion is CSS-only and safe.
- **RESOLVED — Human decision F08-D3: Student Home desktop accepted as-is; no restores added.**
- **R3 (student-home desktop residue — decision required):** the ≥768px
  restore block covers topbar, backdrop, ticket-strip, dish/empty/why cards —
  but **not** `.btn-orange-grad` (gradient+full-width+press), hero/dish
  typography (`#1A0F08`/`#5C4033`), `.dish-grid` 2-col, or the hero
  illustration `::before`. So student-home desktop is NOT identical to
  pre-F08. Either (a) extend restores to these, or (b) declare
  student-home-desktop out of F08's frozen scope. Needs human call.
- **R4 (unscoped selectors, contained):** base rules for `.glass-card`,
  `.btn-orange-grad`, `.ticket-strip`, `.bottom-nav*`, `.hero-pill`,
  `.pill-status*`, `.profile-avatar-btn` match at all widths with no page
  scoping — verified safe ONLY because grep proves no other view uses these
  classes. F08 must keep it that way (new screens must reuse the classes,
  never redefine them globally).
- **R5 (worktree drift warning):** uncommitted worktree changes
  (`M public/styles.css`, 146+/188-) are actively restructuring HEAD's
  blocks (e.g. the `@media (max-width: 767px)` wrapper present at HEAD no
  longer exists in the worktree). F08 execution must start from a clean,
  committed baseline — commit or discard worktree first.
- **RESOLVED — Locked in .ai/UI_STANDARD.md Section A (CTA gradient orange→red #ff7225 → #ff3d3d; card fill rgb(255 255 255 / 35%) + blur(20px) saturate(160%)).**
- **R6 (token conflicts):** CTA gradient (§2.2) and card fill (§2.3) each
  have two competing committed values; F08 must lock one before converting
  screens, or screens will be built on a moving target.

---

## Section 6 — Proposed feature execution graph (for Phase 5)

1. **F08.0 — Baseline lock:** commit/discard worktree; human resolves R3,
   R6 conflicts, auth-screen scope, bottom-nav-reuse decision.
2. **F08.1 — Tokens + component classes:** resolve conflicts, add one
   mobile-scoped token/class block in `styles.css` (or new
   `public/student-portal.css` linked only from student views — preferred,
   zero desktop risk); delete R2 dead rules.
3. **F08.2 — Partial extraction:** `partials/student-topbar.ejs` (or keep
   header guard), `partials/student-bottomnav.ejs`, card/pill/button
   usage conventions (classes only, no new CSS per screen).
4. **F08.3–F08.10 — One work unit per screen:** shops index, shops menu,
   cart, orders index, order detail, profile, login, signup. Each: classes
   only, no logic.
5. **F08.11 — Regression pass:** desktop 1440×900 before/after
   pixel-diff <0.5% on every screen (all roles); mobile 393×852 smoke per
   `.ai/test.md` F08 section; unit suite green.
6. **F08.12 — Stage:** status/history/roadmap updates, final report.

---

*End of analysis. Awaiting human review (Phase 3 gate). Do not proceed to
Phase 4 (.ai doc updates) or Phase 5 (execution) without approval.*
