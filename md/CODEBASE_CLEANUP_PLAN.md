# Codebase Cleanup Plan

**Audit date:** 2026-10-29 · **Scope:** full repository (source, assets, tests, docs, tooling)
**Status:** documentation consolidation implemented. Batch 1 (ignored scratch) and the
report merges were **executed on 2026-10-29 with the user's request**; every other removal below
remains a proposal. No application source, config, test, asset, dependency or Git history was
changed.

---

## 1. Executive summary

### What the repository actually looks like

- **233 tracked files at audit start, ≈7.0 MB tracked** (`du` over `git ls-files`). The application itself is
  ~1.2 MB of source/assets; the rest is documentation (~0.5 MB), tests (~0.39 MB), the lockfile
  (180 KB) and large images.
- **The real size was untracked scratch**, not the repo: `temp/` was ≈ **71 MB** (50 MB Gemini
  debug dumps + 21 MB orphaned menu-import uploads) and `graphify-out/` ≈ **2.3 MB**. Both are
  git-ignored and were **cleared on 2026-10-29** (now 12 KB and 16 KB, containing only empty
  runtime dirs and graphify's small path/label metadata). `node_modules/` ≈ 386 MB and `.git/`
  ≈ 38 MB remain outside cleanup scope.
- **No dead application modules were found.** All route files are mounted, all models are used,
  all `public/js/*` files are loaded by templates or the service worker, and all images/fonts/audio
  are referenced (including `public/images/canteen-bg.png`, which several old documents wrongly
  call unused — it is in the service-worker precache list).
- **All runtime dependencies have consumers** (`ejs` is resolved by Express as the view engine;
  `liquid-gl` is vendored into `public/js/vendor/`). The only package with no consumer anywhere is
  `@types/node`, in a JavaScript-only project with no `tsconfig` or TypeScript files.

### Documentation condition (before this task)

53 Markdown files across four generations: root onboarding (2 words), `OMNIRUSH_PROJECT_CONTEXT.md`
(34 KB of subsystem narration, some stale), `docs/` (17 reference/historical files),
`md/` (7 historical reports, ~168 KB), `.ai/` (18 autonomous-agent files), plus a generated
`graphify-out/GRAPH_REPORT.md`.

The main problem was not volume but **freshness and overlap**: `docs/TECH_DEBT.md` and
`docs/ENGINEERING_AUDIT.md` claimed “no unit tests / one E2E test / no CSRF” long after those were
fixed; `docs/STATUS.md` froze a 2026-07-15 snapshot; `docs/SYSTEM_MAP.md` documented files that do
not exist; `docs/TESTING.md` listed wrong seed credentials and one test. Meanwhile three migration
and two Stage-0 planning reports duplicated each other.

### What was improved (Markdown only)

- `OMNIRUSH_PROJECT_CONTEXT.md`: 34,372 → 20,080 bytes (−42 %), rewritten from verified source with
  14 actionable sections (roles, stack, structure, feature map, flows, models, invariants,
  security, workflows, tests, risks, UI decisions, limitations, procedure).
- `README.md`: 23 bytes → 3.8 KB onboarding (setup, commands, layout, doc map, operational warnings).
- `docs/README.md` (**new**): index with freshness/authority for every document, plus the
  consolidation record and a clear “agent rules, do not edit” list.
- `docs/TECH_DEBT.md`: rewritten as the single current register, merging the still-valid parts of
  `ENGINEERING_AUDIT.md`, with measured line counts and a “resolved/invalidated since 2026-07-15”
  section.
- `docs/TESTING.md`: rewritten with the real 24-file unit suite, 13 Playwright specs, isolated
  vendor-profile harness, correct seed credentials, and the destructive-config warning.
- `docs/STATUS.md`: compressed to a dated historical snapshot pointing at `.ai/STATUS.md`.
- `docs/SYSTEM_MAP.md`: rewritten to the actual tree (removed `security-hardening/k6.js`,
  `menu-import/index.js`, `views/student/*`, which never existed in this revision).
- `docs/BUSINESS_RULES.md`: four evidence-based corrections (student-only signup + phone
  requirement, default variant price, QR-first pickup with OTP fallback, mock checkout restriction).
- `docs/ENGINEERING_AUDIT.md`: kept verbatim for provenance with a correction banner.
- `docs/pilot bugs.md` (0 bytes, unreferenced): removed.

**Documentation footprint after the report merges (2026-10-29): ≈464 KB across 51 Markdown files,
with `md/` reduced from 168 KB / 7 files to 108 KB / 5 files.** The four heavy planning reports
were merged into two, removing ~60 KB of duplicated route tables and task lists while keeping
their unique content and the “what changed since” corrections. Historical evidence was retained; only the empty
`docs/pilot bugs.md` and the four superseded planning files were removed.

### What remains untouched

Every `.js`, `.ejs`, `.css`, image, font, audio file, test, config, workflow, lockfile, `.ai/*` rule
and `.env`-adjacent file. No dependency, build, service-worker, database or Git operation was
performed.

---

## 2. Cleanup inventory (evidence-backed)

Classification: **A** strong removal candidate · **B** potential, needs more verification ·
**C** must retain · **D** unknown.

### A. Strong removal candidates — **executed 2026-10-29**

| Path | Before | Purpose / origin | Evidence of non-use | Action taken | If assessment is wrong |
|---|---|---|---|---|---|
| `temp/debug/**` (15 timestamped session dirs) | 50 MB | Gemini menu-import debug dumps written by `menu-import/debug.js` | Only writer is `DebugSession`; nothing reads these files; dir auto-created on demand | **Cleared**, empty dir kept | Lose historical AI-extraction diagnostics (one-off). No runtime impact |
| `temp/imports/**` (~90 png files) | 21 MB | Stale uploads from `menu-import/upload.js` | Import sessions are in-memory; no reader after restart; `upload.js` recreates the dir | **Cleared**, empty dir kept for the running dev server | None; a live import session would already be lost by its in-memory store |
| `temp/qa-vendor-profile-fixture.json` | <4 KB | Fixture for the isolated E2E harness | Regenerated by `npm run test:e2e:vendor-profile` | **Removed** | None; regenerated |
| `temp/ui-redesign-fixture.json` | <4 KB | Fixture from a QA harness no longer present | No writer/reader in the repo | **Removed** | None |
| `graphify-out/**` | 2.3 MB | Generated graph data/report | Git-ignored, regenerable | **Cleared** (kept `.graphify_labels.json`, `.graphify_root`, `.graphify_python` metadata) | Only the generated snapshot is lost |
| `playwright-report/**`, `test-results/.last-run.json` | ~4 KB | Playwright output | Regenerated by any test run | **Cleared** | None |
| `docs/pilot bugs.md` | 0 B | Empty placeholder | No references | **Removed** | None |

Measured reclaimed: **≈73.3 MB** of working-tree scratch, all git-ignored (0 bytes of tracked
history). Unit suite and an isolated boot re-verified after the clear (see §7).

### B. Potential candidates (verify before acting)

| Path | Size | Why considered | Verification needed | Risk if wrong |
|---|---|---|---|---|
| `public/images/canteen-bg.png` | 1.26 MB | Never displayed; only consumer is the `PRECACHE` array in `public/sw.template.js` | To remove, delete the file **and** the precache entry together, then run `tests/mobile/pwa-installability.spec.js` + a real SW install. Removing the file alone makes `cache.addAll` reject → service worker install fails | Breaks offline install / PWA checks; medium-high |
| `public/js/vendor/liquidGL.js` | 297 KB | Generated from `node_modules/liquid-gl@3.0.0` by `npm run vendor:liquidgl` (postinstall) | Could be git-ignored like `sw.js`, but only if every deploy runs postinstall and static serving is guaranteed | Liquid Glass effects fail to load; high visibility on student UI |
| `@types/node` (devDependency) | small | No TypeScript, no `tsconfig`, no import | Search confirms zero consumers; developers may rely on editor types | Minor: editors lose Node global typings |
| ~~`md/ROUTE_MIGRATION_REPORT.md` + `md/REACT_MIGRATION_REPORT.md`~~ | 23 KB / 34 KB | Heavy overlap: both inventory every route for a migration never executed | **Done** — merged into `md/MIGRATION_ASSESSMENT.md` | — |
| ~~`md/STAGE0_HARDENING_PLAN.md` + `md/STAGE0_EXECUTION_PLAN.md`~~ | 17 KB / 16 KB | Both describe completed Stage-0 work | **Done** — merged into `md/STAGE0_PLAN.md` with verified outcomes | — |
| `docs/archive/*` (5 files) | 16 KB | Dated QA/security/regression/stage reports | Keep at least one dated QA/security record; could move all to `docs/history/` | Losing audit provenance (low, but unnecessary risk) |
| `docs/payment-architecture-V1.md` | 295 B | Informal intent note superseded by `docs/PAYMENT_FLOW.md` | Confirm PAYMENT_FLOW covers per-shop gateways + phasing (it does) | Trivial |
| `scripts/migrate-menu-prices.js` | 1.9 KB | One-off variant migration; only referenced by docs | Check whether any deployment still needs it; it mutates the configured DB | Low; retain until confirmed |
| `.gitignore` entry `ui_redesign/` | 0 | Directory no longer exists | Confirm no branch/worktree uses it | None (cosmetic, config change) |

Tracked size potentially recoverable from B: **1.26 MB + 0.30 MB** ≈ **1.6 MB** remaining (the
documentation part was already realized: the report merges freed ~60 KB). Every remaining item
requires a source/config change and its own verification, so none was executed.

### C. Must retain (evidence of use)

| Area | Files | Evidence |
|---|---|---|
| Entry/config | `server.js`, `package.json`, `package-lock.json`, `nodemon.json`, `playwright*.config.js`, `.env.example` | Boot path, scripts, test harness |
| App code | `routes/**`, `models/**`, `middleware/**`, `utils/**`, `config/**`, `socket/**`, `menu-import/**`, `seed.js`, `build-scripts/**`, `scripts/qa-vendor-profile-server.mjs` | All mounted/imported (dependency check) |
| Views | all 48 `views/**/*.ejs` | Rendered by routes/partials |
| Client assets | `public/styles.css`, `public/js/*`, `public/js/firebase/*`, `public/sw.template.js`, `public/firebase-messaging-sw.js`, `public/manifest.json` | Loaded by `views/partials/header.ejs`, `footer.ejs`, SW registration |
| Media | `public/background-image.png` (CSS), `public/images/student_home_background.png` (CSS), `public/images/canteen-bg.png` (SW precache), `public/icon.png` (header + precache + PWA test), `public/icons/icon-192x192.png` (manifest/FCM), `public/fonts/Transcity-DEMO.otf` (`@font-face`), `public/audio/ringing_sound.mp3` (`notification-manager.js`), `public/food-placeholder.svg` (three templates + precache) | Grep + CSS/SW review |
| Licensing | `1001fonts-transcity-eula.txt`, `Readme (DEMO).txt` | Font license terms for `Transcity-DEMO.otf`; keep for legal provenance |
| Tests | `tests/**`, `tests/global-setup.mjs`, `tests/global-teardown.mjs` | 301 unit tests + 13 specs; baseline |
| CI | `.github/workflows/playwright.yml` | Active unit-test CI |
| Generated-at-runtime | `public/sw.js`, `public/version.json` (present, git-ignored) | Served by `server.js`; regenerated by `build:version` |
| Agent system | `.ai/**` | Active autonomous rules; excluded from this cleanup by instruction |
| Current docs | `README.md`, `OMNIRUSH_PROJECT_CONTEXT.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/BUSINESS_RULES.md`, `docs/KNOWN_ISSUES.md`, `docs/PAYMENT_FLOW.md`, `docs/PERMISSIONS.md`, `docs/ROUTE_MAP.md`, `docs/SOCKET_EVENTS.md`, `docs/TECH_DEBT.md`, `docs/TESTING.md`, `docs/SYSTEM_MAP.md`, `docs/MODEL_MAP.md` | Unique operational/reference value |

### D. Unknown / investigate

| Path | Size | Why unknown |
|---|---|---|
| `.freebuff/project-id` | 37 B | Local agent-tool metadata, untracked, no code reference. Harmless; leave to the tool |
| `temp/chunks/` (absent now) | – | Created on demand by `menu-import/splitter.js`; do not remove the parent `temp/` directory |
| `.ai/F08_ANALYSIS.md` | 21 KB | References `ui_redesign/*.png` that no longer exist; historical analysis, agent-owned — propose only |
| `graphify-out/GRAPH_REPORT.md` | 18 KB | Generated; may be used by the graphify skill in other sessions |
| `public/background-image.png` vs `public/images/student_home_background.png` | 1.6 / 1.6 MB | Different hashes and both referenced, but visually similar; a future art-direction decision could consolidate them (would touch CSS) |

---

## 3. Documentation consolidation record

| Document | Action | Unique information preserved in |
|---|---|---|
| `README.md` | Rewritten (23 B → 3.8 KB) | Self-contained onboarding |
| `OMNIRUSH_PROJECT_CONTEXT.md` | Rewritten/compressed (−14.3 KB) | The file itself (§1–§14) |
| `docs/README.md` | **Created** | Index + status + this record |
| `docs/TECH_DEBT.md` | Rewritten (merged audit) | Debt items 1–17 + “resolved since” list |
| `docs/TESTING.md` | Rewritten | Suite list, commands, seed data, destructive warning, gaps |
| `docs/STATUS.md` | Compressed to historical snapshot | Dated 2026-07-15 table + superseded note |
| `docs/SYSTEM_MAP.md` | Rewritten accurately | File → responsibility map |
| `docs/BUSINESS_RULES.md` | 4 inline corrections | Same document, now matches code |
| `docs/ENGINEERING_AUDIT.md` | Correction banner added, content kept | Historical audit + explicit corrections |
| `docs/pilot bugs.md` | **Removed** (empty, unreferenced) | Nothing to preserve |
| `docs/payment-architecture-V1.md` | Retained (historical) | Indexed as historical |
| `docs/ARCHITECTURE.md`, `PAYMENT_FLOW.md`, `PERMISSIONS.md`, `SOCKET_EVENTS.md`, `MODEL_MAP.md`, `ROUTE_MAP.md`, `KNOWN_ISSUES.md`, `BUG_REPORT.md`, `STABILIZATION_PLAN.md` | Retained | Indexed with status |
| `docs/archive/*` (5) | Retained | Indexed as historical |
| `md/MIGRATION_ASSESSMENT.md` | **Created** (merged two reports) | Route registry, V2 surface, React architecture, API contracts, ordering, changes-since |
| `md/STAGE0_PLAN.md` | **Created** (merged two plans) | Blockers, fixes, commit history, verified outcome per blocker |
| `md/REACT_MIGRATION_REPORT.md`, `md/ROUTE_MIGRATION_REPORT.md` | **Removed after merge** | Unique content preserved in `MIGRATION_ASSESSMENT.md` |
| `md/STAGE0_HARDENING_PLAN.md`, `md/STAGE0_EXECUTION_PLAN.md` | **Removed after merge** | Unique content preserved in `STAGE0_PLAN.md` |
| `.ai/**` (18) | **Untouched** | Active agent rules |
| `graphify-out/GRAPH_REPORT.md` | Untouched (generated) | Regenerate |

No document was deleted except the empty placeholder. No historical report was discarded.

---

## 4. Risk classification for proposed removals

| Batch | Blast radius | Failure mode if wrong | Detection |
|---|---|---|---|
| `temp/debug`, `temp/imports` | Local disk only | Losing diagnostic dumps; an in-flight import would already be broken by its in-memory store | App boot, run a menu-import smoke test |
| QA fixtures in `temp/` | Test harness | Isolated E2E harness re-creates its fixture | `npm run test:e2e:vendor-profile` |
| `graphify-out/` | Tooling | Regenerated by graphify | Re-run graphify |
| Playwright outputs | Tooling | Regenerated | `npx playwright test` |
| `canteen-bg.png` (+ precache entry) | **PWA install / offline cache** | SW `install` rejects if any precached URL 404s → app loses service worker | `tests/mobile/pwa-installability.spec.js`, manual SW install, Network tab |
| `liquidGL.js` | **Student UI rendering** | Glass background/effects fail if postinstall is skipped | Load student home/menu, console errors |
| `@types/node` | Developer tooling | Editors lose Node typings; no runtime effect | `npm install && npm test` |
| Historical Markdown | Knowledge only | Losing dated evidence | Review before deleting; archive rather than delete |
| Route/view "refactors" | Runtime behavior | Not cleanup — out of scope | Full unit suite + E2E |

Special attention:

- **Runtime discovery**: no filesystem-scanned modules exist; EJS includes are explicit, routes are
  imported in `server.js`, and `menu-import` uses explicit imports. No glob-based loading.
- **Service-worker precache**: the only place a "seemingly unused" asset is required. Always check
  `public/sw.template.js` before deleting anything under `public/`.
- **Tests**: `tests/global-setup.mjs` and `global-teardown.mjs` mutate the `testing` shop on the
  configured `MONGO_URI`; they are not cleanup targets and must not be run casually.
- **Deployment**: Render-style start relies on `prestart`/`postinstall`; generated assets must exist.

---

## 5. Recommended execution order (small, independent batches)

### Batch 0 — Documentation (DONE in this task)
Documentation only; no verification beyond reading. No runtime risk.

### Batch 1 — Clear ignored scratch (≈73 MB, no source changes) — **DONE 2026-10-29**
Files: `temp/debug/*`, `temp/imports/*`, `temp/*fixture*.json`, `graphify-out/*`,
`playwright-report/*`, `test-results/*`. Empty `temp/imports` + `temp/debug` were kept so the
running dev server can still accept uploads; graphify's three tiny metadata files were kept.
Verify (executed): `npm test` → **301 passed / 0 failed**; isolated boot on port 3141 with an
in-memory MongoDB → `/login`, `/shops`, `/signup`, `/sw.js`, `/version.json`, `/manifest.json`
all 200, and both temp dirs present. The user's running `node server.js` was left untouched.

### Batch 2 — Markdown pruning / archiving (documentation only) — **REPORT MERGES DONE**
Done: the two migration reports and the two Stage 0 plans were merged and their sources removed
(`md/` 168 KB/7 files → 108 KB/5 files). All links were validated afterwards.
Remaining optional work: fold `payment-architecture-V1.md` into `PAYMENT_FLOW.md`; optionally move
all dated reports into `docs/history/`.
Verify: every link resolves; `docs/README.md` status table accurate.

### Batch 3 — PWA asset decision (requires source edit — proposal only)
Decide whether `public/images/canteen-bg.png` is intentionally precached. Either document that
decision or remove the file **and** the `PRECACHE` entry.
Verify: PWA installability spec, manual service-worker install, offline reload.
Benefit: 1.26 MB only if the assets are genuinely unused.

### Batch 4 — Generated bundle policy (config/deploy — proposal only)
Decide whether `public/js/vendor/liquidGL.js` stays tracked. If untracked, guarantee postinstall
runs in every deploy environment and add a startup check.
Verify: fresh clone → `npm ci` → student UI glass effects render.
Benefit: 297 KB tracked.

### Batch 5 — Dependency hygiene (package.json — proposal only)
Remove `@types/node` if editors do not need it; confirm all others remain imported.
Verify: `npm ci && npm test && npm run test:e2e:vendor-profile`.
Benefit: negligible size; reduces confusion.

### Batch 6 — Config hygiene (proposal only)
Drop the stale `ui_redesign/` ignore entry; consider ignoring `graphify-out/` (already) and
documenting `temp/` lifecycle.
Verify: `git status` clean after a normal dev session.

### Not recommended
Refactoring `routes/admin.js` / `vendor.js` / `orders.js`, extracting service layers, splitting
EJS partials, or changing the Playwright config structure **as part of cleanup**. Those are
engineering changes with real risk; track them in `docs/TECH_DEBT.md` and do them per-feature.

---

## 6. Functional safety strategy for future batches

1. **Reference sweep before any delete**: search filenames and URL paths (not just imports) across
   `views/`, `public/`, `routes/`, `models/`, `tests/`, `.github/`, `docs/`, and `public/sw.template.js`.
2. **Static checks**: `node --check` on changed JS is not enough for EJS; start the server and load
   every affected page.
3. **Regression baseline**: `npm test` must stay at 301/0 (or report the new number honestly).
4. **Browser checks**: use the isolated harness pattern; for PWA changes run
   `tests/mobile/pwa-installability.spec.js` and verify the service worker registers and precaches.
5. **Deployment check**: simulate `npm ci && npm run build:version && npm start` in a clean clone
   before dropping tracked generated assets.
6. **Rollback**: cleanup batches are file deletions only — restore from Git history if a consumer
   is discovered. Never combine a cleanup batch with a behavior change.

---

## 7. Explicit non-goals

Do **not** change, for repository-size reasons:

- Any business logic: pricing, discounts, refunds, order transitions, pickup QR/OTP, slots,
  shop hours, cart rules, notifications.
- Payment, authentication, authorization, CSRF, session, FCM or webhook code.
- Mongoose schemas, indexes, or data migration behavior.
- EJS templates, CSS, client JS, or the Liquid Glass lifecycle / bottom-nav animation.
- Service-worker behavior or PWA configuration without the verification above.
- Tests, fixtures, CI, or the `.ai/` autonomous-agent rules.
- `package.json` scripts, lockfiles, build tooling, deployment configuration, `.env*`.
- Runtime assets (`public/**`) based only on visual inspection or a stale “unused” note in old docs.

Cleanup must remain **subtractive and reversible**, one batch at a time, with the unit suite and
the relevant browser flow re-run after each batch.

---

## 8. Coverage and gaps

Inspected: full tree and file inventory; `server.js`; all routes/models/middleware/config/utils;
all views and client assets; `menu-import`; build scripts; tests and configs; package manifests;
CI workflow; `.env.example`; every Markdown file's structure with full reads of the reference docs
(and full reads of the four merged reports); asset references via CSS/EJS/SW/manifest greps;
dependency usage via import grep; view include graph; file sizes and hashes for the media assets.

Not exhaustively read: every line of `routes/admin.js` (2,182) and `routes/vendor.js` (1,514);
individual Playwright spec bodies (inventory only); generated `graphify` data; `node_modules`
internals; `.git` internals. These were inspected only as far as needed to establish references
and responsibility.

Checks executed for this task: file/asset/dependency searches; Markdown edits; one empty-file
removal; the ignored-scratch clear; `npm test` → **301 passed / 0 failed (2026-10-29)**; and an
isolated boot with in-memory MongoDB on port 3141 verifying `/login`, `/shops`, `/signup`, `/sw.js`,
`/version.json`, `/manifest.json` (all 200) plus auto-recreation of `temp/imports` and `temp/debug`.
The repository E2E suites and live gateway flows were **not** run. Read-only Git inventory queries
(`ls-files`, `status`, `check-ignore`) were used for measurements; no commit, staging, branch or
history change was made.
