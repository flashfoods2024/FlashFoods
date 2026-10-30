# 03 — Vendor Upload Workflow (PROPOSED)

The vendor-facing experience for the Billing Template card in
`Vendor Portal → Manage Menu`. Everything here is PROPOSED; the existing card
order and conventions are EXISTING and verified in `01_CODEBASE_AUDIT.md` §5.

Related: `02_SYSTEM_ARCHITECTURE.md` (flows), `04_PDF_TEMPLATE_ENGINE.md`
(rendering), `06_STORAGE_SECURITY_AND_INTEGRATION.md` (routes/storage),
`07_TESTING_AND_ACCEPTANCE.md` (UI tests).

---

## 1. Placement (locked)

The Billing Template card belongs inside `views/partials/menu-manager.ejs`.

Verified existing card order in that partial:

1. Shop Status
2. Discount
3. **Pickup Slots**
4. **Operating Hours**
5. Parcel Packaging
6. Add new item
7. Menu items table

The new card goes **after the Pickup Slots card and before the Operating Hours
card**.

Implementation constraints:

- Render it only when a new optional local is provided (for example
  `billingTemplateAction` / `billingTemplate`), so admin reuse of this partial
  (`views/admin/*` menu pages) is unaffected unless a later phase explicitly
  opts in.
- Reuse the existing vendor classes: `card`, `h2`, `muted small`, `form`, `btn`,
  `btn--small`, `btn--ghost`, `tag tag--ok|tag--warn|tag--muted`, `row`.
- Do not introduce a vendor design system, new global CSS framework, or
  restyled existing cards.
- `GET /vendor/menu` must pass the card's locals; anything the card needs that
  the route does not load yet is added to that render call only.

Proposed card heading and copy:

```text
Billing Template
Upload your own invoice PDF. We print your invoice design unchanged and add the
order details on top of it. Use a clean master PDF with empty customer, item
and total fields.
```

---

## 2. States

The card has exactly these states. A state is derived server-side from the
template record — never from browser local storage.

| State | Condition | Card shows | Student billing experience |
|---|---|---|---|
| `none` | No template record / no versions | Upload form + requirement checklist | Existing default order bill (unchanged) |
| `uploaded` | Latest version has no mapping | Thumbnail/first-page preview, "Configure fields" primary action, replace/remove | Existing default order bill (unchanged) |
| `configured` | Mapping saved, not activated | Preview + "Generate sample invoice", "Activate", replace/remove | Existing default order bill (unchanged) |
| `active` | `currentVersionId` set and version active | Active badge, "Issued invoices: N", replace/remove, "Edit positions (creates new version)" | Custom PDF invoice for eligible collected orders; default bill otherwise |
| `error` | Last operation failed | Error message + retry action; never a silent blank card | Existing default order bill (unchanged) |

Uploading or configuring a template never hides, replaces or alters the existing
default order bill. The default bill remains the billing view for every student
until a template is active **and** the order qualifies for a custom invoice.

Terminology in the UI must match `README.md` §7 (Template PDF, Template
Version, Field Mapping, Activation, Sample Preview).

---

## 3. Initial upload state

- File input: `accept="application/pdf,.pdf"`, single file, `required`, plus
  visible text "PDF only · max 10 MB".
- A short checklist before the button, stating the locked clean-master
  requirement:
  - your invoice design, logo and branding stay exactly as supplied;
  - customer, item, quantity, price, total and amount-in-words areas must be
    **empty** in the file;
  - we do not remove pre-printed values from the PDF;
  - one PDF file, up to 10 MB.
- Submit posts `multipart/form-data` to the proposed upload route. The form is a
  normal same-origin POST: the existing Origin/Referer CSRF middleware covers
  it and requires no token field.
- On success: `req.flash("success", ...)` + redirect to `/vendor/menu`.
- On failure: `req.flash("error", ...)` + redirect to `/vendor/menu`, with a
  message naming the actual reason (see §10).

Before upload the vendor must be able to open a short "How this works" note or
section explaining overlay (the app keeps their design and prints values on
top). Do not use the words "design editor", "template builder" or "drag to
design the invoice" anywhere in the UI.

---

## 4. Uploaded state

Shows:

- File name, size (MB), upload date, page count, checksum short id (optional,
  truncated).
- A first-page preview. Two options were considered:
  - server-rendered PNG thumbnail (requires a rasterizer — not a listed
    dependency) → **PROPOSED optional**, needs a separate approval because it
    adds an image pipeline for PDFs;
  - PDF.js canvas preview in the browser (already required for configuration) →
    **default approach**.
- Primary action: **Configure fields**.
- Secondary actions: **Replace PDF**, **Remove template**.
- Warning if the mapping is missing: "Invoices cannot be issued until positions
  are configured and the template is activated."

---

## 5. PDF preview

Preview page requirements (PROPOSED):

- Vendor-only route streams the stored PDF bytes with
  `Content-Type: application/pdf`, `Cache-Control: private, no-store`.
- The browser renders with `pdfjs-dist` into a canvas at a scale derived from
  the container width (default fit-width; zoom in/out allowed).
- Page navigation for multi-page PDFs; the page used for field mapping is
  selectable and saved as `pageIndex`.
- Preview is a **viewer**, not an editor of invoice content. No drawing tools
  beyond placing supported fields.
- Preview must not send the PDF through a third-party service.

---

## 6. Field configuration

The configuration experience is a one-time mapping, not a designer.

Interaction:

- A list of supported fields is shown; the vendor selects a field then clicks
  its target position (or drags its saved box). Existing positions are visible
  as labelled outlines with a delete/reset action.
- Required fields (must all be mapped before activation): invoice number,
  invoice date, customer name, item table (with its column set), subtotal,
  final total, amount in words.
- Optional fields: customer phone/details, discount, parcel charge, CGST, SGST,
  payment reference, notes/terms, delivery/pickup info, seller constants.
- The item table is a rectangle plus column definitions: description, quantity,
  unit rate, line amount. The vendor sets row height, per-column X positions and
  widths, per-column alignment (left/center/right), and font size. A live sample
  row is drawn in the preview overlay so alignment errors are visible before
  saving.
- Numeric fields are numeric with sensible min/max; the server re-validates.
- Coordinates are converted to **PDF-native coordinates** in the browser before
  posting (see `04_PDF_TEMPLATE_ENGINE.md` §4). The saved payload contains only
  PDF coordinates, page index, sizes and alignments — never viewport pixels,
  scale-dependent values, or canvas coordinates.
- Save posts JSON (or a urlencoded form) to the mapping route for that exact
  template version. Changing the PDF requires configuring again.

Explicitly not provided:

- No automatic field detection, no OCR, no "guess positions" button.
- No free-text text boxes for the vendor to invent new invoice sections.
- No font picker (Roboto only).
- No colour picker for dynamic text beyond an approved default/monochrome
  neutral and an optional pre-approved dark ink value.

---

## 7. Sample preview

Before activation the vendor must be able to generate a **sample invoice**:

- Rendered server-side by the real generator with synthetic data
  (sample customer `Sample Student`, 2–3 item lines, a realistic discount,
  parcel charge, totals, amount in words).
- Clearly watermarked/labelled `SAMPLE` in a corner field mapped for that
  purpose **or** in the served filename (`sample-invoice.pdf`); the sample must
  never carry a real invoice number (use `SAMPLE` as the number value).
- The sample is not persisted as an invoice, is not counted in invoice numbers,
  and is rendered on demand (optionally cached per version+mapping hash in
  private storage with a short-lived key).
- The vendor must be able to see page 1 and any continuation page the sample
  data produces, so overflow behavior is visible.
- Activation requires a successful sample render (the server records
  `previewedAt`/`previewHash`); if the mapping changes after preview, activation
  must re-require a fresh preview.

---

## 8. Activation

- Activation route validates: version exists and belongs to `req.vendorShopId`,
  required fields present, all coordinates inside page bounds, item table has
  valid columns/row height/font sizes, sample preview rendered for the current
  mapping hash, fonts available, and the PDF still parses.
- On success: set the version `active`, set `currentVersionId`, `activatedAt`,
  and mark the previous active version `superseded` (bytes retained).
- On failure: keep the previous active version active; show the specific
  validation error. Activation must be atomic enough that two concurrent
  activations cannot leave two active versions (do the switch in a single
  `findOneAndUpdate` scoped to the shop, or accept a transactional equivalent).
- Post-activation, the card shows: active version number, activation date,
  number of invoices issued with it, and a link to preview the live template.

---

## 9. Replacement

- "Replace PDF" starts a **new version**. Uploading new bytes never overwrites
  the previous version's bytes.
- The new version starts `uploaded` with an empty mapping; the **current active
  version keeps issuing invoices** until the vendor activates the replacement.
- On activation of the replacement, the previous version becomes `superseded`.
  Already-issued invoices keep their recorded version reference and remain
  downloadable.
- The UI must state plainly: "Existing invoices keep their current design. New
  orders will use the new PDF."

---

## 10. Removal

- "Remove template" sets `currentVersionId: null` and marks the active version
  inactive; it does not delete files or invoice records.
- After removal, students continue to see the existing default order bill. No
  new custom PDF invoices are issued, and previously issued invoices remain
  downloadable.
- Confirmation is required (two-step or explicit confirm checkbox) and the copy
  explains: new invoices stop being issued; already-issued invoices remain
  available; uploading a new PDF requires configuration again.
- Removal is idempotent and shop-scoped.
- Physical deletion is out of scope (DECISION-8).

---

## 11. Error handling

Vendor-facing messages must name the cause. Minimum set:

| Failure | Message intent |
|---|---|
| No file / wrong field name | "Choose a PDF file to upload." |
| Non-PDF extension or MIME | "Only PDF files are supported." |
| Missing `%PDF-` signature | "This file is not a valid PDF." |
| Unparseable/corrupt | "This PDF could not be read. Re-export it and try again." |
| Encrypted/password-protected | "Password-protected PDFs are not supported. Upload an unprotected PDF." |
| Over 10 MB | "PDF must be 10 MB or smaller." |
| Too many pages / page too small | "This PDF has too many pages / a page is too small to place fields on." |
| Rotated page | "This PDF uses rotated pages, which are not supported. Re-export it in normal orientation." |
| Missing required mapping | "Map the required fields before activating." |
| Coordinate outside page | "A field position is outside the page. Re-place it." |
| No sample preview for current mapping | "Generate a sample invoice before activating." |
| Font asset missing | "Invoice fonts are unavailable. Contact support." (operator-facing log) |
| Generic failure | Existing pattern: `req.flash("error", …)` + redirect, `console.error(err)` |

Rules:

- Never show stack traces, file system paths, storage keys or internal ids to
  vendors.
- Never silently accept a partially valid upload.
- Reuse the existing flash + redirect convention (`views/partials/header.ejs`
  renders `flash`); do not add a toast framework.

---

## 12. Mobile responsiveness

- Vendor screens are mobile-first in practice; the card must be usable at
  393×852 and at desktop widths.
- The card is a vertical stack on narrow screens: file input full width,
  buttons full width or wrapping, requirement checklist as a plain list.
- The configuration page: preview canvas fitted to the container, with a
  scrollable/zoomable page and a field list that becomes a bottom section on
  narrow screens. Minimum 44 px touch targets for field placement buttons.
- Mapping a position by tap-then-tap is the fallback for drag gestures on touch;
  the interaction must not require a mouse.
- No desktop regression on existing vendor pages (`.ai/rules.md` §17 and
  `.ai/UI_STANDARD.md` Section E): adding the card must not restyle existing
  cards or alter the vendor page layout at ≥768 px beyond the new card's own
  box.
- No horizontal page overflow at 393 px; the item-table column editor must
  scroll horizontally inside its own container rather than widening the page.

---

## 13. Copy and terminology checklist

- Use "invoice", "template PDF", "field positions", "sample invoice",
  "activate".
- Never say "create your invoice design here", "customize your invoice layout",
  or "AI will find your fields".
- Always repeat the clean-master requirement where upload happens.
- State that the vendor's design is preserved unchanged.
- State that invoices are issued after pickup and that they are the vendor's
  invoice design with FlashFoods order data overlaid.
