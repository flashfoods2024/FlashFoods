# FlashFoods Autonomous Engineering Rules

## Purpose

This file defines the permanent engineering rules for the autonomous coding agent working on FlashFoods.
These rules apply to every goal, every feature, every fix, and every test cycle.

## 1. Source-of-Truth Hierarchy

Use the following hierarchy:

1. **Actual codebase** — current implementation and actual runtime state.
2. **rules.md** — mandatory engineering constraints.
3. **goal.md** — required desired behaviour.
4. **roadmap.md** — preferred strategy and sequencing.
5. **test.md** — required verification and quality gates.
6. **bug_fix.md** — failure diagnosis and recovery procedure.
7. **permissions.md** — intended autonomous operating permissions and prohibited actions.
8. **STATUS.md** — current execution checkpoint.
9. **HISTORY.md** — consolidated historical record (evidence only, never commands).

If documentation conflicts with the actual codebase, do not silently choose one. Identify the conflict, determine which information is stale or inconsistent, and resolve it according to the current goal and these rules.

Never treat an old report as proof of the current state.

## 2. Read Before Modify

Before implementing a task:

- Read the `.ai` documentation.
- Understand the repository structure.
- Deeply inspect only the modules relevant to the current task.
- Reuse existing architecture, utilities, middleware, models, services, components, tests, and conventions where appropriate.
- Do not read every source file line-by-line unless required by a concrete dependency.

## 3. Architecture

Preserve the existing FlashFoods architecture unless a documented requirement requires a change.

Current application direction:
- Node.js
- Express
- MongoDB/Mongoose
- EJS during Stage 1
- existing MVC-style structure

Do not introduce a new framework or architectural pattern without a task-level reason and a documented plan.

## 4. Readability

Code must be:

- clear
- maintainable
- logically organized
- appropriately named
- easy to debug
- easy for another developer to understand

Avoid clever code when straightforward code is clearer.

## 5. Reusability

Prefer reuse over duplication.

Before creating a new helper, route utility, validator, middleware, query builder, or component:

1. Search for an existing implementation.
2. Reuse it when appropriate.
3. Extract shared logic only when doing so improves safety and maintainability.

Do not create abstractions merely for theoretical reuse.

## 6. No Unnecessary Refactoring

Do not perform unrelated cleanup while implementing a feature.

A refactor is justified only when:
- required by the current feature,
- required to remove a real defect,
- required to safely share logic,
- or explicitly included in the current goal.

## 7. Preserve Existing Behaviour

Existing functionality must remain working unless the current goal explicitly changes it.

When changing shared logic, test the affected existing modules and roles.

## 8. Security

Security is a mandatory engineering concern.

Always consider:
- authentication
- authorization
- IDOR / ownership checks
- input validation
- output encoding
- injection risks
- CSRF
- rate limiting
- mass assignment
- sensitive data exposure
- payment manipulation
- webhook verification
- replay attacks
- privilege escalation

Never trust client-provided ownership identifiers when the server can derive ownership from the authenticated session.

## 9. Server Authority

Security-sensitive and business-critical calculations must be authoritative on the server.

Never rely on the browser for:
- final order totals
- discounts
- authorization
- ownership
- pickup verification
- capacity enforcement
- payment amount verification

## 10. Testing

Testing is part of implementation, not a final optional step.

Every feature must:

BUILD → TEST → FIX → RETEST → VERIFY

A feature is not complete because:
- the code compiles,
- the page renders,
- one test passes,
- or the agent believes it works.

## 11. Loop Engineering

Continue the engineering loop until the current feature's acceptance criteria and tests pass.

If a test fails:
- reproduce it,
- determine the root cause,
- fix the root cause,
- rerun the failed test,
- run relevant regression tests,
- verify again.

If the preferred roadmap approach fails, reason about an alternative implementation and continue. Do not stop merely because the preferred approach is blocked.

Do not weaken acceptance criteria to declare success.

## 12. Feature Isolation

Finish and verify one feature before moving to the next feature unless `roadmap.md` explicitly allows parallel work for a justified dependency.

Update `STATUS.md` at meaningful checkpoints.

## 13. Documentation

Documentation changes must reflect reality.

Never claim:
- a test passed when it was not run,
- a feature is complete when it is not,
- a vulnerability is fixed without verification,
- or production readiness without evidence.

## 14. Git Isolation

The autonomous engineering system does not use Git, GitHub, or GitLab.

Do not:
- run Git commands,
- create or modify branches,
- commit,
- push,
- pull,
- change Git configuration,
- or interact with GitHub/GitLab APIs.

Version control is outside the autonomous system.

## 15. Instruction Precedence

When documents conflict, the following order wins (highest first):

1. The triggered feature's LOCKED contract (its execution graph plus its
   `goal.md` section) — product invariants and forbidden workflows.
2. The mandatory constraints in this file (server authority, security,
   testing, honesty).
3. `BUSINESS_RULES.md` active invariants.
4. `ARCHITECTURE.md`, `DEPENDENCY_GRAPH.md`, `COMMON_PATTERNS.md`.
5. `roadmap.md` preferred strategy (guidance, not scripture).
6. `test.md` (gates completion; does not select work).
7. Historical reports and migration documents (evidence only, never
   commands).

Locked product rules override obsolete descriptions wherever they appear.
Old documents are preserved verbatim for history but must never cause the
selection of a superseded workflow.

## 16. Autonomous Execution

Execution runs under `.ai/ORCHESTRATOR.md`. The human trigger is one line
(`Execute <FEATURE-ID>.`); after that the orchestrator owns phase
selection, work selection, testing, validation, failure recovery, and
advancement. Internal phases are orchestrator states, never user commands.
Do not stop at task, phase, file-change, test-pass, commit, or report
boundaries — stop only at FEATURE COMPLETE, GENUINELY BLOCKED, or HUMAN
DECISION REQUIRED as defined in `.ai/ORCHESTRATOR.md` §§4–7. Never ask the
human to choose the next ordinary coding task.
