# FlashFoods Autonomous Agent Permissions

## Purpose

Minimize routine manual babysitting while keeping consequential actions controlled.

## Startup Permission Behaviour

At the beginning of an autonomous run, request all permissions required for the planned work in one startup pass where the execution environment supports this.

After the required permissions are granted, do not repeatedly pause for ordinary actions covered by this file.

## Intended Allowed Actions

The agent may autonomously:

- inspect the repository,
- read project files,
- read `.ai` documentation,
- read and write project source files,
- create and edit tests,
- create and update documentation,
- install required development dependencies when appropriate,
- run the application locally,
- run local test suites,
- run local scripts and tooling,
- run test servers/harnesses,
- create or modify implementation files,
- execute approved tasks in `goal.md` and `roadmap.md`,
- update `status.md`,
- replace the execution contents of `report.md` at the appropriate reporting checkpoint,
- run local Git commands required by `git.md`,
- create local Git commits after the required testing/verification gates pass.

## Git Boundary

Local Git inspection and local commits are allowed only according to `git.md`.

The agent may use local Git for:

- checking changed files before staging,
- reviewing the local diff before a feature commit,
- staging only feature-related changes,
- creating feature completion commits,
- verifying created local commits.

The agent must NOT autonomously perform:

- `git push`,
- `git pull`,
- remote `git fetch`,
- GitHub operations,
- GitLab operations,
- remote repository configuration changes,
- GitHub/GitLab API calls.

## Prohibited Actions

Do not autonomously perform:

- destructive filesystem operations unrelated to the goal,
- production deployment,
- production database deletion or irreversible mutation,
- credential rotation/change,
- secret extraction or disclosure,
- external service configuration changes unless explicitly required and separately authorized,
- irreversible data deletion,
- modification of remote repositories.

## Secret Handling

Never print, paste, expose, or include secret values from `.env` or equivalent configuration in reports.

Do not include API keys, passwords, tokens, private keys, payment secrets, or credentials in generated documentation or Git commit messages.

Never stage `.env` or known secret-bearing files unless explicitly required and safely handled by a separate project rule.

## Permission-System Limitation

This file defines the project's intended autonomous permission policy. It does not override operating-system, IDE, provider, sandbox, or tool-level permission enforcement.
