# 06 — Storage, Security and Integration (PROPOSED)

Cross-references: locked security rules `00_PRODUCT_CONTRACT.md` §12, verified
existing storage/auth/CSRF `01_CODEBASE_AUDIT.md` §§4, 9, flow detail
`02_SYSTEM_ARCHITECTURE.md`.

All routes, models, paths and dependencies here are **PROPOSED** unless marked
EXISTING.

---

## 1. PDF upload validation

### 1.1 Dedicated upload path

Do **not** reuse `middleware/upload.js` or `config/cloudinary.js`:

- `uploadMenuImage` / `uploadShopImage` accept only `image/*` and cap at 5 MB;
- both use `CloudinaryStorage` with `resource_type: "image"` and image
  transformations, which are wrong for documents;
- `handleMenuImageUpload` redirects to `/vendor/menu` with an image-specific
  error string.

PROPOSED: `middleware/billingUpload.js` exporting
`handleBillingTemplateUpload`, built on `multer` **memory storage** (or a
private temp dir), with:

```js
limits: { fileSize: 10 * 1024 * 1024, files: 1 },
fileFilter: (req, file, cb) => allowed name/mimetype only  // first gate
```

Memory storage is acceptable at 10 MB and avoids temp-file cleanup; verify the
process can handle one concurrent 10 MB buffer per upload (it can, but record
the measurement).

### 1.2 Validation gates (all server-side, in order)

| # | Gate | Failure reason |
|---|---|---|
| 1 | exactly one file on field `template` | `no_file` |
| 2 | original filename ends with `.pdf` (case-insensitive) | `bad_extension` |
| 3 | declared MIME is `application/pdf` or `application/octet-stream` | `bad_mime` |
| 4 | byte length ≤ 10 MB | `file_too_large` |
| 5 | first 1024 bytes contain `%PDF-` | `not_a_pdf` |
| 6 | `PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })` succeeds | `invalid_pdf` / `encrypted_pdf` |
| 7 | round-trip `await pdfDoc.save()` succeeds | `unsupported_pdf` |
| 8 | page count 1…10 | `too_many_pages` |
| 9 | every page `getRotation().angle === 0` | `rotated_page` |
| 10 | every page width/height in 200…2000 pt | `unsupported_page_size` |
| 11 | page origin at (0,0) unless the origin behavior is proven | `unsupported_page_origin` |
| 12 | computed sha256 not already stored for this shop (dedupe) | reuse existing version (not an error) |

Also reject an empty (`0` byte) file and a PDF whose `pdfDoc.getPageCount()` is
`0`.

Order matters: cheapest checks first; parsing before structural checks.

### 1.3 Failure UX

- Flash + redirect to `/vendor/menu` (existing convention), with the message
  table in `03_VENDOR_UPLOAD_WORKFLOW.md` §11.
- No version row, no stored file, no counter change on failure.
- Log server-side with route, shop id, reason code, byte size — **never** the
  file bytes, the customer data, or env values.

---

## 2. Storage model

Four distinct artifacts, four distinct key namespaces:

| Artifact | Key (proposed) | Mutability |
|---|---|---|
| Original template PDF | `templates/<shopId>/<templateId>/v<version>-<sha256>.pdf` | write-once |
| Saved field mapping | Database (`InvoiceTemplate.versions[].mapping`) | mutable until activation, then frozen |
| Generated invoice PDF | `invoices/<shopId>/<invoiceId>/<sha256>.pdf` | write-once |
| Immutable snapshot | Database (`Invoice.snapshot`) | write-once (guarded) |

Additional optional artifact: `previews/<shopId>/<templateId>/v<version>-<mappingHash>.pdf`
(rebuildable, safe to evict).

### 2.1 Storage adapter (PROPOSED)

```text
utils/invoice/storage.js
  putTemplatePdf({ shopId, templateId, version, bytes })   → { key, sha256, byteSize }
  getTemplatePdf(key)                                      → Buffer
  putInvoicePdf({ shopId, invoiceId, bytes })              → { key, sha256, byteSize }
  getInvoicePdf(key)                                        → Buffer
  putPreviewPdf(...) / deletePreviewPdf(...)
```

Rules:

- All keys are generated server-side from ids and hashes; never from user input.
- Reading validates that the resolved absolute path remains inside the configured
  storage root (`path.resolve` + prefix check) to prevent traversal if a key is
  ever corrupted.
- The adapter never returns a public URL. Route handlers stream bytes.
- Writes are atomic (write temp file in the same directory, then `rename`).

### 2.2 Default backend: private local filesystem

```text
storage/                      ← repository-root sibling of public/ (gitignored)
  templates/…
  invoices/…
  previews/…
```

- Configure the root via `BILLING_STORAGE_DIR` (default `./storage`), resolved
  relative to the project root. Add the directory to `.gitignore` and ensure it
  is **not** inside `public/` (only `public/` is served by `express.static`).
- Create the directory tree on demand with `fs.mkdir(..., { recursive: true })`.
- Backups are an operational concern outside this feature; document them in the
  final report.

### 2.3 Cloudinary / object storage — UNVERIFIED

The project already has Cloudinary credentials and `multer-storage-cloudinary`,
but:

- `allowed_formats` is restricted to images in the existing storages;
- `resource_type: "raw"` delivery URLs and authenticated/private delivery for
  PDFs are **not verified** for this account, SDK version, or the app's proxy
  setup;
- `res.cloudinary.com` URLs are public unless signed/private delivery is
  configured, which would violate the locked "authenticated access only" rule;
- PDF transforms/optimizations are not needed and may strip fonts.

Therefore:

- Do **not** switch the billing feature to Cloudinary as part of this feature.
- If a future operator requires object storage, implement it behind the same
  `utils/invoice/storage.js` interface with **authenticated streaming** (server
  fetches bytes, client never sees a provider URL), and prove:
  private delivery, no public URL, correct `Content-Type`, byte integrity
  (`sha256` match), and no dependency on signed-URL expiry.
- Record the decision as DECISION-3.

---

## 3. Generated PDF storage rules

- Generated bytes are written once; the key contains the sha256.
- Serve via authenticated route only; never place them under `public/`.
- Response headers:

```text
Content-Type: application/pdf
Content-Length: <bytes>
Content-Disposition: inline; filename="invoice-<shortRef>.pdf"    (or attachment)
Cache-Control: private, no-store, max-age=0
X-Content-Type-Options: nosniff
Pragma: no-cache                       (belt-and-braces for older proxies)
```

- Filename must be sanitized: only `[A-Za-z0-9._-]`, no user-controlled path
  segments, no vendor-supplied names in the header without encoding.
- Do not support HTTP `Range` unless implemented and tested; a full stream is
  fine for invoice-sized files.
- Never expose a directory listing, a filesystem path, or a storage key in HTML
  or JSON.

---

## 4. Template version management

- `InvoiceTemplate` is unique per shop (`unique: true` on `shop`).
- Versions are append-only; `currentVersionId` is the only mutable pointer.
- Activation switch (atomic, per shop):

```js
await InvoiceTemplate.findOneAndUpdate(
  { shop: shopId },
  {
    $set: { currentVersionId: newVersionId },
    // mark previous active version superseded via arrayFilters or a
    // documented two-step guarded update
  },
  { new: true },
);
```

- A concurrent double-activation must not leave two active versions; test it.
- Replacement retains old version bytes and marks status `superseded`; old
  `Invoice` documents keep their `templateVersionId`, `templateSha256` and
  `mappingHash`, so they remain auditable and downloadable.
- Removal sets `currentVersionId: null` and deactivates the active version; it
  does not delete bytes, invoices, counters or numbers.
- Never reuse a version number after removal (monotonic counter per template).

---

## 5. Authorization

### 5.1 Vendor (shop ownership)

Every vendor billing route uses the **existing** chain:

```text
requireDb, requireAuth, requireVendor, requireVendorShop
```

and reads only `req.vendorShopId` / `req.vendorShopIdStr`. There is no new
vendor-to-shop authorization system, no `shopId` body/query parameter trusted
for writes, and no cross-vendor template access.

Resource-scoping rules:

- Upload: creates a template for `req.vendorShopId` only.
- Config/stream/activate/remove: load the template with
  `{ _id: templateId, shop: req.vendorShopId }`; a mismatch returns "not found"
  (do not confirm existence of another shop's template).
- Sample preview: same scope.
- Vendor invoice view (`GET /vendor/orders/:id/invoice`): load order with
  `{ _id, shop: req.vendorShopId }` (existing vendor order-detail convention).
- Admin must **not** gain implicit access in this feature. If admin access is
  later required, `resolveAdminVendorShop` exists for admin-scoped routes — do
  not reuse `requireVendorShop` for admins.

### 5.2 Student (order ownership)

`GET /orders/:id/invoice` uses:

```text
requireDb, requireAuth, requireStudent
```

then mirrors the existing order-detail ownership check exactly:

```js
const order = await Order.findById(id).lean();
if (!order || String(order.customer) !== String(req.session.userId)) {
  req.flash("error", "Order not found.");
  return res.redirect("/orders");
}
```

- No `customer` id from the client.
- 404-equivalent behavior (flash + redirect) rather than leaking existence.
- A vendor must not be able to call the student route to fetch another shop's
  invoice; role middleware blocks it before ownership checks.
- Admin access to student invoices is **not** part of this feature.

### 5.3 Route-level checklist

| Route | Role | Scope check |
|---|---|---|
| upload / config / mapping / sample / activate / remove | vendor | `req.vendorShopId` only |
| template stream | vendor | template.shop === `req.vendorShopId` |
| vendor invoice view | vendor | order.shop === `req.vendorShopId` |
| student invoice download | student | order.customer === session user |

---

## 6. CSRF protection (EXISTING — reuse, do not replace)

- `middleware/csrfOriginProtection.js` runs globally for POST/PUT/PATCH/DELETE
  and allows requests whose Origin/Referer host equals the request `Host` or
  appears in `ALLOWED_CSRF_ORIGINS` (`["www.flashfoods.in"]`).
- There is **no** CSRF token in this application. Do not invent one, do not add
  a `csrfToken` field to forms, and do not add `csurf`.
- New billing forms are plain same-origin POSTs and are covered automatically.
- Do **not** add billing paths to `CSRF_EXEMPT_PATHS`; that list is only for
  payment-gateway postbacks.
- The mapping editor's fetch (if JSON) must send same-origin credentials
  (`credentials: "same-origin"`) and an `Origin`-bearing request, which browsers
  do automatically for non-GET fetch.
- Upload forms use `multipart/form-data` POST; `csrfOriginProtection` does not
  parse the body, so multipart is unaffected.
- Tests must prove a cross-origin POST to a billing route returns 403.

---

## 7. PDF access control and data privacy

- Every PDF byte read goes through an authorized route; there is no static file
  exposure and no signed public URL.
- Template PDFs are visible only to the owning shop's vendor (and operators with
  server access).
- Generated invoices are visible to the owning student and the shop's vendor.
- Logging policy: log ids, reason codes, byte sizes, timings. Never log customer
  name/email/phone, invoice snapshot JSON, PDF bytes, or `.env` values.
- Error responses never include stack traces, keys, or paths (existing global
  handler already redirects with a generic message).
- Snapshot and Invoice stores contain PII (customer name/phone/email). Treat the
  database as the trust boundary; do not send snapshots to the browser.
- Add `helmet` compatibility check: the existing config sets
  `contentSecurityPolicy: false`, so no CSP change is needed for the PDF.js
  worker. If CSP is ever enabled, `worker-src 'self'` and `script-src 'self'`
  must allow the local worker.
- No third-party analytics, OCR, or PDF conversion service may receive the
  template or invoice.

---

## 8. Safe replacement and cleanup

- Replacement writes a new version key; the old key is untouched.
- Cleanup of orphaned writes: if a DB write fails after the file write, the file
  is orphaned. Implement a **safe, logged, manual-or-scheduled sweep** that only
  deletes files with no referencing template version/invoice and older than a
  threshold (for example 24 h). Never delete files referenced by an Invoice.
- On invoice insert duplicate-key, delete the just-written duplicate file only
  if its key differs from the winner's (identical sha256 ⇒ same key ⇒ no-op).
- Never delete:
  - template versions referenced by any `Invoice`;
  - generated invoice files while their `Invoice` exists;
  - counters.
- Temp files from atomic writes use a `.tmp-` prefix in the same directory and
  are removed on failure.

---

## 9. Database changes

### 9.1 New models

```text
models/InvoiceTemplate.js     one per shop, embedded immutable versions
models/Invoice.js             one per order (unique order index)
models/InvoiceCounter.js      one per shop (unique shop index, seq)
```

`Invoice` indexes:

```text
{ order: 1 } unique
{ shop: 1, issuedAt: -1 }
{ customer: 1, issuedAt: -1 }
{ number: 1 } unique
```

`InvoiceTemplate` indexes:

```text
{ shop: 1 } unique
```

`InvoiceCounter` indexes:

```text
{ shop: 1 } unique
```

### 9.2 Existing model changes — recommended: none

Two options; pick one and record it:

- **Option A (recommended, minimal risk): no schema change to `Shop` or
  `Order`.** Invoice lookup is `Invoice.findOne({ order })`; template lookup is
  `InvoiceTemplate.findOne({ shop })`. Both are indexed. Order detail needs one
  small query when rendering the invoice control.
- **Option B: add `Shop.billingTemplate` / `Order.invoice` pointers.** Faster
  reads, but requires backfill/migration reasoning, touches locked models, and
  risks mass-assignment or stale pointers. Not recommended for the first
  implementation.

If Option B is chosen, both fields must be `default: null`, set only by the
invoice/template services, and excluded from any mass-assignment path.

### 9.3 Snapshot immutability guard

- Mongoose `pre("findOneAndUpdate")`, `pre("updateOne")`, `pre("save")` guards on
  `Invoice` that throw when protected paths change after creation.
- Test: attempt to change `number`, `snapshot.totals.payablePaise`,
  `templateVersionId` — all rejected.

### 9.4 No migrations required

New collections start empty; no existing document is modified. If Option B is
chosen, documented default nulls require no backfill.

---

## 10. Roboto font assets

```text
assets/fonts/Roboto/Roboto-Regular.ttf   Apache 2.0
assets/fonts/Roboto/Roboto-Medium.ttf    Apache 2.0
assets/fonts/Roboto/Roboto-Bold.ttf      Apache 2.0
assets/fonts/Roboto/LICENSE.txt          full licence text
assets/fonts/Roboto/NOTICE.md            source, version, sha256, licence
```

- The repository already carries font licensing precedent
  (`1001fonts-transcity-eula.txt`, `public/fonts/Transcity-DEMO.otf`), but that
  font is not suitable (licence/coverage) for invoices. Bundle Roboto
  separately.
- Do not place invoice fonts in `public/fonts/` unless the browser genuinely
  needs them (it does not).
- A test asserts each file exists, is a valid TTF, contains `₹`, and matches the
  sha256 in `NOTICE.md`.
- Total added repository size ~1.5 MB (three weights). Acceptable; note it in the
  final report.

---

## 11. Dependency additions

| Package | Version policy | Where used | Notes |
|---|---|---|---|
| `pdf-lib` | pin a current stable 1.x release | server | load/save/draw/embed |
| `@pdf-lib/fontkit` | matching release | server | registerFontkit for Roboto |
| `pdfjs-dist` | pin to one version, exact match API/worker | browser only | preview + coordinate capture |

Procedure (during implementation, not now):

1. `npm install pdf-lib @pdf-lib/fontkit pdfjs-dist` (updates
   `package.json` + `package-lock.json`).
2. Add a `build-scripts/vendor-pdfjs.js` that copies the worker into
   `public/vendor/pdfjs/`, mirroring `build-scripts/vendor-liquidgl.js`, and wire
   it into the existing `postinstall`/`build` scripts.
3. Record installed versions and the worker filename in the final report.
4. Confirm no conflict with Express 5 / Node version in use, and that
   `pdfjs-dist` does not pull in a browser-only polyfill that breaks the server
   build (never import it server-side).

`package.json` currently has no PDF dependency; adding these three is the only
dependency change this feature needs. Do not add a PDF-to-image rasterizer, an
OCR library, a template engine, or a queue.

---

## 12. Proposed routes

All PROPOSED; names follow existing `/vendor/...` and `/orders/...` conventions.
Verify against live routes before registering (avoid collisions with
`/vendor/orders/:id` and `/vendor/menu/:id`).

### 12.1 Vendor

| Method | Path | Purpose | Middleware |
|---|---|---|---|
| POST | `/vendor/menu/billing-template/upload` | upload PDF, create version | requireDb, requireAuth, requireVendor, requireVendorShop, `handleBillingTemplateUpload` |
| GET | `/vendor/menu/billing-template` | configuration page (PDF.js) | same minus upload |
| GET | `/vendor/menu/billing-template/file` | stream template PDF (`?version=` optional) | same |
| POST | `/vendor/menu/billing-template/mapping` | save field mapping for a version | same |
| POST | `/vendor/menu/billing-template/sample` | render sample with current mapping | same |
| GET | `/vendor/menu/billing-template/sample.pdf` | stream latest sample | same |
| POST | `/vendor/menu/billing-template/activate` | activate version | same |
| POST | `/vendor/menu/billing-template/remove` | deactivate template | same |

Route-ordering caution: `/vendor/menu/billing-template` must be registered
**before** any `/vendor/menu/:id` pattern that could capture it, or the paths
must not overlap at all. The existing `PATCH`/`DELETE` `/vendor/menu/:id` are
different methods, but a future `GET /vendor/menu/:id` would collide. Verify
with a test.

### 12.2 Student and vendor invoice access

| Method | Path | Purpose | Middleware |
|---|---|---|---|
| GET | `/orders/:id/invoice` | student downloads own **custom** invoice (ensures issuance); returns the default-bill explanation when the shop has no active template | requireDb, requireAuth, requireStudent |
| GET | `/vendor/orders/:id/invoice` | vendor views an issued invoice for own shop | requireDb, requireAuth, requireVendor, requireVendorShop |

Register `/orders/:id/invoice` in `routes/orders.js` alongside the existing
`/orders/:id` handler. Express 5 matches the more specific path first when
registered before a catch-all, but since `/orders/:id` is a distinct path with no
trailing segment, both can coexist; verify by test.

Do not create a new top-level router file unless the vendor route file becomes
unmanageable; if a helper module is preferred, mount it from `server.js` with the
same conventions.

### 12.3 Response contract

- Vendor form routes: flash + 302 redirect (existing pattern).
- JSON (mapping/sample/upload when requested via fetch):
  `{ ok: true, ... }` / `{ ok: false, error: "<message>", reason: "<code>" }`
  with 400/403/404/409/500 as appropriate.
- PDF routes: binary stream with the headers in §3.
- Never return JSON for a browser form POST: use the best-match
  `req.accepts(["json","html"]) === "json"` pattern from
  `POST /vendor/verify-qr`, **not** the `req.accepts("json")` truthiness pattern
  used in `POST /vendor/verify` (verified existing inconsistency).

---

## 13. Decisions requiring verification before implementation proceeds

| # | Must be verified | How | If it fails |
|---|---|---|---|
| V1 | `pdf-lib` drawing-coordinate origin for pages with non-zero MediaBox/CropBox | unit test with a crafted fixture; inspect output coordinates | reject non-zero-origin templates |
| V2 | `pdfjs-dist` `viewport.convertToPdfPoint` availability and rotation handling for the pinned version | browser test with an unrotated fixture; assert round-trip | implement the equivalent transform matrix explicitly and document it |
| V3 | Roboto `₹` coverage and subset behavior | fontkit glyph test + render test (both subset modes) | ship `subset: false`, document |
| V4 | Cloudinary raw/private PDF delivery | not needed if local storage is used | keep local storage; DECISION-3 |
| V5 | Memory usage of a 10 MB upload + render in the process | measure during Phase 5 | cap to one in-flight render per order; document |
| V6 | Whether any queue/background worker exists to reuse | search repo | fire-and-forget + lazy ensure |
| V7 | Whether `.gitignore` already excludes a storage folder | read `.gitignore` | add `storage/` (application config change allowed during implementation) |
| V8 | Whether the `pdfjs-dist` worker filename matches the build script copy | build + browser smoke test | fix copy path before Phase 2 exit |

Each verification is recorded in `.ai/STATUS.md` with the exact command and
observed output.
