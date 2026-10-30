# 07 — Testing and Acceptance (PROPOSED)

A phase is complete only when its acceptance criteria pass **and** every required
test was executed and observed. Documentation, code presence, or a successful
page render is not evidence.

Safety rules come from `.ai/test.md` and are non-negotiable. Related documents:
`04_PDF_TEMPLATE_ENGINE.md` (§16 render checklist),
`05_INVOICE_DATA_AND_GENERATION.md` (§14 implied tests),
`06_STORAGE_SECURITY_AND_INTEGRATION.md`, `08_IMPLEMENTATION_PHASES.md`.

---

## 1. Allowed and forbidden test surfaces

**Allowed**

- `npm test` / `npm run test:unit` → `node --test "tests/unit/**/*.test.js"`.
  Unit tests use `mongodb-memory-server-core` where a DB is needed.
- Isolated Playwright: `npm run test:e2e:vendor-profile`
  (`playwright.vendor-profile.config.js` + `scripts/qa-vendor-profile-server.mjs`,
  which starts an in-memory Mongo and overrides `MONGO_URI`/`PORT` before
  `server.js` loads).
- A **new** isolated harness following the same pattern for invoice flows
  (in-memory Mongo, ephemeral port, local filesystem storage root under
  `temp/`, stubbed/disabled external services).
- Local headless Chromium checks (the system has Chrome installed).

**Forbidden**

- `npm run test:e2e` (default config; real-DB global hooks).
- `npm run seed` (destructive).
- Live Razorpay/Easebuzz/PhonePe calls.
- Real FCM sends, real Cloudinary uploads, real Gemini calls.
- Reading/printing `.env` values; connecting to production MongoDB.
- Running tests against a developer's configured DB by accident: the new
  harness must set `MONGO_URI`/`MONGODB_URI` **before** importing `server.js`
  (copy the existing harness's ordering) and must assert the URI is the memory
  server.

---

## 2. Test fixtures to add

```text
tests/fixtures/billing/
  clean-template.pdf         1 page, A4, empty fields, no rotation
  clean-template-2page.pdf   2 pages, item table on page 1
  encrypted.pdf              password-protected (generated at test time if possible)
  rotated.pdf                /Rotate 90 page
  sample-values.pdf          "Well B" style example with printed Mango/Avocado rows
  corrupted.pdf              invalid bytes with a PDF header
  huge-page.pdf              page larger than 2000 pt
```

Rules:

- Fixtures are small (< 200 KB each) and contain no customer data.
- If an encrypted fixture cannot be committed, generate it at test time with
  `pdf-lib` (if supported) or with a checked-in tiny encrypted PDF.
- The `sample-values.pdf` fixture exists specifically to prove the system does
  **not** mask printed values and that activation guidance is required.
- Do not commit generated invoice outputs; assert on parsed content instead.

---

## 3. Unit tests (pure logic, no HTTP)

| ID | Test | Expected |
|---|---|---|
| U1 | `toPaise`/`fromPaise` round-trip for persisted order totals | exact integer round-trip |
| U2 | Reconciliation with variant + discount + parcel + one removed item | `food - discount + parcel === payable` |
| U3 | Tampered total (`order.total` mutated) | `totals_mismatch`, no invoice |
| U4 | Eligibility matrix over all 6 statuses × 5 payment-evidence shapes | only eligible combinations pass |
| U5 | Mock order (`paymentNote: "mock"`) | eligible, snapshot marks `mock: true` |
| U6 | Cancelled order with refund | ineligible, reason `not_completed` |
| U7 | Invoice number format + zero padding + 50 sequential allocations | unique, monotonic, `000001` |
| U8 | Two shops allocate independently | both start at `000001` |
| U9 | Amount in words fixture table (0, 0.01, 0.99, 1, 999.99, 1000, 1e5, 1e7, 123456789.5) | exact strings |
| U10 | Money formatting `en-IN` grouping + `₹`, negative discount | exact strings |
| U11 | Mapping validation: NaN, negative, out-of-page, overlapping required fields, font size out of range | each rejected with a reason |
| U12 | Mapping hash stability across key order | identical hash |
| U13 | Snapshot is deep-frozen and canonical-JSON hashes are stable | throws on mutation / stable hash |
| U14 | Tax inclusive breakdown reconciliation at 2.5% + 2.5% and 9% + 9% | base + cgst + sgst === payable, no drift |
| U15 | Tax `exclusive_add` mode is rejected | validation error |
| U16 | Rotation/encrypted/huge-page validation reason codes | exact reason codes |
| U17 | Renderer fails closed when a font file is missing | named error, no output |

Run: `npm test` (or a scoped `node --test tests/unit/invoice-*.test.js`).

---

## 4. Rendering tests (still unit-level, with fixtures)

| ID | Test | Expected |
|---|---|---|
| R1 | Render clean template with 1 item | output parses, page count === template page count |
| R2 | Render with 3 items, variant names, discount, parcel | every value appears; totals reconcile |
| R3 | `₹` glyph test on all three Roboto files | `hasGlyphForCodePoint(0x20B9) === true` |
| R4 | Render `₹ 1,234.50` and re-load | no replacement characters; embedded font is Roboto |
| R5 | Coordinate accuracy: field mapped at (x,y) appears at that baseline ± 0.5 pt | measured via `page.getTextContent`-equivalent or PDF text extraction |
| R6 | 120-character item name | wrapped/truncated within its column, never crossing the next column |
| R7 | 30-item order | continuation pages appended, columns repeated, totals on last page |
| R8 | Overflow without `continuationTotals` | `layout_overflow`, no stored invoice |
| R9 | Template bytes sha256 before/after two renders | unchanged |
| R10 | Encrypted/corrupt template | fail closed with reason, no output |
| R11 | Same snapshot rendered twice | deterministic (or documented normalized comparison) |
| R12 | Amount in words longer than 3 lines | `text_overflow`, no invoice |
| R13 | Sample mode | contains `SAMPLE`, never allocates a number |

Where text extraction is unreliable, assert structural facts (embedded font
descriptors, absence of Helvetica for dynamic fields) plus a **single**
maintainer-approved visual reference; do not claim pixel-perfect rendering from
code alone.

---

## 5. Integration tests (routes + middleware + in-memory DB)

Use the isolated-harness pattern (new `scripts/qa-billing-server.mjs` modeled on
`scripts/qa-vendor-profile-server.mjs`).

### 5.1 Upload

| ID | Request | Expected |
|---|---|---|
| I1 | valid clean PDF as vendor of shop A | 302, version created, flash success, file stored privately |
| I2 | non-PDF extension | 302 + error, no version |
| I3 | `.pdf` name with PNG bytes | `not_a_pdf`, no version |
| I4 | encrypted PDF | `encrypted_pdf`, no version |
| I5 | 11 MB PDF | `file_too_large`, no version |
| I6 | rotated page | `rotated_page`, no version |
| I7 | 0-byte file | rejected |
| I8 | vendor without shop (`requireVendorShop` failure) | redirect, no version |
| I9 | student posts to upload route | blocked by `requireVendor` |
| I10 | vendor A uploads, vendor B tries to configure/activate/stream A's template | 404-equivalent, no data leak |

### 5.2 Configuration and activation

| ID | Scenario | Expected |
|---|---|---|
| I11 | save complete mapping | 200/302 success, mapping persisted with PDF coords only |
| I12 | save mapping with viewport pixels or out-of-range values | rejected |
| I13 | activate without required fields | rejected, version stays inactive |
| I14 | activate without a fresh sample preview | rejected |
| I15 | activate after preview | active, previous version superseded |
| I16 | concurrent double activation | exactly one active version |
| I17 | edit mapping of an active version | rejected (new version required) |
| I18 | replacement upload → new version inactive → old still active | old version issues invoices |
| I19 | remove template | `currentVersionId: null`, files/invoices retained |

### 5.3 Invoice issuance

| ID | Scenario | Expected |
|---|---|---|
| I20 | complete a paid order via QR (existing route), then download | one invoice, one number, PDF streams |
| I21 | complete via OTP, then download | same |
| I22 | download twice / 10 parallel downloads | one invoice, identical bytes, one number |
| I23 | `ready_for_pickup` order download | no invoice, message about collection |
| I24 | `paid`/`accepted` order download | refused |
| I25 | `pending_payment` order | refused |
| I26 | `cancelled` order | refused |
| I27 | completed order with `amountChargedPaise: null` and non-mock note | refused, reason `payment_not_verified` |
| I28 | mock `testing` shop order completed | eligible, snapshot marks mock |
| I29 | shop with **no active custom template** (never uploaded) | order detail renders the existing default order bill unchanged (items, totals, status, pickup QR/OTP); no invoice generated, no `Invoice` document, no download action, no error/empty state; `/orders/:id/invoice` returns an explanatory message and creates nothing |
| I30 | order from shop A downloaded by student B | flash "Order not found.", redirect |
| I31 | vendor A requests invoice for shop B order | 404-equivalent |
| I32 | invoice number uniqueness across 50 completions | all unique, shop-scoped |
| I33 | issued invoice then template replaced + activated | old invoice bytes and snapshot unchanged |
| I34 | issued invoice then removal | still downloadable |
| I35 | issued invoice then mutation attempt via model/service | guarded rejection |
| I36 | adjusted order (removed item) completed | invoice bills updated total, excludes removed line, shows refund metadata |
| I37 | concurrent completion + download race | single invoice, no duplicate key surfaced to the user |
| I38 | cross-origin POST to a billing route | 403 from `csrfOriginProtection` |
| I39 | unauthenticated request to every billing route | redirect to `/login` |
| I40 | response headers on PDF routes | `application/pdf`, `private, no-store`, `nosniff` |
| I41 | no public URL works (`/storage/...`, `/invoices/...`) | 404 |
| I42 | template uploaded but not configured | student order detail shows the existing default bill unchanged; no invoice, no download action |
| I43 | template configured but not activated | same as I42 |
| I44 | active template + eligible completed order | default order-detail content still rendered; download action present; PDF streams |
| I45 | template removed after activation | new orders show the default bill only; previously issued invoices still download |
| I46 | complete several orders for a shop with no active template | database has zero `Invoice` documents for that shop and private storage has zero generated invoice files |

---

## 6. Security tests

| ID | Test | Expected |
|---|---|---|
| S1 | IDOR: substitute another order id on invoice download | 404-equivalent |
| S2 | IDOR: substitute another template/version id | 404-equivalent |
| S3 | Cross-vendor shop id in body/query | ignored; only `req.vendorShopId` used |
| S4 | Path traversal in a template/file key (`../`) | rejected by storage prefix check |
| S5 | Malicious PDF (embedded JavaScript, huge objects, zip bomb-ish) | rejected or renders within limits without crashing the process |
| S6 | 10 MB upload memory/CPU | within measured budget; no process crash |
| S7 | Invoice endpoint response cannot be cached by a shared proxy | `no-store` present |
| S8 | Error responses do not leak paths/keys/PII | asserted strings absent |
| S9 | CSRF: foreign Origin POST | 403 |
| S10 | Role escalation: student hitting vendor routes, vendor hitting student route | blocked (redirect) |
| S11 | Template stream requires authentication | redirect, never bytes |
| S12 | Snapshot endpoint (if any) is not exposed to students | n/a or authorized only |

---

## 7. Regression tests (existing behavior)

These must pass after every phase, not only at the end.

| Area | Checks |
|---|---|
| Vendor menu | `/vendor/menu` renders; create/edit/delete item; availability toggle; image upload error path; discount, pickup slots, operating hours, parcel forms still save |
| Vendor menu card placement | Billing Template card appears after Pickup Slots and before Operating Hours; admin menu page unaffected |
| Order lifecycle | `paid → accepted → ready_for_pickup → completed` via existing routes; illegal transitions rejected |
| Pickup | QR completion (valid, malformed, wrong shop, replay, concurrent), OTP fallback, `collectedAt`/`pickupMethod` set exactly as before; JSON/HTML responses unchanged |
| Payments | Razorpay create/verify (signature + amount), webhook idempotency, Easebuzz initiate/callback hash, PhonePe initiate/callback, mock checkout restriction |
| Refunds/adjustments | cancel refund, partial adjustment, refund status transitions |
| Student pages | `/orders`, `/orders/:id`, `/api/orders/:id/status`, polling still works; default order bill unchanged for shops without an active template; invoice action absent when no custom invoice exists and does not break layout |
| Auth/CSRF | login redirects, session behavior, origin allowlist unchanged |
| Existing unit suite | all pre-existing tests in `tests/unit` still pass |
| UI policy | school of `.ai/rules.md` §17: desktop (≥768 px) unchanged on every screen; mobile at 393×852 usable |

Commands: `npm test`, `npm run test:e2e:vendor-profile`, plus the new isolated
billing harness and a mobile-viewport Playwright check.

---

## 8. Playwright / browser checks

Required browser coverage for the feature (isolated harness only):

1. Vendor uploads a clean PDF through the card and sees the uploaded state.
2. PDF.js preview renders page 1 (canvas non-blank), zoom and page nav work.
3. Place each required field; save; reload and confirm positions persist.
4. Generate sample invoice; assert the sample response is a PDF and contains
   `SAMPLE`.
5. Activate; assert active badge and that a second activation path is not shown.
6. Replace PDF: assert old invoices remain and the new version needs
   configuration.
7. Student (mobile 393×852), shop with an active template, opens a completed
   eligible order and downloads the invoice; assert a PDF response, the default
   order content still present, no layout overflow, and a 44 px touch target.
8. Student on desktop (1440×900) — order detail layout unchanged (desktop-frozen
   policy).
9. Vendor menu regression: existing cards and the menu table still work.
10. No console errors on any of the above.
11. Shop with no active template, and separately a shop with an uploaded but
    unconfigured template: student order detail shows the existing default bill
    with no invoice download action.
12. Active template: a completed eligible order shows the download action next
    to the unchanged default order content; a not-yet-collected order shows no
    download action.

Browser checks are required for PDF.js rendering, coordinate capture, and mobile
layout; unit tests cannot substitute. Where a screenshot is used as evidence,
store it under `temp/` or `test-results/` and reference it in the report; do not
commit large artifacts.

---

## 9. Performance and storage checks

Measure and record (no claims without numbers):

| Metric | How |
|---|---|
| Upload validation time for a 1-page and a 10 MB PDF | console timing in the harness |
| Render time for 1 page / 1 item, 1 page / 12 items, 3 pages / 30 items | unit test timing |
| Template read + embed + save memory peak | process memory sampling in the harness |
| Generated PDF size (empty vs. 30 items) | assert under 25 MB limit |
| First download latency after completion (background generation succeeded vs. lazy fallback) | harness timing |
| Concurrent render of 5 invoices | no failures, bounded time |

Acceptance thresholds must be set **after** measuring the baseline, then applied
consistently. Do not invent a target such as "under 2 s" before measurement.

---

## 10. Evidence rules

For every phase record in `.ai/STATUS.md`:

```text
Phase: <n> — <name> — <PENDING|IN_PROGRESS|COMPLETE|BLOCKED>
Commands run (exact):
Environment (isolated harness? port? in-memory Mongo? storage root?):
Scope (routes/units/files touched):
Results (passed/failed/skipped counts, failing test names):
Failures and root causes:
Fixes applied:
Rerun result:
Blocked checks and the exact reason:
Known deviations from this documentation:
```

Additional rules:

- Never mark a skipped test as passed. Skipped tests are listed with reasons.
- If a browser check cannot run (no Chrome, no harness), the phase is not
  complete — report the environment blocker instead of substituting a code
  reading.
- Do not lower acceptance criteria to finish a phase.
- Do not claim "no regressions" unless the regression set actually ran.
- Every report states: no production database was touched; no `.env` value was
  read/printed; no F09 work was modified.

---

## 11. Acceptance checklist (feature-level, copy into the final report)

- [ ] Vendor can upload a clean PDF (≤ 10 MB) and invalid files are rejected with named reasons.
- [ ] Preview renders the vendor's own PDF unchanged.
- [ ] Field positions are saved in PDF-native coordinates bound to a template version.
- [ ] Sample invoice renders before activation and is required for activation.
- [ ] Dynamic text uses embedded Roboto Regular/Medium/Bold only.
- [ ] `₹` renders correctly in every money field.
- [ ] Item table supports description, quantity, unit rate, line amount, row height, column positions, alignment and font size.
- [ ] Long item names wrap/truncate within their column.
- [ ] Overflow produces continuation pages, with totals on the last page.
- [ ] Invoices are issued only for `completed` + collected + payment-evidenced orders.
- [ ] No invoice for pending/unpaid/cancelled orders.
- [ ] Shops with no active custom template (including uploaded-but-unconfigured) show the existing default order bill unchanged; no PDF is generated for them.
- [ ] No generic FlashFoods PDF invoice or receipt exists in the fallback path.
- [ ] The invoice download action appears only when an actual custom invoice exists (or is issued for that eligible order in the same request).
- [ ] Exactly one invoice per order under retry and concurrency.
- [ ] Invoice numbers are unique, shop-scoped and atomic.
- [ ] Invoice totals reconcile exactly with persisted payable amounts.
- [ ] Snapshot is immutable; issued invoices survive template replacement/removal.
- [ ] Refunds/adjustments do not rewrite an issued invoice.
- [ ] Students can download only their own invoice; vendors only their own shop's.
- [ ] CSRF, session auth and ownership checks are enforced on every new route.
- [ ] No PDF is reachable without authentication or from a public path.
- [ ] Existing vendor menu, order, payment, pickup and admin behavior unchanged.
- [ ] Mobile (393×852) and desktop (≥768 px) policies respected.
- [ ] All phase evidence recorded; no unexecuted test reported as passed.
