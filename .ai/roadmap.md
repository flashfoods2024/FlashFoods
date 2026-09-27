# FlashFoods Roadmap — Active / Future Work

## Roadmap Philosophy

This document defines the preferred path to the goal. It is guidance, not a rigid script.

If a recommended implementation path does not fit the actual codebase:

1. identify why it fails,
2. inspect the dependency causing the problem,
3. design the smallest safe alternative,
4. implement the alternative,
5. test it,
6. continue toward the same goal.

Never abandon the feature merely because the preferred implementation path failed.

## Execution Rule

For every feature:

BUILD → FEATURE TEST → FIX → RETEST → VERIFY → PASS

Only after the current feature passes may the next feature begin.

## Completed

Stage 1 (F01–F05, F06/F06.5, F07) is COMPLETE — details in `.ai/HISTORY.md`.
No feature is currently active (`goal.md`: NONE).

## Candidate Future Work (unplanned, unordered)

Carried forward from history — each needs a goal definition before execution:

1. E2E/load environment isolation (staged DB, harness prod-guard).
2. Slot-reservation expiry sweep for abandoned `pending_payment` orders.
3. Auth hardening backlog: Socket.IO auth, MemoryStore replacement, CSRF, session invalidation on reset. (Rate limiting is excluded by product policy.)
4. Easebuzz completion-or-disable; analytics-cache performance.
5. Playwright fixture seeding for the shared suite.

## After Each Future Feature

Run the post-feature quality sequence defined in `test.md`:

1. comprehensive test of all newly built features,
2. risk-based regression of affected modules from highest to lowest risk,
3. security-focused verification,
4. smoke tests,
5. stress/load tests where applicable,
6. global application test across student, vendor, and admin panels.

## Recovery Rule

If any later test reveals a regression in an earlier feature, return to that feature, use `bug_fix.md`, fix the root cause, retest it, then resume the roadmap.
