# FlashFoods Custom Billing Template — Documentation Package

**Status:** SPECIFICATION ONLY. Nothing in this package is implemented.
**Feature ID used by this package:** `F10` (PROPOSED — not yet recorded in `.ai/goal.md`)
**Repository inspected:** FlashFoods `main`, working tree as of 2026-10-30
**Audience:** the coding agent that will implement the feature, and the humans reviewing that work.

---

## 1. Purpose

This package is the authoritative, implementation-ready specification for the
**Custom Billing Template System**: a vendor-managed PDF invoice overlay system.

A vendor uploads their own existing invoice PDF. FlashFoods keeps that PDF as the
page background and draws order-specific values (invoice number, date, customer,
item rows, totals, amount in words) on top of it with `pdf-lib`, producing a new
per-order PDF invoice.

This documentation exists because the feature has several hard constraints that
are easy to get wrong (PDF coordinate systems, font embedding, payment
eligibility, idempotent invoice issuance, immutable snapshots). It converts them
into phases, acceptance criteria and tests that can be executed without
re-litigating product decisions.

**Creating this documentation does not implement the feature.** No model, route,
middleware, view, stylesheet, script, dependency or configuration in this
repository was created or modified while producing these files. Every phase in
`08_IMPLEMENTATION_PHASES.md` is `PENDING`.

---

## 2. File index

| File | Contents | Read when |
|---|---|---|
| `README.md` | This file: purpose, index, reading order, status rules. | First. |
| `TRIGGER_PROMPT.md` | Ready-to-use implementation trigger prompt. | Before starting implementation. |
| `00_PRODUCT_CONTRACT.md` | All locked product decisions, non-goals, forbidden approaches, eligibility policy, open decisions. | Before any design work. |
| `01_CODEBASE_AUDIT.md` | Verified description of the existing application: stack, models, routes, middleware, views, order lifecycle, money math, storage, tests, and the gaps this feature must fill. | Before touching code. |
| `02_SYSTEM_ARCHITECTURE.md` | Component architecture, upload/configuration/generation/download flows, versioning, and the default-bill fallback. Mermaid diagrams. | Before designing modules. |
| `03_VENDOR_UPLOAD_WORKFLOW.md` | Exact vendor-facing experience in Manage Menu: states, cards, preview, activation, replacement, removal, errors, mobile. | Phase 1–2 UI work. |
| `04_PDF_TEMPLATE_ENGINE.md` | The core technical contract: coordinates, PDF.js ↔ PDF conversion, Roboto embedding, table rendering, overflow, clean-template requirement, versioning. | Phase 2 work; read fully before writing any rendering code. |
| `05_INVOICE_DATA_AND_GENERATION.md` | Invoice data contract, field-by-field mapping from persisted `Order`/`Shop`/`User`, money reconciliation, payment eligibility, numbering, idempotency, snapshots, refunds/adjustments. | Phase 3 work. |
| `06_STORAGE_SECURITY_AND_INTEGRATION.md` | Upload validation, private storage, access control, proposed routes, schema changes, font assets, dependency additions, decisions needing verification. | Phase 1, 3 and 4 work. |
| `07_TESTING_AND_ACCEPTANCE.md` | Unit/integration/security/rendering/Playwright acceptance matrix and evidence rules. | Phase 5 and every phase gate. |
| `08_IMPLEMENTATION_PHASES.md` | Dependency-ordered phases, files, work units, acceptance criteria, tests, blocking conditions. | Throughout execution. |

---

## 3. Required reading order

1. `00_PRODUCT_CONTRACT.md` — the locked "what" and the forbidden "how".
2. `01_CODEBASE_AUDIT.md` — the verified "what exists today".
3. `02_SYSTEM_ARCHITECTURE.md` — the component boundaries.
4. `04_PDF_TEMPLATE_ENGINE.md` — the rendering contract.
5. `05_INVOICE_DATA_AND_GENERATION.md` — the data and issuance contract.
6. `03_VENDOR_UPLOAD_WORKFLOW.md` — the vendor UX.
7. `06_STORAGE_SECURITY_AND_INTEGRATION.md` — storage, security, routes, dependencies.
8. `08_IMPLEMENTATION_PHASES.md` — the execution plan.
9. `07_TESTING_AND_ACCEPTANCE.md` — how each phase is proven.
10. `TRIGGER_PROMPT.md` — the prompt that starts execution.

Repository engineering instructions that also apply, in the precedence defined by
`.ai/ORCHESTRATOR.md` §9 and `.ai/rules.md` §15:

- `.ai/rules.md` (mandatory engineering constraints; note §14: no Git operations)
- `.ai/BUSINESS_RULES.md` (order lifecycle, payment, refund, pickup invariants)
- `.ai/ARCHITECTURE.md`, `.ai/DEPENDENCY_GRAPH.md`, `.ai/COMMON_PATTERNS.md`
- `.ai/STATUS.md` (execution checkpoint), `.ai/test.md` (test safety gates)
- `.ai/UI_STANDARD.md` (student/vendor UI conventions; desktop-frozen policy)

---

## 4. Authoritative status of the locked requirements

The following are **locked**. An implementing agent may not change them, soften
them, or replace them with an alternative architecture:

- PDF **overlay** on the vendor's original PDF. Not HTML/CSS recreation, not a
  design editor, not a PDF-to-new-layout converter.
- Roboto (Regular, Medium, Bold) is the only font for dynamically inserted text,
  bundled with the application, embedded via `@pdf-lib/fontkit`, and it must
  render `₹` (U+20B9). No vendor font uploads.
- Vendors upload one PDF (10 MB limit) and configure field positions once per
  template version. Positions are saved in PDF-native coordinates.
- `pdf-lib` + `@pdf-lib/fontkit` for rendering, `pdfjs-dist` for preview and
  coordinate capture.
- A **clean master PDF** is required for reliable activation. Printed sample
  values in a supplied example must not be "overwritten" by drawing white boxes.
- Invoices are issued only for eligible paid orders after successful collection,
  exactly once, with an immutable snapshot and no duplicate invoice numbers.
- The existing FlashFoods default order bill in `views/orders/show.ejs` remains
  the billing experience for shops without an active custom template. No generic
  FlashFoods PDF invoice or receipt is generated; a custom PDF is additive only
  when a template is active and the order is eligible.
- Existing order, payment, pickup, vendor-menu, student and admin behavior must
  not regress.

Everything else in this package that is not in the list above is marked
**PROPOSED** or **UNVERIFIED** and may be adjusted by the implementing agent when
live code evidence contradicts it — with the discrepancy recorded.

---

## 5. How to invoke the trigger prompt

Paste the contents of `TRIGGER_PROMPT.md` (section "TRIGGER PROMPT TEXT") as the
single instruction to the coding agent. It is self-contained: it tells the agent
to read every file here, read the `.ai/` instructions, re-inspect the live
source, reconcile documentation against code, and implement phase by phase with
recorded evidence.

It intentionally does **not** authorize the agent to implement anything while
documentation creation is the active task.

---

## 6. Warning

> **Creating or reading this documentation package does not implement the
> feature, and must never be reported as implementation, partial
> implementation, or verified behavior.**
>
> All ten-plus documents describe a target state. The application currently has
> no PDF dependency, no invoice model, no billing UI, no invoice route and no
> invoice test. Claims that "the documentation is complete" are not claims that
> the feature works. Evidence of implementation exists only as executed commands
> and observed results recorded in `.ai/STATUS.md` and in an implementation
> report.

---

## 7. Terminology (used consistently in every file)

| Term | Meaning |
|---|---|
| **Template PDF** | The original vendor-uploaded PDF. Never modified. |
| **Template Version** | One immutable uploaded revision of a Template PDF plus its Field Mapping. |
| **Field Mapping** | Saved coordinates/format for dynamic fields, bound to one Template Version. |
| **Activation** | The vendor-approved state in which a Template Version may issue invoices. |
| **Overlay** | Drawing dynamic values on top of the unmodified Template PDF pages. |
| **Generated Invoice PDF** | The per-order output PDF bytes stored after issuance. |
| **Invoice Snapshot** | The immutable JSON record of every value used to render one invoice. |
| **Invoice Record** | The persisted invoice document linking order, shop, template version, snapshot, number and stored PDF. |
| **Continuation Page** | An appended blank page used when item rows exceed page 1 capacity. |
| **Eligible order** | A `completed` order that also passes the payment-eligibility rules in `00_PRODUCT_CONTRACT.md` §7. |
| **Sample Preview** | A non-authoritative render using synthetic data to validate the mapping. |
| **Default order bill** | The existing FlashFoods order-detail billing view in `views/orders/show.ejs`. It is the fallback for every shop without an active custom template, and it is never replaced by a PDF. |

---

## 8. Known documentation inconsistency

PART 6 of the source task enumerates **eleven** files (README, TRIGGER_PROMPT,
and `00`–`08`) but PART 8 says "verify that all 10 files exist". This package
follows the explicit file list: eleven files. The implementing agent should
expect eleven.
