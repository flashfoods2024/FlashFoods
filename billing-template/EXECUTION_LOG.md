# EXECUTION LOG — Custom Billing Template System

Execution date: 2026-10-30
Mode: autonomous implementation of `TRIGGER_PROMPT.md`
Status: **COMPLETE for the locked scope** — Phases 1–5 executed with unit,
isolated HTTP, security, rendering, Playwright end-to-end and regression
evidence. Limitations are listed at the end.

Every result below is a command that was actually run in this repository.

---

## Phase 1 — Foundation

### WU-1 — Dependencies and PDF.js worker pipeline

- Files: `package.json`, `package-lock.json`, `build-scripts/vendor-pdfjs.js`,
  `public/vendor/pdfjs/{pdf.min.mjs,pdf.worker.min.mjs}`.
- Commands: `npm install pdf-lib @pdf-lib/fontkit pdfjs-dist`;
  `node build-scripts/vendor-pdfjs.js`.
- Result: PASS — pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, pdfjs-dist 6.4.299;
  module + worker served locally (HTTP 200), no CDN.

### WU-2 — Roboto assets, licence, glyphs

- Files: `assets/fonts/Roboto/{Roboto-Regular,Roboto-Medium,Roboto-Bold}.ttf`,
  `LICENSE.txt`, `NOTICE.md`.
- Source: real binaries from the published `@expo-google-fonts/roboto` package
  (Apache-2.0/OFL Roboto build); licence shipped. No fabricated font.
- Result: PASS — all three parse, embed via fontkit, contain U+20B9; `₹` visible
  in the inspected invoices.

### WU-3 — Models

- Files: `models/InvoiceTemplate.js`, `models/Invoice.js`,
  `models/InvoiceCounter.js`. `Shop`/`Order` unchanged.
- Result: PASS — unique shop/order/number indexes, immutable-update guards,
  exercised by unit + E2E.

### WU-4 — Private storage and validation

- Files: `utils/invoice/{storage,pdf-validate,canonical,mapping,format}.js`,
  `middleware/billingUpload.js`, `.gitignore` (`storage/`).
- Result: PASS — 10 MB dedicated memory upload, extension/MIME/`%PDF-`/
  parseability/encryption/page-size/origin/rotation gates; private root outside
  `public/`.

### WU-5 — Vendor card and page

- Files: `views/partials/menu-manager.ejs`, `views/vendor/billing-template.ejs`,
  `routes/vendor.js`, `routes/billing.js`.
- Result: PASS — card between Pickup Slots and Operating Hours (asserted in
  browser), none/uploaded/configured/active states, page 200 for owner, 302 for
  other roles.

## Phase 2 — PDF template engine

### WU-6 — PDF.js preview and coordinate mapping

- Files: `public/js/billing-template-editor.js`, `views/vendor/billing-template.ejs`.
- Result: PASS (browser) — canvas paints the vendor PDF; defaults/save/reload
  persist 8 fields + table; `convertToPdfPoint` used for placement.

### WU-7 — Overlay renderer

- Files: `utils/invoice/invoice-generator.js`.
- Result: PASS — template loaded read-only, Roboto embedded, fields/rows drawn,
  continuation pages appended, no masks or backgrounds, template sha unchanged
  across renders (unit + perf).

## Phase 3 — Invoice generation

### WU-8 — Data, snapshot, numbering

- Files: `utils/invoice/{invoice-data,invoice-snapshot,invoice-number}.js`.
- Result: PASS — paise reconciliation, removed lines excluded, tax disabled by
  default, canonical snapshot, atomic shop-scoped number.

### WU-9 — Eligibility and idempotent issuance

- Files: `utils/invoice/invoice-resolver.js`.
- Result: PASS — completed + collected + payment evidence + payable + active
  template; one invoice per order; duplicate-key race returns winner.

### WU-10 — Completion integration

- Files: `routes/vendor.js`.
- Result: PASS — `issueInvoiceBestEffort` after both OTP and QR atomic
  completion; logs `[billing] invoice not issued: <reason>`; responses unchanged.

## Phase 4 — Student delivery

### WU-11 — Download and fallback

- Files: `routes/orders.js`, `views/orders/show.ejs`, `routes/billing.js`.
- Result: PASS — owner-only PDF with private headers; action only when an
  `Invoice` exists; default bill untouched for every no-template state.

## Phase 5 — QA

### WU-12 — Unit suite

- `npm test` → **332 tests, 332 pass, 0 fail**.

### WU-13 — Isolated HTTP/security harness

- `scripts/qa-billing-server.mjs` (in-memory Mongo, `temp/` storage, real
  `testing` shop for the app's mock-checkout gate; FCM/email/Gemini/Cloudinary/
  gateway keys blanked before startup).
- Observed: upload 302 + version; template stream 200 `%PDF-`; invalid PDF
  rejected; student upload/config → 302 `/`; second vendor foreign version →
  302 with no bytes; cross-origin POST → 403; editor JS + PDF.js assets 200.

### WU-14 — Playwright end-to-end (Testing shop)

- Command: `npm run test:e2e:billing` (`playwright.billing.config.js`).
- Result: **1 passed (9.2s)** — upload → PDF.js preview → defaults/save/reload →
  sample PDF → activate → student mock checkout → accept → ready → OTP pickup →
  invoice download (identical bytes ×3, one invoice number) → template replace →
  historical invoice unchanged → removal → new order keeps default bill →
  cross-vendor and role blocks → never-template and unconfigured-template
  fallbacks → no page errors. Mobile assertions: 44 px target, no horizontal
  overflow.

### WU-15 — Regression

- `npm run test:e2e:vendor-profile` → **15 passed**.
- `npm test` → 332/332 after every change.

### WU-16 — Performance and visual evidence

- `node scripts/measure-invoice-render.mjs` → 1 line 146.3 ms/1 page/304,041 B;
  12 lines 111.9 ms/2 pages/305,518 B; 30 lines 119.0 ms/2 pages/307,080 B;
  template sha unchanged; RSS 146.8 MB.
- `pdftoppm` + inspection of `sample-page-1.png`, `order-page-1.png`,
  `continuation-2.png`: static design preserved, Roboto values, `₹` correct,
  amount in words correct, continuation page header/columns/totals correct.

---

## Defects found during verification, and fixes

1. **`latestVersion()` was `async`** → callers received a Promise and mapping
   failed with `version_not_found` after upload. Made it synchronous.
2. **Right-aligned default positions had no room** (`maxWidth = pageWidth - x -
   24` ≈ 24 pt at the right margin) → every value failed `text_overflow`. Added
   alignment-aware `fitWidth` in the editor (left/right/center).
3. **`saveMapping` cleared the preview hash on every save** → the editor's
   save-then-activate flow always failed with `preview_required`. Preview is now
   invalidated only when the mapping hash actually changes.
4. **No issuance wiring in completion paths** → completed pickups produced no
   invoice. Added `issueInvoiceBestEffort` after both QR and OTP completion.
5. **Missing `lineHeight` produced a `NaN` y-coordinate** crash on wrapped text.
   The renderer now derives `fontSize * 1.2` when unset; defaults store
   `fontSize * 1.25`.
6. **Editor bound `#billing-activate` unconditionally** → TypeError after
   activation removed the button. All bindings go through a null-safe `bind()`.
7. **Continuation page numbered itself "Page 1 of 2"** → offset now counts
   template pages (`pages.length + pageOffset + 1`).

8. **`text_overflow` reported only the value, never the field** → a vendor who
   widened Amount in Words kept failing on a *different* field with no way to
   tell which. The renderer now returns the field/column id, font size, Max
   width, measured text width, configured lines and required lines; the route
   renders a named message.
9. **Right-margin field widths saved by the pre-fix editor stayed at 24 pt.**
   Measured with the bundled Roboto: `SAMPLE` at 10 pt bold is 39.1 pt wide and
   needed 2 lines against `maxLines: 1`; `₹339.50` at 12 pt needed 3. The editor
   now widens any box narrower than four characters (`fontSize × 4`) on load and
   says which fields it widened, so `Save + sample invoice` succeeds.
10. **A placed field could not be edited, and re-placing it reset its settings**
    (Max lines snapped back to the panel default). Selecting a placed field now
    loads its configured values and edits apply to that exact field.
11. **Wrapped item descriptions printed over the next row**: a 2-line cell in a
    16 pt row needs 21.6 pt. Column lines are now capped to
    `floor(rowHeight / (fontSize × 1.2))` at save and render time, the default
    row height is 22 pt for two 9 pt lines, and changing Row height re-derives
    the budgets.

Each fix was followed by a rerun of the affected unit test and/or the full
billing E2E; none weakened an assertion.

---

## WU-17 — Field-fitting correction (2026-10-30)

Reported symptom: `Save + sample invoice` always failed with "A value is too
long for its field. Increase its width or lines." even after widening Amount in
Words.

Root cause (measured, not assumed) via `node scripts/diagnose-invoice-fields.mjs`
with the bundled Roboto metrics and the sample dataset:

| Scenario | Field | Max width | Max lines | Required | Result |
|---|---|---:|---:|---:|---|
| Defaults | all 8 fields | ≥140 | as configured | 1 | pass |
| Legacy 24 pt right widths | `invoiceNumber` (`SAMPLE`, 39.1 pt) | 24 | 1 | 2 | **text_overflow** |
| Legacy 24 pt right widths | `total` (`₹339.50`, 44.2 pt @12 pt) | 24 | 1 | 3 | fail |
| Amount in Words placed with panel defaults | `amountInWords` (218.2 pt) | 180 | 1 | 2 | **text_overflow** |
| Long name/number, roomy boxes | all | ≥140 | 1–2 | 1 | pass |

Amount in Words was not the failing field in the reported configuration.

Changed files:

- `utils/invoice/invoice-generator.js` — field/column-level diagnostics (no raw
  customer or payment text), row-height cell cap.
- `utils/invoice/mapping.js` — `FIELD_LABELS`, `availableRoom()` anchor-bounded
  max width, `rowLineCapacity()` column cap.
- `routes/billing.js` — field-named overflow message plus `details` in JSON.
- `utils/invoice/template-service.js` — passes renderer details through and logs
  them outside production only.
- `public/js/billing-template-editor.js` — select/edit placed fields, preserve
  settings, repair impossible widths visibly, show the configured text box,
  re-derive column lines from Row height.
- `views/vendor/billing-template.ejs` — selectable field rows (`.is-selected`,
  `.is-error`), row-height guidance, 22 pt default row height.
- `tests/unit/invoice-field-fit.test.js` (new), `tests/e2e/billing-template.spec.js`
  (field-named error + in-place correction steps),
  `scripts/diagnose-invoice-fields.mjs`, `scripts/render-fit-samples.mjs` (new).

Verification:

- `npm test` → **340 / 340 pass, 0 fail** (8 new fitting tests).
- `npx playwright test --config playwright.billing.config.js` → **1 / 1 pass**,
  including: select `amountInWords` → Max width 180/Max lines 1 → save persists
  the edit → sample reports `Amount in words: this value needs 2 lines at 9 pt,
  but only 1 line is configured` and marks the row `.is-error` → widen/lines →
  sample generates.
- Visual: `temp/billing-e2e/fit-{long-values,large-total,small-total,many-items}.pdf`
  rendered with `pdftoppm` and inspected — long customer name wraps to 2 lines,
  two-line descriptions stay inside 22 pt rows with no collision, `₹12,345.67`
  and `₹8.50` are correct, 30 items continue on a labelled `Page 2 of 2` with
  repeated columns and totals, and the master template's header/GSTIN/labels are
  untouched.

No change to eligibility, numbering, payment, pickup, OTP/QR or student access.

## Remaining work / limitations

- Continuation-page totals are drawn without labels (the master PDF's static
  labels are page-1 only); the vendor controls this by mapping the totals block.
- A value that still cannot fit its configured box is rejected with a named
  message; it is never truncated for money fields and the font is never shrunk.
- Mappings created by the pre-fix editor are repaired in the browser and must be
  saved; no database migration rewrites stored mappings.

- QR completion path shares the issuance call and is covered by existing pickup
  tests, but the Playwright flow completes via OTP only.
- No live gateway verification; eligibility uses persisted evidence and the
  app's mock checkout.
- No bulk backfill (by design; lazy issuance on download).
- Default `npm run test:e2e` not run (forbidden real-DB config).
- Tax disabled by default; inclusive breakdown implemented/tested but not
  enabled in E2E.
- Masking not implemented (locked decision); clean master required.
- Invoice-number format placeholder (DECISION-1); gateway evidence policy
  (DECISION-7) open.

## Safety

No production/configured database, no `.env` value read or printed, no seed, no
live gateway/FCM/Cloudinary call, no deploy, no Git operations, no F09 change.
