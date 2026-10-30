# 04 — PDF Template Engine (PROPOSED, core technical contract)

This is the most important document in the package. Read all of it before
writing rendering code.

Locked inputs: `00_PRODUCT_CONTRACT.md` §§2–6. Verified environment:
`01_CODEBASE_AUDIT.md` §§1, 9. Storage/security: `06_...md`. Data that feeds the
renderer: `05_INVOICE_DATA_AND_GENERATION.md`.

All APIs, dependency versions and platform behaviours below marked
**VERIFY-AT-BUILD** must be confirmed against the installed packages and with a
test before being relied on.

---

## 1. Original PDF preservation

The template PDF is a **read-only source document**.

Rules:

1. Bytes are written once, at version creation, to private storage keyed by
   `shopId / templateId / version / sha256`.
2. Generation always starts from those stored bytes. It never reads a
   previously generated invoice, never reads the vendor's original upload from a
   request, and never re-saves over the template key.
3. `PDFDocument.load()` is called on a fresh copy (Buffer) each time. Do not
   cache a mutated `PDFDocument` object across generations.
4. The rendered output is saved to a **different** key namespace
   (`invoices/...`) and its sha256 is recorded.
5. Any operation that would write bytes to a template key is a bug. Add a guard
   in the storage adapter (for example, a function that only accepts an
   `invoices/` prefix for writes after version creation).
6. The template's metadata (Title/Author) must not be silently rewritten.
   `PDFDocument.load(bytes, { updateMetadata: false })` is the proposed option.

Verification: a test that renders two invoices from one template and asserts the
stored template sha256 is unchanged before and after.

---

## 2. Rendering dependency pipeline

```text
template bytes (private storage)
  → pdf-lib PDFDocument.load
  → registerFontkit(pdfDoc)  [@pdf-lib/fontkit]
  → embedFont(Roboto-Regular.ttf, { subset: false })
  → embedFont(Roboto-Medium.ttf,  { subset: false })
  → embedFont(Roboto-Bold.ttf,    { subset: false })
  → draw dynamic text / item rows / continuation pages
  → pdfDoc.save({ useObjectStreams: true })
  → Buffer → private storage → Invoice record
```

- `subset: false` is **required**. Subsetting a font is where `₹` and other
  non-Latin glyphs are most often lost, and invoices are small documents where
  the size cost is irrelevant. (VERIFY-AT-BUILD: confirm the installed
  `pdf-lib`/`@pdf-lib/fontkit` combination preserves U+20B9 with the chosen
  subset setting; test both ways and record the result.)
- Embedding must be done once per `PDFDocument`, not per field.
- Fonts are loaded from the repository's bundled assets, never from a request,
  a CDN, or the filesystem path supplied by a user.

---

## 3. PDF.js preview

Purpose: show the vendor their own PDF and capture field positions.

- `pdfjs-dist` is loaded in the browser only. Do not import it in server code
  (its Node build differs and adds unnecessary weight).
- Version must be pinned in `package.json` and matched between the API module
  and the worker file. Mismatched worker versions fail at runtime.
- The worker must be served from this origin (no CDN, CSP and offline-safety
  reasons): copy `pdfjs-dist/build/pdf.worker.min.mjs` into
  `public/vendor/pdfjs/` via the existing `build-scripts/` convention (there is
  already `build-scripts/generate-version.js` and
  `build-scripts/vendor-liquidgl.js`). Do not hand-edit `public/`.
- The PDF bytes are fetched from an authenticated vendor-only stream route. The
  browser must never receive a storage path, a signed public URL, or the raw
  file name as a path.
- `pdfjsLib.getDocument({ data, isEvalSupported: false })` with an explicit
  `workerSrc`.
- Render each page to a canvas with
  `page.getViewport({ scale })` where `scale` is derived from the container
  width; keep the numeric scale so conversions are exact.
- Preview must handle multi-page PDFs, page zoom, and re-render on resize
  (debounced). It must clean up destroyed page/canvas state when the editor
  closes.

Preview is **display + coordinate capture only**. It must not attempt to
re-layout, re-style or replace the vendor's PDF.

---

## 4. Coordinate mapping (the part that must be exact)

### 4.1 Two coordinate systems

| System | Origin | Y direction | Units |
|---|---|---|---|
| PDF user space (what `pdf-lib` draws in) | bottom-left of the page | up | points (1/72 in) |
| PDF.js viewport (what the browser canvas shows) | top-left of the rendered page | down | CSS px at the chosen `scale` |

A point captured from a mouse event is in CSS pixels relative to the canvas
element. It must be converted **twice**: CSS/canvas → viewport → PDF user space.

### 4.2 Conversion

```js
// Browser, after render
const viewport = page.getViewport({ scale });
// canvasPoint: {x, y} in CSS px relative to the canvas top-left
// If the canvas is CSS-scaled (devicePixelRatio or fit-to-container CSS),
// normalize to viewport units first:
const vx = canvasPoint.x * (viewport.width  / canvas.clientWidth);
const vy = canvasPoint.y * (viewport.height / canvas.clientHeight);

const [px, py] = viewport.convertToPdfPoint(vx, vy);   // PDF user space point
```

`viewport.convertToPdfPoint()` is the authoritative transformation: it accounts
for page dimensions, scale and rotation. **Do not hand-roll `pageHeight - y`
arithmetic** — that is only correct for unrotated pages at scale 1 and is the
most common source of misplacement.

**VERIFY-AT-BUILD:** confirm `convertToPdfPoint` behavior for the pinned
`pdfjs-dist` version (it exists on `PageViewport` in current v3/v4 releases).
If the installed version lacks it, use `viewport.transform` inversion and
document the exact matrix used.

### 4.3 What is stored

Store **PDF user-space coordinates only**:

```json
{
  "schemaVersion": 1,
  "page": 0,
  "fields": {
    "invoiceNumber": { "x": 402.5, "y": 690.25, "align": "left", "fontSize": 10, "font": "regular", "maxWidth": 150 }
  },
  "itemTable": {
    "originX": 48, "originY": 520,
    "rowHeight": 16, "maxRowsFirstPage": 12,
    "baselineOffsetFromRowTop": 11,
    "columns": [
      { "key": "description", "x": 48,  "width": 200, "align": "left",   "fontSize": 9 },
      { "key": "quantity",    "x": 258, "width": 40,  "align": "center", "fontSize": 9 }
    ]
  }
}
```

Never store viewport pixels, canvas CSS pixels, device-pixel-ratio-scaled values,
zoom levels, or container widths.

### 4.4 Anchoring and baselines

- `x` is interpreted according to `align`: left edge (left), center (center),
  right edge (right). For centered/right text the renderer computes the start
  x from measured text width so the *anchor* stays fixed between invoices.
- `y` is the **text baseline** in PDF user space. The editor displays a thin
  baseline guide when a field is placed so the vendor positions the baseline,
  not an approximate box centre. This removes vertical drift between preview and
  output.
- Multi-line fields store `lineHeight` (points). Additional lines are drawn at
  `y - n * lineHeight`.
- Item-row baselines: `rowBaseline = rowTopY - baselineOffsetFromRowTop`, where
  `baselineOffsetFromRowTop` is an explicit configured number (default
  `round(fontSize * 1.2)`) and is editable during configuration. No hidden magic
  constants in the renderer.

### 4.5 Rotation and page geometry

- **Rotated pages (`/Rotate != 0`) are not supported for activation.** Upload
  validation must detect page rotation and reject the template with a clear
  vendor message. Rationale: `pdf-lib` drawing coordinates are not rotated with
  the page, while PDF.js displays the rotated view; silently "fixing" this
  produces invoices that look correct in the browser and wrong in print.
- Page rotation may be supported later only with a documented transform and a
  dedicated test matrix. Do not add it ad hoc.
- **VERIFY-AT-BUILD:** for pages whose `MediaBox`/`CropBox` origin is not
  `(0,0)`, confirm whether `pdf-lib` drawing coordinates are relative to the
  MediaBox origin or to the page's user-space origin. Until a test proves the
  behavior, reject non-zero-origin templates at upload
  (reason: `unsupported_page_origin`), or normalize by translating content in a
  dedicated, tested step.
- Page sizes accepted: width and height each between 200 and 2000 points.

### 4.6 Rounding

Round stored coordinates to 3 decimals (sub-milli-point precision) to avoid
float noise in mapping hashes. Store as numbers, not strings.

---

## 5. Dynamic text insertion

- Fields are rendered in a fixed order to keep output deterministic:
  1. invoice number, invoice date
  2. customer name, customer details
  3. item table (may add continuation pages)
  4. subtotal, discount, parcel charge, CGST, SGST
  5. final total, amount in words
  6. payment reference / notes / constant seller text
- Every value is a **string produced by `invoice-data.js`**; the renderer does
  not format money, dates or numbers itself (single formatter, testable once).
- `page.drawText(value, { x, y, size, font, color, maxWidth?, lineHeight? })`.
  Use the library's `maxWidth`/`lineHeight` wrapping only where it matches the
  specification's wrapping rules; otherwise wrap explicitly (§8).
- Colour: default ink is near-black (`rgb(0.06, 0.06, 0.06)`), configurable per
  field within an approved set (ink / muted grey). No arbitrary colour picker.
- Do not draw backgrounds, boxes, lines, or white patches behind dynamic text.
  The template supplies the design.
- Text must never be drawn outside the page bounds; the renderer clamps or
  fails (see §9).

---

## 6. Roboto font embedding

Assets (PROPOSED paths):

```text
assets/fonts/Roboto/Roboto-Regular.ttf
assets/fonts/Roboto/Roboto-Medium.ttf
assets/fonts/Roboto/Roboto-Bold.ttf
assets/fonts/Roboto/LICENSE.txt      (Apache License 2.0 text)
assets/fonts/Roboto/NOTICE.md        (source URL, version, sha256, licence)
```

Rules:

- Files are committed to the repository. No runtime download, no vendor upload,
  no CDN reference.
- SHA-256 of each file is recorded in `NOTICE.md` and asserted by a test, so a
  swapped or truncated font file fails CI.
- Load with `fs.readFile` (or `readFileSync`) from `assets/fonts/Roboto/`, not
  from `public/` (fonts do not need to be web-served; the browser does not render
  invoice text).
- Register once per `PDFDocument`:
  `pdfDoc.registerFontkit(fontkit)` then
  `await pdfDoc.embedFont(bytes, { subset: false })`.
- Roboto licence (Apache 2.0) must be included; do not ship a font whose licence
  forbids redistribution.
- Font map: `regular`, `medium`, `bold` → the three files. Missing file → throw
  a named error (`FONT_ASSET_MISSING`) that fails invoice generation closed and
  is logged.

### 6.1 Rupee symbol support

- `₹` is U+20B9. It cannot be rendered with the standard 14 PDF fonts
  (WinAnsi/StandardEncoding), which is exactly why Roboto must be embedded.
- A unit test must prove glyph coverage:
  `fontkit.create(fontBuffer).hasGlyphForCodePoint(0x20B9) === true` for all
  three files (VERIFY-AT-BUILD: adjust to the installed fontkit API).
- A rendering test must draw `₹ 1,234.50`, re-load the produced PDF, and assert
  the text can be extracted/decoded without replacement characters and that the
  embedded font is a subset of Roboto (not Helvetica). If text extraction is
  unreliable, assert the produced PDF contains an embedded font descriptor and
  no `Helvetica` reference for dynamic fields, and verify visually once with a
  maintainer-approved snapshot.
- Money formatting: Indian grouping (`1,23,456.78`) via
  `Number.prototype.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`.
  The `₹` character is prepended by the formatter, and the same formatter is
  used for every money field.

---

## 7. Font sizes and alignment

| Element | Allowed range | Default |
|---|---|---|
| Invoice number / date | 8–16 pt | 10 |
| Customer block | 8–14 pt | 10 |
| Item description | 7–12 pt | 9 |
| Quantity / rate / amount | 7–12 pt | 9 |
| Totals block | 8–16 pt | 10 |
| Final total | 9–20 pt | 11 (bold) |
| Amount in words | 7–12 pt | 9 (italic is not available; use regular) |

- Alignment: `left | center | right` per field and per column.
- Numeric columns should default to `right`; quantity to `center`.
- Font weight per field: `regular` default, `bold` for final total and invoice
  number, `medium` for section labels/seller constants.
- Sizes are integers or half-points; reject `NaN`, `< 6`, `> 24` at validation.
- Do not auto-shrink text to fit except for the explicit item-cell truncation
  rule (§8). Shrinking totals changes visual hierarchy and is hard to audit.

---

## 8. Dynamic item table

### 8.1 Row model

For each billable line (from the frozen snapshot):

| Column | Value source |
|---|---|
| `description` | `order.items[i].name`, plus variant label when `variantName` is set (for example `Veg Burger (Large)`), plus a short adjustment marker for removed lines only if the vendor enables a "show removed" note (default: removed lines are excluded from the table and summarised in metadata) |
| `quantity` | `item.quantity` |
| `unitRate` | `item.price` formatted as money |
| `lineAmount` | `item.price × item.quantity` formatted as money, computed in integer paise then converted |

Additional optional columns (only if mapped): serial number, food type marker,
unit label.

### 8.2 Rendering

```text
rowTop = table.originY                      // PDF coords, top of first row
for each billable line i:
   if i < maxRowsFirstPage:  page = templatePage
   else:                     page = continuationPage(ceil((i - maxRowsFirstPage + 1) / rowsPerContinuationPage))
   rowTopOnPage = pageOriginYFor(page) - (i - rowsBeforeThisPage) * rowHeight
   baseline = rowTopOnPage - baselineOffsetFromRowTop
   for each column: drawCellText(...)
```

- Cells are drawn with the column's own `x`, `width`, `align`, `fontSize`.
- Cell text is wrapped to `width` using measured width
  (`font.widthOfTextAtSize(text, size)`), greedy word wrapping.
- Maximum 2 lines per description cell and 1 line for numeric cells by default
  (`maxLines` per column, configurable 1–3).
- Overflow behavior per cell: truncate with `…` (U+2026, verify glyph) at the
  last fitting word boundary. **Never** draw text outside the column width or
  into the next column.
- Row height is fixed (`rowHeight`); if a description needs more lines than fit,
  it is truncated, not expanded. Document this in the vendor UI: choose a row
  height that fits two-line descriptions if needed.
- No zebra striping, no drawn cell borders: the vendor's PDF supplies the table
  design. If the vendor's table has no ruling, that is their design choice.

### 8.3 Amount-in-words

- Computed from the persisted payable total by a deterministic Indian-numbering
  converter (`1234.50` → `One Thousand Two Hundred Thirty Four Rupees and Fifty
  Paise Only`).
- No floating point: convert to paise, split rupees/paise, format each part.
- Rendered with Roboto; wrapped to `maxWidth` with a 3-line cap; if it exceeds
  the cap, fail the render (do not silently truncate a legal amount).

---

## 9. Long text, overflow and clamping

- Text that exceeds its `maxWidth` wraps by words; a single word longer than the
  width is broken at the character level with an ellipsis on the last line.
- Any text whose computed lines exceed the field's `maxLines` (default 1, fields
  such as amount-in-words default 3) fails rendering with
  `reason: "text_overflow"` **unless** the field is explicitly configured with
  `truncate: true` (name/description style fields), in which case it truncates.
- Required money and total fields never truncate; they fail instead. A wrong
  total is worse than no invoice.
- Fields whose box falls outside the page after wrapping (for example a totals
  block below the media box) fail rendering with `reason: "out_of_bounds"`.
- All failures are recorded on the generation attempt and must not produce a
  stored invoice.

---

## 10. Continuation-page strategy

Item rows are the only dynamic content of unbounded length, so they define
overflow.

Rules:

1. Page 1 uses the template's mapped item table and `maxRowsFirstPage`
   (configured during field setup; derived from the vendor's table height).
2. When rows exceed `maxRowsFirstPage`, the renderer appends **blank**
   continuation pages with the same `width`/`height` as the template page that
   holds the item table. It does **not** copy the template's artwork: `pdf-lib`
   cannot clone arbitrary page content reliably, and inventing a background is
   worse than a clean page.
3. Each continuation page draws, in Roboto:
   - a header line: `Invoice <number> · <shop name> · Page <n>` and
     `Continued items`;
   - the same column headers the vendor mapped (if any) at the mapped
     continuation origin;
   - rows starting at `continuationOriginY` with the same `rowHeight`,
     `columns`, sizes and alignment.
4. `rowsPerContinuationPage` is computed from the available height between
   `continuationOriginY` and the page's bottom margin (configured
   `continuationBottomMargin`), never hard-coded per vendor.
5. Totals: the mapped totals fields live on the template page. If rows overflow,
   totals must be drawn on the **last** continuation page using a separately
   configured `continuationTotals` block (x/y anchors for subtotal, discount,
   parcel, CGST, SGST, final total, amount in words). If a template overflows
   and `continuationTotals` is not configured, rendering fails with
   `reason: "layout_overflow"` and the vendor must either increase
   `maxRowsFirstPage`, configure continuation totals, or accept smaller rows.
   This prevents "totals on page 1, items on page 3" invoices.
6. `Page <n>` numbering in the header is optional per version
   (`showPageNumbers`) and must be computed after layout, before drawing (two
   passes: measure, then draw).
7. Continuation pages carry no template branding. The vendor UI must state that
   invoices with more items than fit will include a plain continuation page.

Activation must require `continuationTotals` unless the vendor explicitly
confirms the one-page limit and `maxRowsFirstPage` is at least the vendor's
declared maximum items per order (default 1 unless changed). Simplest safe
default: require continuation totals whenever `maxRowsFirstPage` is below the
default max items (say 12).

---

## 11. Clean template requirements (and why sample text cannot be overwritten)

### 11.1 The rule

A template is **clean** when every field that will receive dynamic text is blank
in the supplied PDF (no sample customer, no sample items, no printed totals,
no sample invoice number, no sample date).

**Only a clean template may be activated.**

### 11.2 Why drawing new text cannot replace printed sample text

The uploaded PDF's sample values are part of its page content stream:

- Drawing text adds to the stream; it does not remove anything already drawn.
- Both values remain in the file. Copying text, searching, screen readers,
  accessibility tools and many print preflight tools still see the old value.
- Covering the old value requires drawing an opaque rectangle. That rectangle:
  - hides whatever is behind it — gradients, watermark patterns, borders, table
    rules, subtle paper textures, and the vendor's own background images;
  - leaves visible seams at edges (anti-aliasing, overprint, colour conversion);
  - breaks if the PDF uses transparency groups, blend modes or images under the
    text;
  - looks obviously patched when printed;
  - must be re-measured for every sample value (variable text width), so a
    partially covered value stays visible.
- If the PDF is flattened to an image and repainted, the design quality drops
  and the result is no longer the vendor's vector design (and the locked
  architecture forbids that pipeline).
- Even a "perfect" white box is not durable: re-saving through different PDF
  writers, printing with different colour profiles, or extracting content can
  reveal or retain the hidden text.

Therefore masking is **not** the default, not automatic, and not part of this
feature's initial scope (DECISION-4). A new clean master PDF is the supported
path.

### 11.3 Vendor-facing enforcement

- Upload page states the requirement before the file picker.
- Activation page repeats it and requires a confirmation checkbox:
  "This PDF has empty customer, item, quantity, price and total areas."
- The system does **not** claim to detect printed values. No OCR, no image
  analysis, no "we found sample data" promise.
- If the vendor uploads a PDF with printed values, invoices will visibly show
  both values. Support documentation must say this explicitly rather than
  implying the system fixes it.
- Optional (PROPOSED, not required): a static guidance panel showing a
  side-by-side "clean vs. not clean" illustration, not a detector.

---

## 12. Unsupported and encrypted PDFs

Upload validation must reject, with named reasons:

| Condition | Reason code | Detection |
|---|---|---|
| Encrypted / password-protected | `encrypted_pdf` | `PDFDocument.load(..., { ignoreEncryption: false })` throws; catch and reject |
| Malformed / not a PDF | `invalid_pdf` | `%PDF-` header missing or load throws otherwise |
| Too large | `file_too_large` | byte size > 10 MB |
| Too many pages | `too_many_pages` | page count > configured max (default 10) |
| Rotated page | `rotated_page` | `page.getRotation().angle !== 0` |
| Non-zero page origin | `unsupported_page_origin` | MediaBox/CropBox lower-left ≠ 0 (until VERIFY-AT-BUILD proves otherwise) |
| Page size out of range | `unsupported_page_size` | width/height outside 200–2000 pt |
| Non-PDF embedded content that breaks saving | `unsupported_pdf` | `save()` throws during validation round-trip |

Validation strategy (important): after parsing, run a **round-trip save**
(`await pdfDoc.save()`) during upload validation. Some PDFs parse but cannot be
saved by the library (unsupported filters/features). Catching that at upload is
far better than failing after a customer has collected an order.

Never trust an extension or a browser-declared MIME type alone: inspect the
first bytes for `%PDF-` (allow leading whitespace/BOM within the first 1024
bytes) and then parse.

---

## 13. Sample invoice preview

- Rendered by the **same** generator function as real invoices, with
  `mode: "sample"`.
- Input: synthetic snapshot with a fixed sample customer, 2–3 lines, a discount,
  a parcel charge, plausible totals, and `invoiceNumber: "SAMPLE"`.
- The sample must not allocate an invoice number, must not create an `Invoice`
  record, and must not touch counters.
- Served to the vendor with `Cache-Control: private, no-store` and a filename
  like `sample-invoice.pdf`.
- Stored (if cached at all) under a preview key that includes the mapping hash,
  and invalidated when the mapping changes. Never stored in the invoice
  namespace.
- The sample must be generated after the vendor's last mapping change before
  activation; the server records `lastPreviewMappingHash` and compares it with
  the current mapping hash at activation time.

---

## 14. Template versioning and mapping association

- `InvoiceTemplate` holds versions; each version owns exactly one
  `originalFileKey`, `sha256`, `pageCount`, `pageSizes`, and one `mapping`.
- `mappingHash = sha256(canonicalJson(mapping))`; canonicalization = sorted keys,
  fixed number formatting (3 decimals), stable array order.
- `Invoice` stores `templateVersionId`, `templateSha256`, `mappingHash`,
  `rendererVersion` (a constant bumped when rendering behavior changes) and the
  snapshot. This makes every issued invoice reproducible and auditable even
  after the vendor replaces the template.
- A mapping is mutable only while the version is not active. Activation freezes
  it: any change requires a new version (new upload) or an explicit
  "reconfigure" operation that creates a new version referencing the same
  original bytes. The default rule is: **active version ⇒ frozen mapping.**
- Replacing the PDF creates a new version with an empty mapping. Coordinate
  reuse across different PDFs is forbidden (page geometry and design differ).
- Historical invoices remain readable without the vendor's current template: the
  stored generated PDF is the artifact of record, and the snapshot plus version
  bytes (retained) allow re-render if ever required.

---

## 15. Renderer determinism and limits

- Same snapshot + same version + same fonts ⇒ byte-identical output (modulo
  PDF document IDs and creation dates). If the library embeds a timestamp/ID,
  take the checksum over a normalized comparison or record both checksums;
  documented choice required in the phase evidence.
- Hard limits enforced by the renderer: max 200 item lines (invoice would be
  unreasonable), max 20 output pages, max 25 MB output PDF. Exceeding any limit
  fails closed with a recorded reason.
- Timeout: rendering must complete within a bounded time for one order;
  document the measured value from testing rather than guessing.
- The renderer must be usable from a unit test with a fixture template and no
  database.

---

## 16. Rendering acceptance checklist (per invoice)

1. Template sha256 unchanged.
2. Output PDF parses with `pdf-lib` and page count ≥ template page count.
3. Invoice number, date, customer, every billable item, subtotal, discount,
   parcel charge, total and amount-in-words are present in the output.
4. All dynamic text uses the embedded Roboto fonts (no Helvetica/standard font
   reference for those fields).
5. `₹` renders (glyph test + one visual check).
6. No dynamic text is drawn outside the page or overlapping another dynamic
   field beyond the mapped layout.
7. Totals reconcile to the snapshot's `payablePaise`.
8. Overflow case: 30-item order produces continuation pages with repeated
   columns and totals on the last page.
9. Long-name case: a 120-character item name is truncated/wrapped exactly per
   §8.2 without crossing its column.
10. Missing font / corrupt template fails closed with a named reason and no
    stored invoice.
