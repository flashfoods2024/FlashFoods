# FlashFoods Autonomous Git Protocol

## Purpose

Git is part of the autonomous engineering workflow. The agent must create a recoverable local commit checkpoint after each feature has genuinely passed its required tests.

This file governs local Git commit behaviour. It does not authorize GitHub, GitLab, remote pushes, pulls, or other external repository operations.

## Core Rule

**NEVER commit a feature before that feature has passed its required tests and verification.**

The required sequence is:

BUILD
→ TEST
→ FIX
→ RETEST
→ VERIFY
→ PASS
→ UPDATE STATUS
→ REVIEW DIFF
→ COMMIT

A passing build alone is not sufficient for a commit.

## Per-Feature Commit Gate

For every feature in `goal.md`:

1. Complete the feature implementation.
2. Run the feature-specific tests defined in `test.md`.
3. If any test fails, follow `bug_fix.md`, fix the root cause, and retest.
4. Perform the feature verification defined by `test.md`.
5. Confirm the feature's Definition of Done is satisfied.
6. Update `STATUS.md` to record the feature as PASS/COMPLETE.
7. Review the working-tree changes before staging anything.
8. Stage **only files belonging to the completed feature and the related status/documentation update**.
9. Create one local Git commit for that completed feature.
10. Record the commit hash/message in `STATUS.md` or the appropriate execution report.
11. Only after the commit succeeds may the agent move to the next feature.

## Commit Isolation

Never blindly use:

```bash
git add .
```

or

```bash
git add -A
```

when unrelated working-tree changes may exist.

Before staging:

- inspect the changed-file list;
- identify which files belong to the current feature;
- do not stage unrelated user work;
- do not stage `.env`, credentials, secrets, generated private data, or unrelated files;
- stage only the intended feature changes plus the required status/documentation change.

If unrelated local changes are present and cannot be safely separated, do not overwrite, reset, discard, or commit them. Stop and report the separation problem unless a safe non-destructive method is available.

## Commit Message Convention

Use:

```text
feat(<feature-id>): <concise feature description>
```

Examples:

```text
feat(F01): implement student profile
feat(F02): implement vendor profile analytics
feat(F03): implement shop operating hours
```

Bug-fix commits created while completing a feature should remain part of the feature's completion workflow unless the roadmap explicitly requires a separate commit.

## Commit Verification

After creating a commit:

- verify the commit was created successfully;
- verify the intended files were included;
- verify no unrelated files were committed;
- record the commit identifier in the execution state where practical.

If the commit fails, diagnose and fix the Git issue without altering or deleting unrelated working-tree changes.

## Feature Progression Gate

The agent must NOT begin the next feature until all of these are true for the current feature:

- implementation complete;
- required feature tests pass;
- required regression checks pass;
- verification passes;
- `STATUS.md` updated;
- local Git commit created successfully.

## End-of-Goal Commit

After all features have passed and the final comprehensive, risk-based, and global tests pass, create a final documentation/state commit when there are uncommitted changes belonging to the completed goal.

Suggested format:

```text
chore(stage): finalize <goal-id> status and report
```

Do not create a meaningless empty commit.

## Remote Repository Rule

Local Git commits are allowed under this protocol.

The agent must NOT:

- `git push`
- `git pull`
- `git fetch` from remotes
- modify remote repositories;
- use GitHub APIs;
- use GitLab APIs;
- change remote URLs;
- modify GitHub/GitLab settings.

Remote synchronization remains a manual user-controlled action unless a future project rule explicitly changes this policy.

## Safety Rule

A Git commit is a checkpoint, not permission to ignore tests.

Never:

- commit failing tests as a completed feature;
- skip verification to create a commit;
- amend/rewrite previous feature commits merely for cosmetic reasons;
- reset/discard user work to make a commit easier;
- force-push or rewrite remote history.
