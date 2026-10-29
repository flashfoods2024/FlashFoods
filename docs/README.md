# Documentation Index

The repository accumulated several generations of documentation. Use this index to know
**which document to load and how much to trust it**. Freshness was checked against the source on
2026-10-29; when a document and the code disagree, the code wins.

Authority order for AI work is defined in `.ai/rules.md` §1/§15 (code → `.ai/rules.md` →
`.ai/goal.md` → …). The documents below are reference material; `.ai/*` is the active control plane.

## Legend

- **Current** — matches the source as of 2026-10-29; safe to rely on.
- **Partially stale** — core content still useful, but specific facts (routes, counts, test
  status) have drifted; verify in source before acting.
- **Historical** — a dated record; evidence only, never a claim about today's state.
- **Generated** — produced by tooling; regenerate instead of editing.
- **Agent rules** — active autonomous-agent instructions; do not edit as documentation cleanup.

## Start here

| Document | Status | Use it for |
|---|---|---|
| [README.md](../README.md) | Current | Onboarding, setup, commands, layout |
| [OMNIRUSH_PROJECT_CONTEXT.md](../OMNIRUSH_PROJECT_CONTEXT.md) | Current | Authoritative compact context: architecture, invariants, risks |
| [CODEBASE_CLEANUP_PLAN.md](../CODEBASE_CLEANUP_PLAN.md) | Current | Cleanup inventory, risks, execution order (proposals only) |
| [ROUTE_MAP.md](ROUTE_MAP.md) | Partially stale | Route inventory (missing `/api/auth/me`, `/profile`, `/vendor/verify-qr`, `/vendor/shop/discount`, `/vendor/shop/pickup-slots`; start from `routes/`) |
| [BUSINESS_RULES.md](BUSINESS_RULES.md) | Partially stale | Product rules; corrected for signup/pickup/mock-checkout, still check newer features against code |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current (flows) | Request/middleware flow, session, uploads, AI import |
| [MODEL_MAP.md](MODEL_MAP.md) | Partially stale | Model relationships; does not include `FcmToken`, `PickupSlotBooking`, or newer order fields |
| [PAYMENT_FLOW.md](PAYMENT_FLOW.md) | Current | Gateway flows, webhooks, refunds, per-shop config |
| [PERMISSIONS.md](PERMISSIONS.md) | Current | Role matrix and middleware guards |
| [SOCKET_EVENTS.md](SOCKET_EVENTS.md) | Current | `vendor:join` / `pending-count` contract |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Partially stale | Open risks; a few entries predate recent fixes (annotated where verified on 2026-10-29) |
| [TECH_DEBT.md](TECH_DEBT.md) | Current | Current debt register (merges the 2026-07-15 engineering audit) |
| [TESTING.md](TESTING.md) | Current | Unit + Playwright suites, isolated harness, destructive-test warning |
| [SYSTEM_MAP.md](SYSTEM_MAP.md) | Current | File → responsibility map |
| [STATUS.md](STATUS.md) | Historical | Snapshot dated 2026-07-15, superseded by `.ai/STATUS.md` |

## Historical records (evidence only)

| Document | Date / provenance |
|---|---|
| [BUG_REPORT.md](BUG_REPORT.md) | Sprint fix log (critical/high/medium), mostly fixed items |
| [STABILIZATION_PLAN.md](STABILIZATION_PLAN.md) | Sprint plan + verification passes |
| [ENGINEERING_AUDIT.md](ENGINEERING_AUDIT.md) | 2026-07-15 full audit; several findings fixed since (correction banner added) |
| [archive/BUG_REPORT.md](archive/BUG_REPORT.md) | QA 2026-09-24 |
| [archive/QA_REPORT.md](archive/QA_REPORT.md) | QA 2026-09-24, verdict PASS |
| [archive/REGRESSION_REPORT.md](archive/REGRESSION_REPORT.md) | QA 2026-09-24 regression re-check |
| [archive/SECURITY_REPORT.md](archive/SECURITY_REPORT.md) | QA 2026-09-24 security review |
| [archive/STAGE0_STATUS.md](archive/STAGE0_STATUS.md) | Stage 0 hardening status |
| [archive/STAGE1_ROADMAP.md](archive/STAGE1_ROADMAP.md) | Stage 1 roadmap (not executed as written) |
| [payment-architecture-V1.md](payment-architecture-V1.md) | Informal 2026 intent note (vendor-owned gateways, Razorpay first) |
| [CODEBASE_REVIEW.md](../md/CODEBASE_REVIEW.md) | Large pre-hardening code/security review (historical findings, some since fixed) |
| [INCIDENT_REPORT.md](../md/INCIDENT_REPORT.md) | 2026-08-19 unpaid-orders incident, production DB evidence |
| [report.md](../md/report.md) | 2026-08-06 QA report after test fixes |
| [MIGRATION_ASSESSMENT.md](../md/MIGRATION_ASSESSMENT.md) | Merged React + V2 migration assessment (planned, never executed; annotated 2026-10-29) |
| [STAGE0_PLAN.md](../md/STAGE0_PLAN.md) | Merged Stage 0 hardening plan with verified implementation outcome |
| [RUN-2026-10-02-2112.md](../.ai/test-reports/RUN-2026-10-02-2112.md) | Historical test run evidence (unit suite green) |

## Agent control plane (do not edit here)

[`.ai/`](../.ai) contains the live operating contract: `rules.md`, `ORCHESTRATOR.md`, `goal.md`,
`roadmap.md`, `test.md`, `bug_fix.md`, `git.md`, `permissions.md`, `STATUS.md`, `HISTORY.md`,
`BUSINESS_RULES.md`, `ARCHITECTURE.md`, `DEPENDENCY_GRAPH.md`, `COMMON_PATTERNS.md`,
`CODE_REVIEW_TEMPLATE.md`, `VALIDATION_CHECKLIST.md`, `UI_STANDARD.md`, `F08_ANALYSIS.md`.
They are loaded by `.ai/ORCHESTRATOR.md` §2. Treat `.ai/*` as active instructions; the `docs/` and
`md/` trees are reference/history.

## Generated

| Path | Notes |
|---|---|
| `graphify-out/` (previously contained `GRAPH_REPORT.md`) | Graphify analysis of the repo; git-ignored and regenerated on demand (cleared during the 2026-10-29 scratch cleanup) |

## Consolidation performed 2026-10-29

- [TECH_DEBT.md](TECH_DEBT.md) rewritten as the single current debt register, merging the still-valid
  parts of [ENGINEERING_AUDIT.md](ENGINEERING_AUDIT.md); fixed/stale claims (CSRF, cookie flags,
  `.bak`/cookie files, “no unit tests”, “single E2E test”, “canteen-bg unused”) were dropped or
  corrected there.
- [TESTING.md](TESTING.md) rewritten: the old version claimed a single E2E test and listed stale
  seed credentials. It now documents the 24-file unit suite, 13 Playwright specs, the isolated
  vendor-profile harness, and the destructive default Playwright configuration.
- [STATUS.md](STATUS.md) compressed to a dated historical snapshot pointing at the active
  `.ai/STATUS.md`.
- [SYSTEM_MAP.md](SYSTEM_MAP.md) rewritten to match the real tree (removed non-existent
  `security-hardening/k6.js`, `menu-import/index.js`, `views/student/*`).
- `docs/pilot bugs.md` (0 bytes, unreferenced) removed.
- [ENGINEERING_AUDIT.md](ENGINEERING_AUDIT.md) kept verbatim for history with a correction banner.
- [../OMNIRUSH_PROJECT_CONTEXT.md](../OMNIRUSH_PROJECT_CONTEXT.md) compressed from ~34 KB of
  subsystem narration to a verified reference (roles, flows, invariants, risks, procedures).
- [../README.md](../README.md) expanded from two words into onboarding documentation.

### Report merges performed 2026-10-29 (documentation-only)

- `REACT_MIGRATION_REPORT.md` + `ROUTE_MIGRATION_REPORT.md` (57 KB, two copies of the same route
  inventory) → [`../md/MIGRATION_ASSESSMENT.md`](../md/MIGRATION_ASSESSMENT.md) (one registry, one
  React architecture, one API-contract and ordering section, plus a “what changed since” section).
- `STAGE0_HARDENING_PLAN.md` + `STAGE0_EXECUTION_PLAN.md` (33 KB of overlapping design/lint
  detail) → [`../md/STAGE0_PLAN.md`](../md/STAGE0_PLAN.md) (blockers, fixes, commit history and
  the verified outcome per blocker).
- The four source reports were removed after their unique content was carried over; their history
  remains in Git.

Overlaps left in place on purpose (candidates in the cleanup plan, not deleted):
`BUG_REPORT.md` vs `archive/BUG_REPORT.md`, and `payment-architecture-V1.md` vs `PAYMENT_FLOW.md`.
