# F14 — Invoice Quality, Financial Accuracy & Final Hardening

Date: 2026-10-31
Scope: the custom PDF invoice produced by `utils/invoice/*` and the vendor /
student surfaces around it.
Result: **all four reported defects are fixed and covered by automated tests;
local layout, financial and security audits pass. This is NOT a
production-readiness sign-off** — production database/storage diagnosis from F13
is still blocked on access, and several template limitations below need vendor
action (§6).

Nothing was deployed, no production record or file was touched, and no payment,
OTP, QR, refund, authentication, eligibility, numbering or immutability rule was
modified.

---

## 1. Defects, root causes and fixes

### D1 — Duplicate amount-in-words suffix (and wrong singular/plural)

**Symptom:** the Well B invoice printed e.g.
`One Rupees Only` immediately before the template's own static `Rupees only`.

**Root cause:** `utils/invoice/format.js → amountInWords()` unconditionally built
`"<words> Rupees"` and appended `" Only"`. Two independent problems:
the currency suffix was never conditional on what the vendor's master PDF already
prints, and the unit was always plural (`One Rupees`).

**Fix:**
- `amountInWords(paise, { style })` now supports three explicit styles:
  - `full` → `Two Hundred Thirty Six Rupees Only`
  - `noOnly` → `Two Hundred Thirty Six Rupees` (default; cannot repeat a printed `Only`)
  - `wordsOnly` → `Two Hundred Thirty Six` (for masters that print `Rupees only`)
- Singular/plural is correct: `One Rupee` / `Two Rupees`, `One Paisa` / `Fifty Paise`.
- `utils/invoice/template-text.js` (new) detects the printed suffix from the
  **original template bytes** with pdf.js, looking only at text on the configured
  field's own baseline band (±2.2 × font size). A `Rupees`/`Rs`/`INR` word →
  `wordsOnly`; a bare `Only` → `noOnly`; nothing → `full`.
- The effective style is resolved **before** the snapshot is built, so
  `snapshot.totals.amountInWords` and the rendered PDF always agree. The style is
  stored as `snapshot.totals.amountWordsStyle`.
- The vendor can override auto-detection per template
  (`amountInWords.wordsStyle` in the mapping, selectable in the editor: “Detect
  from the PDF”, full, no-Only, words-only).
- Detection is best-effort: any pdf.js failure falls back to the default and
  never blocks issuance. Teardown is guarded (`destroy`/`cleanup` across pdf.js
  majors) so a parser teardown can never throw into the invoice path.

**Tests:**
- `tests/unit/invoice-format.test.js` — Indian numbering, singular/plural, all
  three styles, invalid style fallback, no doubled suffix.
- `tests/unit/invoice-render.test.js` — detection returns `wordsOnly` for a master
  printing `Rupees only` and `full` for a blank master; an explicit style wins;
  the drawn value contains neither `Rupees` nor `Only`.
- `tests/unit/invoice-data.test.js` — default snapshot value carries no `Only`.

**Visual evidence:** `temp/billing-e2e/audit-before-amount-words-page-1.png`
(`Three Hundred Forty Eight Rupees and Fifty Paise Only` + printed
`Rupees only`) vs `temp/billing-e2e/audit-after-amount-words-page-1.png`
(`Three Hundred Forty Eight and Fifty Paise` + printed `Rupees only`).

### D2 — Missing item serial numbers

**Symptom:** the invoice table had an `Item` column but no `1, 2, 3…` numbering.

**Root cause:** the renderer already supported it — `COLUMN_VALUES.serial` maps to
`line.index`, and `mapping.js` accepts `serial` as an optional column. The defect
was in configuration: `public/js/billing-template-editor.js → buildColumns()`
never created a serial column, and the editor offered no way to add one. Every
table produced by the editor therefore lacked numbering, and numbering lived only
in hand-written mappings.

**Fix:**
- `buildColumns()` now emits `serial` as the first column and reserves its width
  from the description column, so the default layout numbers its rows.
- New `Line numbers` checkbox (`#billing-serial`) adds or removes the serial
  column on an existing table without moving any other column: the description
  box gives up (or reclaims) exactly the number column's width.
- Numbers are the invoice's own sequential `line.index` (never a MongoDB id or
  order-item index), so removed items do not create gaps and continuation pages
  continue the count. The continuation header labels the column `#`.

**Tests:**
- `tests/unit/invoice-render.test.js` — 8 rows across 2 pages, serial text
  extracted at the column's x position equals `[1..8]` exactly.
- `tests/e2e/billing-template.spec.js` — the default table is numbered, and the
  serial column survives the save/reload round-trip.

**Visual evidence:** `audit-30-items-page-1.png` (1–6) and
`audit-30-items-page-2.png` (7–30, with `Page 2 of 2`).

### D3 — Subtotal versus final total

**Audit method:** compared the persisted order, the invoice snapshot and the
rendered figures for discount, parcel and payable cases.

**Finding:** there is no remaining reconciliation defect. `buildInvoiceData()`
already recomputes from persisted facts in integer paise and **fails closed**:

```
foodSubtotalPaise − discountPaise + parcelChargePaise === payablePaise
```

otherwise `totals_mismatch` is thrown and no invoice is issued. Discount comes
from the persisted `discountAmountPaise` (percentage only as a fallback). The
observed subtotal/total differences on Well B invoices are exactly a persisted
discount and a persisted parcel charge — not a calculation error.

**One real defect found and fixed:** the parcel charge was billed only when
`order.orderType === "parcel"`. An adjusted order can carry a persisted parcel
charge on a dine-in order; dropping it made the persisted total unreconcilable
and blocked issuance with `totals_mismatch`. The persisted charge is now used
whatever the order type — still strictly from authoritative data, with the same
reconciliation guard and no invented adjustment.

**Tests:** `tests/unit/invoice-data.test.js` (parcel and dine-in persisted
charges both reconcile), `tests/unit/invoice-flow.test.js` (snapshot totals:
27500 − 2750 + 1500 = 26250).

### D4 — Tax presentation

**Audit result:** no tax is fabricated.
- `buildTax()` returns `taxMode: "none"` with `cgstPaise/sgstPaise = null` and
  empty display text unless the stored mapping explicitly sets
  `taxMode: "inclusive_breakdown"` with non-zero stored rates.
- `FIELD_VALUES.cgst/sgst` skip empty values, so nothing is drawn.
- The payable total never includes tax when tax is disabled, and a zero tax is
  never shown as collected tax.
- With `inclusive_breakdown`, base + CGST + SGST is corrected deterministically to
  equal the payable total (tested), so tax can never inflate the amount charged.

**Limitation (needs vendor action, not code):** the Well B master prints static
`CGST 9%` / `SGST 9%` labels. We leave their values blank, so we do not claim tax
was collected, but the pre-printed labels remain visible. A template-compatible
solution without touching the PDF or enabling tax by default is to map the
`cgst`/`sgst` fields to a short note such as `Not applicable` / `GST not
collected`, or to upload a master without those labels. No default was changed.

### D5 — Layout quality

Rendered and inspected at 110 dpi (Roboto, `₹`, alignment, row boundaries,
footer, signature area, branding):

| Case | Result |
|---|---|
| 1 item | pass |
| 3 items | pass |
| 10 items | 2 pages, totals on the last page |
| 30 items | 2 pages, serials 1–6 then 7–30, `Page 2 of 2` |
| Long customer name (10 pt, 2 lines) | pass, no clipping |
| Long item names | wrap to 2 lines inside a 22 pt row; only text beyond the configured lines is ellipsized (by design) |
| Large amounts (`₹2,469.12`, `₹3,142.20`) | pass, right-aligned |
| Long amount-in-words | pass, wraps without leaving its box |
| Continuation pages | header, repeated column labels, continued numbering, totals |

Branding, header, GSTIN, static labels and footer of the vendor PDF are unchanged
(the template bytes are never modified; only a copy is drawn on).

**Limitation found (template, not renderer):** when rows overflow, the dynamic
totals move to the continuation page, but the master's static `Subtotal:`,
`Discount:`, `Total:` labels stay on page 1 with empty values, and the
continuation totals have no printed labels because the master's labels are static
page-1 text. Mapping `continuationTotals` onto an area of the master that carries
labels, or using a master whose totals block sits on the last page, avoids it.
This is reported rather than “fixed” by inventing labels.

### D6 — Vendor configuration usability

Verified against the editor and the billing E2E:
- existing fields can be selected and edited (not re-placed);
- position, Max width and Max lines persist after reload (server round-trip
  asserted, not just the DOM);
- validation names the exact field/column and its measurements;
- row height and wrapping budgets stay consistent (`rowLineCapacity`);
- activation is refused until required fields, mapping and a sample exist;
- generating a sample never activates the template.

**Gap fixed:** numbering and the amount-in-words suffix had no controls at all
(D2/D1). Two small additions were made — a `Line numbers` checkbox and a suffix
`<select>` shown only for the `Amount in words` field. No other UI was added.

### D7 — Student invoice experience

Covered by `tests/e2e/view-invoice.spec.js` at **393×852 and 414×896**:
- the “Your Invoice” card appears only when a persisted `Invoice` exists;
- `View Invoice` returns `200 application/pdf` `inline`;
- `Download PDF` (`?download=1`) returns the **byte-identical** PDF as
  `attachment`;
- repeated requests (4×) return the same SHA-256 and never issue a new invoice;
- a missing stored PDF produces the safe `invoice_file_missing` message
  (distinguishable in logs from “no template”);
- an order with no invoice keeps the default order bill and shows no card;
- the bottom navigation still works from the card;
- another student receives `302` for the owner's invoice.

---

## 2. Test evidence (executed)

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | **346 / 346 pass, 0 fail** |
| Billing E2E | `npm run test:e2e:billing` | **1 / 1 pass** |
| Invoice view/download E2E | `npm run test:e2e:invoice-view` | **3 / 3 pass** |
| Audit samples | `node scripts/render-audit-samples.mjs` | exit 0, 7 scenarios rendered, self-checks pass |

`npm test` includes the pickup/OTP/QR, payment-verification, money, mapping and
immutability suites, so the F14 changes did not regress the untouched flows.

---

## 3. Before/after visual evidence

Generated by `scripts/render-audit-samples.mjs` into `temp/billing-e2e/`
(git-ignored artifacts, reproducible at will):

| File | Shows |
|---|---|
| `audit-before-amount-words-page-1.png` | `… Rupees and Fifty Paise Only` + printed `Rupees only` (defect) |
| `audit-after-amount-words-page-1.png` | `… and Fifty Paise` + printed `Rupees only` (fixed) |
| `audit-01-item-page-1.png` | single row, serial `1` |
| `audit-03-items-page-1.png` | three rows, serials `1–3` |
| `audit-10-items-page-1.png`, `…-page-2.png` | overflow to continuation, serials continue |
| `audit-30-items-page-1.png`, `…-page-2.png` | serials `1–6` / `7–30`, totals on page 2 |
| `audit-long-values-page-1.png` | long names wrap in-row, large `₹` amounts, long words |

---

## 4. Files changed in F14

```text
utils/invoice/format.js                     suffix styles, singular/plural, safe integer words
utils/invoice/template-text.js              NEW: printed-suffix detection + style resolution
utils/invoice/invoice-data.js               style in the data contract, persisted parcel charge
utils/invoice/invoice-resolver.js           resolve style before snapshot; template read first
utils/invoice/template-service.js           sample invoices use the same resolved style
utils/invoice/mapping.js                    optional amountInWords.wordsStyle (validated)
public/js/billing-template-editor.js        serial column default + toggle, suffix select
views/vendor/billing-template.ejs            Line numbers + suffix controls
scripts/render-audit-samples.mjs            NEW: visual audit renderer (before/after)
scripts/qa-billing-server.mjs               seeded mapping includes the serial column
tests/unit/invoice-format.test.js           suffix/singular/plural coverage
tests/unit/invoice-data.test.js             default suffix, persisted parcel reconciliation
tests/unit/invoice-render.test.js           serial numbering, suffix detection, override
tests/unit/invoice-flow.test.js             snapshot reconciliation + tax-neutrality
tests/e2e/view-invoice.spec.js              393 and 414 px viewports, bottom nav, repeat clicks
tests/e2e/billing-template.spec.js          serial default + suffix persistence
```

---

## 5. Remaining production risks

1. **Production database and storage are still undiagnosed** (F13). If an
   `Invoice` row's PDF is missing on the serving filesystem, the invoice remains
   unreadable until the file is restored — no re-render is attempted, by design.
   Run `scripts/diagnose-production-billing.mjs` per environment first.
2. **Existing active mappings will not gain numbering automatically.** Mappings
   are frozen when active; the serial column is applied to new/edited tables.
   Well B must upload a replacement PDF version or re-create the mapping to pick
   up numbering and an explicit suffix choice. Already-issued invoices are
   immutable and unaffected.
3. **Auto-detection is band-limited.** A printed suffix further than ~2 lines from
   the field is not detected; the vendor can set the style explicitly.
4. **PDF storage is not durable by configuration alone.** A relative
   `BILLING_STORAGE_DIR` remains unsafe on ephemeral hosts (warning added in F13).
5. **Continuation-page totals carry no printed labels** (static page-1 labels) —
   template limitation described in D5.
6. **Static tax labels with blank values** may still read as “tax rows” — needs a
   vendor template/placement decision (D4).
7. **`amountWordsStyle` is recorded only on invoices issued after this change.**
   Older snapshots have no style field; their PDFs remain valid and unchanged.
8. **No production verification.** All evidence here is local/isolated. Do not
   treat the suite passing as proof that flashfoods.in issues correct invoices.

---

## 6. Completion criteria

| Criterion | Status | Evidence |
|---|---|---|
| Item serial numbers render correctly | Met | render test `[1..8]`; 30-item pages 1–2 |
| Amount in words does not duplicate suffixes | Met | format + render tests; before/after PNGs |
| Totals reconcile with persisted snapshots | Met | reconciliation guard + snapshot test |
| Tax is never fabricated | Met | `taxMode: "none"` returns null/empty; test |
| Long values render without clipping | Met | long-values sample inspected |
| Continuation pages work | Met | 10/30-item samples, numbering + totals |
| View and Download serve identical bytes | Met | invoice-view E2E SHA equality |
| Existing security and pickup tests pass | Met | `npm test` 346/346 |
| Ready for production | **Not claimed** | §5 risks above, F13 blocked |
