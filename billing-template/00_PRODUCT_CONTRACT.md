# 00 — Product Contract (LOCKED)

Every statement in this file is a locked product decision. It overrides
implementation convenience, older plans, and any conflicting description
elsewhere. Only a human product owner may change it, and a change must be
recorded in this file before code follows it.

Scope of precedence: this contract governs **F10 Custom Billing Template
System** only. It does not modify or supersede the F09 contract in
`.ai/goal.md` or any `.ai/BUSINESS_RULES.md` invariant.

---

## 1. Objective

Build a **vendor-managed custom invoice template system**.

1. Each vendor uploads their own existing business invoice as a **PDF**, through
   `Vendor Portal → Manage Menu → Billing Template`.
2. FlashFoods uses that uploaded PDF as the original background/design and
   inserts actual order information into it.
3. The output is a **new, order-specific PDF invoice**, downloadable by the
   student who owns the order (and by the vendor, subject to shop ownership).

The system exists so a canteen can issue invoices that carry its own printed
branding, numbering style, layout and payment details without FlashFoods
redrawing the invoice.

---

## 2. Locked architecture: PDF overlay

This is a **PDF overlay system**:

- Load the vendor's original PDF bytes.
- Draw dynamic text and item rows on top of the existing page(s).
- Save the result as a **new** PDF. The original is never written to.

It is **NOT**:

- an HTML invoice recreation system;
- a CSS-based invoice designer;
- a system that converts a vendor PDF into a new invoice layout;
- a drag-and-drop graphical editor for designing invoices from scratch.

The following must be preserved exactly as the vendor supplied them: logo,
images, branding, colours, backgrounds, borders, existing static text, existing
layout, existing graphics. The only permitted visual change is the added
dynamic content.

Additional locked rules:

- The original template file is **read-only** at generation time. Generation
  never mutates, re-saves over, or truncates the stored template.
- Generated invoices are separate files. They are never written back into the
  template record.
- Multiple concurrent generations of different orders from the same template
  must not interfere; each generation loads template bytes fresh (or from an
  immutable cached buffer).

---

## 3. Locked typography

- **Roboto is the universal font for dynamically inserted content.**
- Exactly three assets are bundled with FlashFoods: **Roboto Regular**,
  **Roboto Medium**, **Roboto Bold**.
- Embedding uses `@pdf-lib/fontkit`.
- Roboto is used for: invoice number, invoice date, customer/business name,
  customer details, item descriptions, quantities, unit rates, line amounts,
  subtotal, discount, parcel charge, CGST, SGST, final total, amount in words,
  and any other dynamically generated text.
- Roboto **must** render the Indian Rupee symbol `₹` (U+20B9). This is verified
  by a test, not by assumption.
- The Roboto licence text is committed with the font assets.
- **Vendors never upload fonts.** There is no vendor font upload UI, route,
  field or validation path.
- The original PDF's own embedded fonts and branding are untouched: static text
  supplied in the PDF keeps its font.

Acceptable fallback policy (only): if a required Roboto file is missing, invoice
generation must fail closed with a recorded error. Substituting Helvetica or a
runtime web font is forbidden, because it changes typography and may lose `₹`.

---

## 4. Locked vendor upload rules

- Vendors upload **only** a PDF invoice template.
- Maximum size: **10 MB** (10 × 1024 × 1024 bytes) for the template PDF.
- Server-side validation must check: file extension, declared MIME type, actual
  PDF file signature (`%PDF-`), parseability with the PDF library, file size,
  and encrypted/unsupported PDF conditions. Client-side `accept=".pdf"` is a
  convenience only and is never trusted.
- A **dedicated PDF upload/storage implementation** is required. The existing
  image Multer/Cloudinary configuration is image-specific; it must not be
  reused for PDFs without verification (see `06_STORAGE_SECURITY_AND_INTEGRATION.md`).

---

## 5. Locked one-time field configuration

The system must learn where to place dynamic content, once per template, not per
order.

- The preview and coordinate capture use **PDF.js** (`pdfjs-dist`).
- The vendor (or an operator acting for the vendor) configures positions for at
  least: invoice number, invoice date, customer/business name, customer details
  (where available), item table, subtotal, discount, parcel charge, CGST, SGST,
  final total, amount in words, and other explicitly supported fields.
- The item table must support: item description, quantity, unit rate, line
  amount, row height, column positions, text alignment, and font sizing.
- **PDF-native coordinates are the saved source of truth.** PDF.js viewport
  coordinates are converted correctly, accounting for page dimensions, scale
  and rotation, before storage.
- Configuration is saved **against a specific template version**.
- Vendors must never re-configure fields for each order.
- A **sample invoice preview** must be produced and shown before activation.
- The system must **not** promise automatic detection of arbitrary PDF fields.
  Every position is explicit.

---

## 6. Locked source-template restriction (clean master PDF)

A vendor must supply a **clean master invoice PDF** whose transaction-specific
fields are empty.

The supplied "Well B" example contains printed sample values (Mango Smoothie,
Avocado Smoothie, sample quantities, sample prices, sample totals). Those values
are part of the PDF's own content stream. Drawing new text on top does not
remove them:

- both texts remain in the file and in text extraction;
- printed and accessibility output can show overlapping values;
- the visual result depends on the background behind the printed sample.

Therefore:

- Drawing filled white rectangles over the sample ("white-box masking") must
  **not** be the default or automatic behavior.
- A template containing visible pre-printed transaction values may only be
  activated if a **clean master PDF** is uploaded, or if a separately specified,
  explicitly configured masking capability is verified in a later, separately
  authorized phase. That capability is **out of scope** for this feature's
  initial implementation.
- The documentation and UI must state the clean-master requirement plainly. No
  automatic detection of printed sample values is promised.

---

## 7. Locked invoice issuance policy

**Generation trigger:** generate the final invoice for an **eligible paid order**
after **successful collection/completion**. There is no invoice for an order
that has not been collected.

**Eligibility rules (all must hold):**

1. `order.status === "completed"` (persisted).
2. `order.collectedAt` is set (evidence of a real collection event).
3. A payment was actually captured for the order, evidenced by persisted
   gateway/payment data:
   - `amountChargedPaise` is a finite number `> 0`, **or**
   - the order is a mock/offline order (`order.paymentNote === "mock"`), which is
     eligible only because `POST /orders/checkout` is hard-restricted to the
     `testing` shop and writes `amountChargedPaise` itself.
4. The order's persisted payable amount (`order.total`) in paise is a finite
   number `> 0`.
5. The shop has an **active** template version with a complete field mapping.

`status === "completed"` **alone is never sufficient**. The generator must read
the persisted payment facts above, not infer capture from status.

**Never generate** for:

- `pending_payment`, `paid`, `accepted`, `ready_for_pickup` (not yet collected);
- `cancelled` orders, including cancelled-after-payment with a refund;
- orders whose payment evidence fails rule 3 (record the reason, do not issue).

**Single issuance:**

- An invoice is generated **exactly once** per order.
- Repeated requests (student, vendor, retry, concurrent HTTP, retry after a
  crash) return the existing invoice record/file.
- **No duplicate invoice numbers**, ever.
- Invoice numbering must be allocated atomically and scoped to the shop.

**Immutability:**

- The invoice snapshot is immutable: values used to render the invoice are
  frozen at issuance.
- Replacing or removing the shop template must not change already-issued
  invoices; their PDF bytes, snapshot, number and template-version reference
  stay readable.
- Post-issue refunds and adjustments must not silently rewrite the original
  invoice. They may be reflected as later events (see
  `05_INVOICE_DATA_AND_GENERATION.md` §10) but the issued invoice document and
  numbers remain unchanged.

**Completion paths to cover:** every path that can move an order to
`completed`. In the audited repository these are `POST /vendor/verify` (OTP) and
`POST /vendor/verify-qr` (QR). The implementing agent must re-verify this set in
live code, including administrative flows, before finalizing the integration
points, and must not modify the pickup workflow to add new states or buttons.

**Default-billing fallback (locked):** FlashFoods already renders a default
order bill in `views/orders/show.ejs` (shop name, item lines with quantities and
line amounts, parcel charge, total, status, progress tracker, pickup OTP/QR).
That existing UI is the **default billing experience** and the fallback for this
feature. It must remain the billing experience for every shop without an active
custom PDF template:

- **No custom template** (never uploaded, or removed): the student sees the
  existing default order bill unchanged. No invoice PDF is generated, no
  invoice download action is shown, and no new empty/error state replaces the
  bill.
- **Uploaded but unconfigured or unactivated template:** same as the first
  case. A draft template never changes the student experience.
- **Active custom template + eligible collected order:** generate the vendor-PDF
  overlay invoice and offer its download. The existing order-detail content
  stays as the page's order/billing view; the download is additive.
- **Replacement/removal:** already-generated invoices are unaffected and remain
  downloadable (see Immutability above).

**A generic FlashFoods PDF invoice or receipt is NOT required or permitted by
this feature.** The fallback is the existing HTML order-detail bill, never a
FlashFoods-branded PDF. "Fallback" also never means issuing a PDF for an
ineligible order: custom PDF generation remains subject to the eligibility
rules above (`completed` + `collectedAt` + payment evidence + active template).

**No bulk backfill:** orders completed before a shop activated a template are
not invoiced in bulk. Such an order receives an invoice only if it is resolved
on demand after activation, under the same eligibility rules and the same
one-invoice-per-order guarantee.

---

## 8. Locked financial rules

- The invoice generator uses **authoritative persisted order data** and the
  existing financial rules/utilities. It never trusts browser-supplied prices,
  quantities, discounts, taxes or totals.
- The invoice total must reconcile with the actual amount payable/charged under
  the existing order and payment flow (see `05_INVOICE_DATA_AND_GENERATION.md` §6).
- Discounts: only the persisted `discountPercent` and `discountAmountPaise` may
  be shown; the discount applies to the food subtotal and never to the parcel
  charge (existing `utils/discount.js` rule).
- Parcel charge: only the persisted `order.parcelCharge` for `orderType === "parcel"`.
- Removed items (`item.status === "removed"`) are not billable lines. Persisted
  adjusted totals (`originalTotal`, `updatedTotal`, `refundAmount`) must be
  respected, and the invoice must not present removed items as charges.
- Adjustments: bill the post-adjustment payable amount; show the adjustment
  event (removed item names, refund amount, reason, timestamp) as invoice
  metadata, not by rewriting the charged amount.
- Refunds: shown as refund state/amount metadata with timestamps. A refund never
  retroactively changes an issued invoice total.
- **No invented tax rules.** The repository has no tax configuration, no GSTIN,
  no tax rates and no tax-inclusive flag (verified, see `01_CODEBASE_AUDIT.md`).
  Tax lines are therefore **disabled by default** and may only appear as a
  breakdown of an already-payable total when the vendor supplies rates, with
  exact reconciliation to the persisted total (see §9 and
  `05_INVOICE_DATA_AND_GENERATION.md` §5.4). The generator must never add tax on
  top of the stored total, and must never change the payable amount.

---

## 9. Data availability rules (do not invent fields)

Verified to **not exist** today: billing addresses, GSTIN, HSN/SAC codes, tax
rates, invoice numbers, bank details, place of supply, invoice snapshot/record,
delivery address.

Consequences:

- Any statutory field that is not derivable from `Shop`, `User`, `Order` or
  vendor-provided invoice configuration must be marked **not available** and
  either omitted or rendered as a vendor-configured constant (see
  `05_INVOICE_DATA_AND_GENERATION.md` §4).
- The invoice must not imply FlashFoods is the seller of record unless a human
  decision records that. The seller identity printed on the vendor's own PDF is
  the vendor's responsibility (DECISION-6).
- Amount in words is generated from the persisted payable amount by a
  deterministic converter (Indian numbering: lakh/crore), not stored in the DB.

---

## 10. Non-goals

Explicitly out of scope for this feature:

1. Recreating the vendor invoice in HTML/CSS or a canvas UI.
2. A graphical invoice designer, template gallery, or drag-and-drop layout
   builder for creating designs from scratch.
3. Vendor font uploads, custom font selection, or per-vendor typography.
4. Automatic detection/OCR of invoice fields, or auto-mapping of arbitrary PDFs.
5. White-box masking of pre-printed sample values as the default mechanism.
6. Generating invoices before collection, or for unpaid/cancelled orders.
7. Editing, reissuing or renumbering an already-issued invoice.
8. Email/WhatsApp delivery of invoices, payment-gateway invoice APIs, or
   accounting-system export.
9. Multi-currency support, foreign tax regimes, or e-invoicing/IRN integration.
10. Changing the order lifecycle, pickup verification, payment flows, refund
    logic, or vendor menu behavior.
11. Building a separate vendor-to-shop authorization system (the existing
    `requireVendorShop` contract is used as-is).
12. Adding a CSRF token framework (the existing Origin/Referer middleware is
    used as-is).
13. Building any generic FlashFoods-branded PDF invoice, receipt or bill as a
    fallback. The fallback for shops without an active custom template is the
    existing HTML order-detail bill in `views/orders/show.ejs`.

---

## 11. Forbidden implementation approaches

The following are prohibited even if they appear simpler:

| Forbidden | Why |
|---|---|
| Rendering the invoice as HTML and printing to PDF | Loses the original design; contradicts the locked overlay architecture. |
| Converting the vendor PDF to an image and drawing on the image | Degrades print quality, breaks text, and is not the prescribed pipeline. |
| Building a new PDF layout from vendor data | Recreates the invoice instead of preserving it. |
| Generating a generic FlashFoods PDF invoice/receipt as a fallback | The locked fallback is the existing HTML order-detail bill; no generic PDF is in scope for any shop state. |
| Replacing, hiding or restyling the existing default order bill with a PDF or new billing UI | `views/orders/show.ejs` is the default billing experience and must stay intact for shops without an active template. |
| Letting the vendor design fields by dragging arbitrary elements | Locked scope is explicit field mapping, not a designer. |
| Using a non-Roboto font for dynamic text, or `StandardFonts.Helvetica` for `₹` | WinAnsi encoding cannot represent U+20B9. |
| Uploading fonts from vendors | Locked out. |
| Overwriting/masking printed sample values with white boxes | Unreliable; masks backgrounds/borders; leaves stale text in the file. |
| Trusting client-posted coordinates without normalization/validation | Allows malformed or out-of-page mappings. |
| Deriving invoice totals from request parameters or recomputing from menu items | Must use persisted order values. |
| Generating an invoice for any order that is not `completed` with payment evidence | Locked eligibility. |
| Issuing a second invoice for the same order | Duplicate numbering and audit failure. |
| Mutating the template file in place, or writing generated PDFs into the template path | Destroys the source of truth for future invoices. |
| Serving invoice PDFs from a public/static directory | Unauthenticated data exposure. |
| Assuming Cloudinary can store/serve PDFs exactly like images | Unverified; see `06_STORAGE_SECURITY_AND_INTEGRATION.md`. |
| Adding tax lines computed from external assumptions | Invents financial behavior. |
| Modifying pickup/payment code paths to add invoice hooks that change their semantics | Regression risk to protected flows. |
| Marking tests passed without execution | Violates `.ai/rules.md` §13 and `.ai/test.md`. |

---

## 12. Security and ownership (locked)

- Vendor billing operations act on `req.vendorShopId` / `req.vendorShopIdStr`
  from `requireVendorShop`. No client-supplied shop id is trusted for writes.
- Student invoice download requires authentication, `role === "student"` (or an
  authorized vendor/admin route), and `String(order.customer) ===
  String(req.session.userId)` for the student path — mirroring the existing
  `GET /orders/:id` ownership check.
- Invoice PDFs are served only through authenticated, authorized routes with
  `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
  No direct public URL, no predictable static path.
- Uploaded templates and generated invoices live in **private** storage, not in
  `public/`.
- Existing CSRF protection (Origin/Referer allowlist applied to all
  POST/PUT/PATCH/DELETE) must apply to every new mutating route; do not exempt
  billing routes and do not add a token system.

---

## 13. Open decisions (unresolved — must be labeled, not guessed)

| ID | Decision | Default behavior until decided | Blocking? |
|---|---|---|---|
| DECISION-1 | Statutory invoice-number format (prefix, financial year, series, length, reset rules) | `INV-<shopSlug>-<6-digit zero-padded sequence>`, atomic per shop, no FY reset | No — implementation may proceed with the default; production sign-off requires the decision |
| DECISION-2 | Whether vendor-printed totals are tax-inclusive, and whether CGST/SGST must appear at all | `taxMode = "none"`; tax lines hidden | No — but if a vendor enables tax, the implementing agent must stop for this decision |
| DECISION-3 | Production storage backend (private local volume vs object storage) | Private local filesystem adapter under a non-public directory | No for dev/test; yes before production |
| DECISION-4 | Whether any masking capability will ever be offered for non-clean PDFs | Not offered; clean master PDF required | No |
| DECISION-5 | Whether activation must be blocked when sample values look present | No automatic detection; vendor checklist acknowledgement only | No |
| DECISION-6 | Whether FlashFoods seller identity/legal metadata must appear on invoices | Not printed; vendor's own PDF is the invoice identity | No for implementation; legal review required |
| DECISION-7 | Easebuzz captured-amount verification gap (existing comment: "Easebuzz amount verification is still outstanding") | Easebuzz orders are eligible only if `amountChargedPaise` is set and reconciles to `order.total`; the gap is recorded, not fixed here | No — but must be listed in the final report |
| DECISION-8 | Retention policy (how long generated invoices and template versions are kept) | Keep indefinitely; deletion not implemented | Yes before any deletion feature |

Decisions must be recorded in this table (or in the final report) with the date
and the chosen value. Local defaults may be used to unblock development, but a
default is never presented as a business decision.

---

## 14. What "done" means

The feature is complete only when evidence shows:

1. A vendor can upload a clean PDF, see it rendered, configure every required
   field once, preview a sample invoice, and activate the template.
2. A collected, eligible order produces one invoice PDF whose dynamic content
   sits at the configured coordinates, uses embedded Roboto, and shows `₹`.
3. The invoice total reconciles exactly to the persisted payable amount.
4. Repeated and concurrent requests never create a second invoice or number.
5. Historical invoices remain downloadable after the vendor replaces or removes
   the template.
6. Cross-vendor and cross-student access attempts fail.
7. All Phase 5 regression checks pass for orders, payments, pickup, vendor menu,
   admin, and mobile/desktop UI policy.
8. Shops without an active custom template show the existing default order bill
   unchanged, with no invoice download action and no generated PDF; uploaded-but-
   unconfigured templates behave the same way.

Anything less is `IN_PROGRESS`, not complete.
