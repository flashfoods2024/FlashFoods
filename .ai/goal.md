# FlashFoods Feature Goal (control-plane slot)

## Current Goal: F08
Title: Student Portal UI Standardization (Mobile-Only)
Locked contract: see `.ai/UI_STANDARD.md` and `.ai/F08_ANALYSIS.md`.
Human decisions locked: CTA gradient orange→red (#ff7225 → #ff3d3d);
card fill 35% white + blur(20px) saturate(160%); Student Home desktop
accepted as-is; auth (login/signup) screens IN scope.
Acceptance criteria: every remaining student-portal screen (shops, menu,
cart, orders, order detail, profile, login, signup) renders with the F08
mobile UI standard on 393x852, and desktop rendering is byte-for-byte
unchanged from the F08 baseline commit on every screen except Student Home.
Forbidden: modifying desktop styles, changing any business logic,
introducing new dependencies, altering vendor or admin UI.

## How a goal is executed

Execution is autonomous via `.ai/ORCHESTRATOR.md`: one human trigger
(`Execute <FEATURE-ID>.`), then the orchestrator owns phases, tests,
validation, and advancement per `roadmap.md`, `test.md`, and
`VALIDATION_CHECKLIST.md`.
