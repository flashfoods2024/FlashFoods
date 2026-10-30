# FlashFoods Autonomous Orchestrator

This is the control plane. It turns one human trigger into a complete
feature execution with no further human task selection.

## 1. Trigger contract

The human supplies exactly one line:

```text
Execute <FEATURE-ID>.
```

Example: `Execute F07.`

That line transfers ownership of ALL of the following to the orchestrator:

- phase selection, work selection, implementation order,
- test execution, validation, failure diagnosis and repair,
- state recording, dependency recalculation, phase advancement,
- final completion determination.

The human must NEVER be asked to invoke an internal phase, task, test,
validation, or "next step" (no `execute F07.1`, no "tell me to continue").

## 2. Startup load order

On trigger, load in this order before touching code:

1. The active feature contract. For F09 this is the locked F09 section in
   `goal.md` plus the phase graph in `roadmap.md`; use a separate execution
   graph only when one actually exists.
2. `rules.md` — mandatory engineering constraints.
3. `BUSINESS_RULES.md` — product invariants (plus the feature's locked
   contract, which overrides history).
4. `ARCHITECTURE.md`, `DEPENDENCY_GRAPH.md`, `COMMON_PATTERNS.md` — HOW the
   codebase works.
5. `STATUS.md` — current execution state (what is already complete).
6. `test.md` — quality gates that will judge the work.
7. `bug_fix.md`, `git.md`, `permissions.md` — failure loop, commit gates,
   authority limits.

## 3. Execution loop

```text
START FEATURE
  ↓
READ FEATURE CONTRACT + RULES + STATE (see §2)
  ↓
RESOLVE DEPENDENCY GRAPH → eligible phases / work units
  ↓
SELECT the single current eligible phase (lowest unmet dependency first)
  ↓
SELECT eligible internal work within that phase only
  ↓
INSPECT actual code (re-verify; never trust a stale report)
  ↓
IMPLEMENT smallest change satisfying the phase scope
  ↓
TEST (phase tests from the execution graph + `test.md`)
  ↓
REVIEW (CODE_REVIEW_TEMPLATE.md concerns: security, authority, races)
  ↓
VALIDATE against phase acceptance criteria
  ↓
RECORD result in STATUS.md (phase state, evidence, not claims)
  ↓
RECALCULATE graph eligibility
  ↓
ADVANCE only after the current phase is fully verified (§4), or stop as
  FEATURE COMPLETE, GENUINELY BLOCKED, or HUMAN DECISION REQUIRED (§7)
```

This loop is per-feature and reusable: every future feature gets an execution
graph with the same shape (phases → work units → dependencies → gates) and runs
under this same loop. F09 uses the locked contract in `goal.md` and the
phase-level graph in `roadmap.md`; no additional feature file is implied by
this documentation update.

## 4. Verified phase transitions

After each work unit in the current phase, ask in order:

1. "Is the CURRENT PHASE complete?" — complete means ALL of: implementation
   done AND required tests pass AND acceptance criteria pass AND validation
   passes. Code or documentation existing is NOT enough.
2. If incomplete, remain in the current phase and repair or finish it. Do not
   begin work belonging to a dependent phase.
3. If complete, record the phase evidence in `STATUS.md`, then ask whether the
   NEXT PHASE is eligible because every dependency is complete.
4. If all required phases are complete, run the final feature gate and mark the
   FEATURE complete.

The orchestrator may select the next eligible phase automatically after the
current phase has passed and its status is recorded; a human does not need to
issue a second ordinary trigger. It must not combine phases, skip a phase gate,
or continue after a critical regression, blank state, security/payment/order
regression, stale-handler leak, or disproved architectural assumption. In
those cases mark the phase BLOCKED or return to the same phase through
`bug_fix.md`.

## 5. Dependency-driven eligibility

Never execute phases merely because their numbers are sequential. A phase
or work unit is ELIGIBLE only when every declared dependency is complete
(evidence in STATUS.md or freshly verified, not assumed).

```text
unfinished work → resolve graph → eligible subset → execute →
validate → update graph → recalculate eligibility → repeat
```

If a dependency is incomplete, its dependents are NOT ELIGIBLE. The
orchestrator automatically picks another eligible unit if one exists;
otherwise it works the blocking dependency itself. Blocked-with-nothing-
eligible is the only legitimate idle state (see §6).

## 6. Failure behavior (delegates, does not duplicate)

- Implementation failure: do NOT mark complete → follow `bug_fix.md`
  (reproduce → root cause → smallest fix → retest → regress → verify) →
  re-enter the loop at the same phase.
- Test failure: current work stays incomplete; dependent work stays locked;
  fix, re-run the failed test, then the relevant regression set.
- Unresolvable within authority: mark BLOCKED with reason in STATUS.md,
  stop only the blocked path, continue unrelated eligible work when safe.
- Never mark failed work complete. Never lower acceptance criteria.
- Commit gates per `git.md`: commit only after a phase/feature genuinely
  passes; a commit never ends the loop (§4).
- For F09, a navbar identity change, duplicate Liquid Glass renderer, broken
  direct navigation, unsafe mutation interception, blank destination, or
  leaked page listener/timer is a critical regression. Stop the F09 path until
  it is fixed and the affected phase checks pass again.

## 7. Human intervention (genuine decisions only)

Request human input ONLY for:

- contradictory product requirements with no repository evidence to resolve,
- undefined business decisions,
- missing authorization / credentials,
- destructive or irreversible actions outside `permissions.md`,
- architectural conflicts unresolvable from code evidence,
- work outside the triggered feature's authority.

NEVER ask the human to choose the next ordinary coding task, test run,
or phase. "Which phase next?" is always answered by §5, never by the user.

## 8. State recording

- `STATUS.md` is the execution checkpoint: current feature, current phase,
  per-phase state (`PENDING / IN_PROGRESS / COMPLETE / BLOCKED`), evidence
  (commands run, results), commit hashes. Update it at every phase
  transition. Never claim an unexecuted test passed (`rules.md` §13).
- For F09, record the distinction between the completed pre-existing navbar
  blinking fix, the planned persistent-shell target, and actual phase evidence.
  Documentation preparation alone leaves every implementation phase `PENDING`.
- `HISTORY.md` is the consolidated historical record — read-only history,
  never active commands.

## 9. Instruction precedence

When documents conflict, this order wins (highest first):

1. The triggered feature's LOCKED contract (execution graph + `goal.md`
   feature section) — product invariants, forbidden workflows.
2. `rules.md` mandatory constraints (server authority, security, testing).
3. `BUSINESS_RULES.md` active invariants.
4. `ARCHITECTURE.md` / `DEPENDENCY_GRAPH.md` / `COMMON_PATTERNS.md`.
5. `roadmap.md` preferred strategy (guidance; adapt when code disagrees).
6. `test.md` gates completion but does not select work.
7. Historical reports and migration docs — evidence only, never commands.

Locked product rules override obsolete descriptions wherever they appear;
generic suggestions never override feature requirements. If the codebase
contradicts documentation, follow `rules.md` §1: identify the conflict and
resolve toward the current goal — do not silently pick a side.

## 10. F09 starting state

`Execute F09.` starts with **Phase 1 — Baseline and focused proof** in
`roadmap.md`. The current source still performs ordinary full-document
navigation; the footer skeleton listener is progressive enhancement only. The
completed navbar blinking fix is protected behavior, not evidence that the
persistent shell has been built. No F09 phase may be marked complete from this
documentation update alone.

## 11. Obsolete-workflow protection

Old documents describe workflows the active contract has superseded
(OTP-only pickup, vendor confirm buttons, intermediate pickup states,
reversed scan direction). Those records are preserved verbatim for history.
The orchestrator must NEVER select an obsolete workflow merely because an
old document describes it: precedence §9 plus the feature graph's explicit
FORBIDDEN list always win. When an old doc conflicts with the active
contract, the active contract governs and the conflict is noted, not
followed.
