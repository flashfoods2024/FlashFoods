# FlashFoods Feature Goal (control-plane slot)

## Active Goal: F09 — Native-Feel Student Navigation

**State:** PLANNED. Documentation preparation is complete; application
implementation has not started.

Transform navigation between the student Home (`/`), Browse (`/shops`), Orders
(`/orders`), and Cart (`/cart`) into a smooth, native-app-like experience while
preserving FlashFoods' Express/EJS architecture and server authority.

The target is a persistent, server-rendered student shell with carefully
controlled DOM-based navigation. It is an incremental enhancement, not a React
migration or a replacement for normal server-rendered pages.

## Verified starting state

The current source establishes these facts:

- Student bottom-navigation links are ordinary same-origin anchors in
  `views/partials/student-bottomnav.ejs`.
- The student listener in `views/partials/footer.ejs` marks `main[aria-busy]`
  and appends a skeleton, but does not call `preventDefault()`, fetch a
  destination, or replace DOM content.
- Each full document renders a new header, main content, footer/nav markup, and
  student Liquid Glass instance.
- There is no shared student content boundary for replacing only page content.
- The completed navbar blinking fix is present: `student-glass.js` exposes a
  pending state, the navbar remains visible/clickable during initialization,
  and `.portal-nav` has an isolated zero-duration View Transition group.
- Student pages have distinct behavior that must survive any future content
  replacement, including Browse filtering, Cart controls and payment launch,
  Home notification interaction, and order-detail polling.

This is source evidence, not a claim that the target behavior has been
implemented or browser-verified.

## Locked F09 contract

1. Keep Express routes, EJS rendering, session authentication,
   authorization, database queries, and server-side business rules authoritative.
2. Keep the shared student top header, bottom navbar, and Liquid Glass renderer
   mounted during supported soft navigation where the architecture proves it is
   safe.
3. Replace only a dedicated main student-content region for supported
   same-origin GET navigation. Preserve ordinary full-document navigation as a
   reliable fallback.
4. Keep direct URLs, refreshes, deep links, authentication redirects,
   unsupported routes, and non-student portals working as normal server-rendered
   pages.
5. Keep the browser URL, title, selected tab, `aria-current`, scroll behavior,
   and Back/Forward history synchronized.
6. Do not intercept payment, checkout, cart mutation, profile mutation, logout,
   or any other state-changing form/fetch. Preserve CSRF and session behavior.
7. Make destination initialization explicit and cleanup-safe. No duplicate
   listeners, stale timers, orphaned polling, or stale responses may survive a
   content swap.
8. Preserve the completed navbar blinking fix, Liquid Glass treatment, orange
   active indicator, existing entrance animations, and card staggering unless a
   measured technical defect requires a focused change.
9. Measure request, server/render, initialization, and animation time separately
   before tuning motion. Never add arbitrary delays to disguise latency.
10. A failed, cancelled, redirected, or stale navigation must not leave blank
    content or a broken shell.

## Acceptance criteria

F09 is complete only when evidence shows that:

- The same student navbar DOM element remains mounted through every supported
  soft-navigation sequence, with one navbar and one Liquid Glass renderer.
- Home, Browse, Orders, and Cart content, titles, active tabs, accessibility
  state, URLs, and history remain correct.
- Browse search/filter behavior, Cart variants/quantities/checkout launch,
  Home interactions, and relevant order polling continue to work without
  duplicated handlers or timers.
- Authentication/session failures and unsupported destinations fall back to
  ordinary server navigation without injecting the wrong document.
- Direct page loads and refreshes remain fully functional.
- Failure, rapid-click, cancellation, reduced-motion, mobile viewport, and
  desktop-frozen checks pass according to `.ai/VALIDATION_CHECKLIST.md`.
- Performance evidence distinguishes genuine network/server/initialization
  costs from transition styling, and no artificial waiting is used.

## Execution entry point

The first implementation phase is **Phase 1 — Baseline and focused proof** in
`.ai/roadmap.md`. It is pending and must not be treated as started by this
documentation update. A future session begins with:

```text
Execute F09.
```

`.ai/ORCHESTRATOR.md` owns phase selection, safe testing, validation, status
recording, and advancement. Only one phase may be active at a time. If a
critical regression or disproved assumption appears, F09 stops at that phase
until the failure is resolved or the path is explicitly marked blocked.

Completed goals remain in `.ai/HISTORY.md`; this active contract remains here
until F09 is genuinely complete.
