# FlashFoods Roadmap — F09 Native-Feel Student Navigation

## Roadmap philosophy

This roadmap is the preferred, evidence-driven path for F09. The current
application remains the source of truth. If a phase assumption fails, inspect
the cause and choose the smallest safe alternative that preserves the same
contract. Do not widen the scope merely to make the preferred design easier.

F09 is an incremental enhancement to the existing Express/EJS application. It
does not authorize React, a frontend router framework, a broad backend rewrite,
or changes to payment, authentication, authorization, CSRF, order, cart, or
database business logic.

## Execution and phase gates

Run exactly one F09 phase at a time:

```text
INSPECT → IMPLEMENT THE CURRENT PHASE → RUN ITS FOCUSED CHECKS
        → RECORD EVIDENCE → PASS OR BLOCK
```

The next phase is ineligible until the current phase's prerequisites,
acceptance criteria, safeguards, and verification all pass. A critical
regression, blank state, security regression, payment/order regression, or
disproved architecture assumption stops F09 at the current phase. Follow
`.ai/bug_fix.md` for repair; do not build on an unverified phase.

No phase in this roadmap has been implemented merely because it is described
here.

## F09 scope

Supported soft navigation is limited initially to the student destinations:

```text
/  ↔  /shops  ↔  /orders  ↔  /cart
```

Shop detail, order detail, Profile, auth pages, vendor/admin pages, payment
redirects, and state-changing forms keep ordinary browser navigation until
their lifecycle requirements are explicitly proven. Direct URLs and full-page
fallbacks remain supported for every route.

## Phase 1 — Baseline and focused proof

### Objective

Measure the existing full-document navigation path and establish a small,
repeatable proof harness before changing the architecture.

### Prerequisites

- F09 contract in `.ai/goal.md` is loaded.
- Relevant current source has been re-read, including the footer listener,
  Liquid Glass lifecycle, View Transition CSS, routes, and page scripts.
- Test execution has an isolated/local environment; the configured default E2E
  hooks must not be used against a production database.

### Minimum work

- Capture the current behavior for Home → Browse, Browse → Home, Home → Orders,
  Orders → Cart, Cart → Orders, and Browse → Orders.
- Measure request start/response, document readiness/paint where available,
  page-script startup, Liquid Glass pending/on state, and transition timing
  separately.
- Compare the known Orders → Cart reference with the reverse and other pairs;
  do not assume a route is faster from animation appearance alone.
- Establish assertions for one visible navbar, active tab, URL, and absence of
  hidden navbar frames. Do not change application behavior in this phase.

### Safeguards

- No production DB, live payment gateway, live push notification, or destructive
  seed operation.
- No arbitrary delay, animation inflation, or test-only behavior that changes
  the application path.
- Treat timing results as evidence, not as permission to remove server data
  loading or business logic.

### Verification and completion gate

Record actual timings, browser/viewport, route, cache state, and console/page
errors. Phase 1 passes only when the baseline is reproducible and the dominant
costs are separated into network/server, document/render, initialization, and
animation categories. If the instrumentation cannot distinguish those costs,
remain in Phase 1.

## Phase 2 — Persistent shell and content boundary

### Objective

Prove the smallest persistent student shell and a dedicated replaceable content
boundary with a minimal, controlled prototype.

### Prerequisites

- Phase 1 baseline is recorded and has no unresolved critical regression.
- The prototype uses the current EJS shell and existing server-rendered data.

### Minimum work

- Keep the shared student header, bottom navbar, spacer/clearance, document
  backdrop, and Liquid Glass renderer outside the replaceable region.
- Introduce a clearly identified student content boundary without breaking
  direct full-page rendering.
- Prove that one navbar DOM identity and one Liquid Glass instance survive a
  supported content change.
- Preserve server-derived `currentPath`/cart state on full loads and define how
  the prototype updates active state after a content change.

### Safeguards

- Keep the existing `.portal-nav` pending-state, pointer-event, transition-group,
  orange active-pill, entrance-animation, and card-stagger behavior intact.
- Do not move or duplicate vendor/admin/auth shells without a demonstrated need.
- Do not inject an unvalidated full document into the content region.
- Preserve desktop-frozen rendering and the mobile-only UI scope.

### Verification and completion gate

Directly render every affected page and run the minimal prototype at the mobile
reference viewport plus the desktop boundary. Confirm exactly one navbar, stable
navbar geometry, one Liquid Glass canvas/renderer, correct bottom clearance,
working direct URLs, and no console errors. Stop if any full-page route or role
changes unexpectedly.

## Phase 3 — Controlled navigation for the four destinations

### Objective

Implement a narrowly scoped navigation controller for safe same-origin GET
links while keeping ordinary browser navigation as the fallback.

### Prerequisites

- Phase 2 content boundary is proven.
- The shell remains stable under a destination content swap.

### Minimum work

- Intercept only explicit same-origin, left-click, GET navigations for `/`,
  `/shops`, `/orders`, and `/cart`.
- Keep content visible while the destination is fetched; use loading feedback
  without delaying the request or creating a blank shell.
- Handle pushState, popstate, Back/Forward, title, active tab,
  `aria-current`, scroll restoration, duplicate clicks, AbortController, stale
  responses, failed requests, and unexpected redirects.
- Fall back to `location.assign()`/ordinary navigation for login redirects,
  unsupported paths, query/hash cases not covered by the contract, and any
  response that cannot be safely treated as the expected destination.

### Safeguards

- Never intercept POST/PUT/PATCH/DELETE, checkout, payment, cart mutation,
  profile mutation, logout, download, external, modified, or new-tab links.
- Keep authentication, authorization, session cookies, CSRF origin checks, and
  flash/redirect behavior server-controlled.
- Do not let a slower response overwrite a newer navigation.
- Do not run the existing skeleton listener and a new controller independently;
  one owner must control navigation feedback.

### Verification and completion gate

Run the full route matrix plus rapid clicks, aborts, network failures, a 500,
expired-session redirect, and Back/Forward during an in-flight request. Confirm
the same navbar identity, one renderer, correct content/title/URL/tab, no blank
state, and normal fallback behavior. Any mutation or auth regression blocks
the phase.

## Phase 4 — Page initialization and cleanup

### Objective

Make destination behavior explicit, idempotent, and disposable when content is
replaced.

### Prerequisites

- Phase 3 controller commits only verified destination content.
- The controller has a defined cleanup hook before replacement and init hook
  after replacement.

### Minimum work

- Convert or wrap page behavior in explicit initializers/cleanup for Home,
  Browse, Orders, and Cart.
- Preserve Browse search and favourite handling, Cart variant/quantity/order
  type/payment launch behavior, Home notification interaction, and relevant
  order-detail polling where those pages are included in the shell.
- Stop timers and polling on content replacement; do not rely only on
  `beforeunload`, because soft navigation does not unload the document.
- Ensure external payment SDK setup and event listeners do not duplicate.

### Safeguards

- Keep state-changing requests and payment redirects on their existing paths.
- Reuse existing server-computed totals and validation.
- Do not silently include Profile, shop detail, or order detail in soft
  navigation until its behavior is covered; retain full-page fallback.

### Verification and completion gate

Swap each supported page repeatedly and verify search/filter state, Cart
controls, checkout launch, Home controls, and polling cleanup. Inspect listener
and timer counts or equivalent observable evidence. Run focused regression tests
for auth, session, cart, order, payment boundary, and role access.

## Phase 5 — Server response optimization

### Objective

Reduce unnecessary HTML transfer and parsing only when Phase 3/4 measurements
show that full-document responses are a meaningful bottleneck.

### Prerequisites

- Soft navigation and page lifecycle behavior are already reliable.
- Phase 1 timings identify a server/render/transfer cost worth addressing.

### Minimum work

- Add narrowly negotiated fragment responses or shared EJS content partials
  while retaining the normal full-page response.
- Reuse existing route data-loading and authorization logic; do not fork
  business rules merely to render fragments.
- Define personalized-response cache controls and ensure fragment responses
  cannot be served across users.

### Safeguards

- Preserve redirects for unauthenticated users, invalid shops, stale carts, and
  other existing route conditions.
- Preserve session cart, flash messages, CSRF boundaries, asset versioning,
  Socket.IO, Firebase, and service-worker behavior.
- Do not make navigation correctness depend on a fragment-only response.

### Verification and completion gate

Compare full and fragment responses for authorization, visible data, titles,
cart badge, active tab, errors, empty states, totals, and redirects. Re-run the
Phase 3/4 failure and regression matrix before accepting any response change.

## Phase 6 — Transition and loading polish

### Objective

Tune the visual result after the shell, controller, responses, and lifecycle
are correct, using measured evidence rather than arbitrary waiting.

### Prerequisites

- Phases 1–5 that are applicable to the selected implementation are complete.
- No navbar, auth, payment, cart, order, or lifecycle regression is open.

### Minimum work

- Tune content-only motion around a 160–220 ms starting range, with subtle fade
  and minimal translation.
- Keep active-tab feedback immediate and the navbar free of opacity/position
  animation during route changes.
- Preserve existing entrance/card-stagger behavior where it complements the
  content transition; remove only measured conflicts.
- Implement reduced-motion behavior and loading feedback that never blocks the
  request or invents a delay.

### Verification and completion gate

Repeat the route, failure, reduced-motion, mobile, and desktop-frozen matrix;
record before/after timing evidence and check for blank frames, duplicate
content, navbar flicker, console errors, and stale page state. F09 is complete
only when the acceptance criteria in `.ai/goal.md` are evidenced and
`.ai/STATUS.md` records the actual checks.

## Completed work and other backlog

Stage 1 (F01–F05, F06/F06.5, F07) is complete; details are in `.ai/HISTORY.md`.

### F08 — Student Portal UI Standardization (Mobile-Only) — COMPLETE 2026-10-07

- Shops, menu, cart, orders, order detail, profile, login, and signup were
  converted.
- Desktop is frozen as defined by F08-D3; unit evidence is recorded in history.

The navbar blinking fix that followed F08 is complete and is a prerequisite to
preserve during F09. It does not constitute persistent-shell navigation.

Unrelated future backlog remains unordered: isolated E2E/load environment,
slot-reservation expiry, auth/session hardening, payment-provider follow-up,
analytics-cache performance, and Playwright fixture seeding. Those items do
not authorize widening F09.

## Post-feature quality and recovery

After F09 completion, follow the post-feature quality sequence in `.ai/test.md`:
new-feature tests, risk-ordered regression, security checks, smoke checks,
applicable stress/load checks, and global student/vendor/admin coverage in a
safe isolated environment.

If a later check exposes a regression, return to the responsible F09 phase,
follow `.ai/bug_fix.md`, fix the root cause, rerun the failed and relevant
regression checks, and only then recalculate phase eligibility.
