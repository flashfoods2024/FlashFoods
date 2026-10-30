# Implementation Trigger Prompt

This file contains the ready-to-use prompt for the implementation execution.
It is **not** an instruction to implement while documentation creation is the
active task.

---

## How to use

1. Confirm the documentation package in `billing-template/` is complete.
2. Start a fresh implementation session in the FlashFoods repository.
3. Send the entire text inside the fenced block below as the single instruction.
4. Do not send additional "continue" prompts: the prompt delegates phase
   selection and advancement to the agent, following `.ai/ORCHESTRATOR.md`.

---

## TRIGGER PROMPT TEXT

```text
Execute the FlashFoods Custom Billing Template System (F10) as specified in
billing-template/.

MISSION STATEMENT (locked, repeat it back in your first progress update):
Implement the custom PDF overlay billing system. Do not recreate vendor invoices
using HTML/CSS. Do not build an invoice designer. Use Roboto for all dynamic
text. Preserve the original vendor PDF design.

0. SCOPE OF AUTHORITY
   - This prompt authorizes application code changes required by the phases in
     billing-template/08_IMPLEMENTATION_PHASES.md.
   - It does not authorize: production deploys, git operations (.ai/rules.md
     §14 forbids them), destructive data operations, changes to the F09 contract
     in .ai/goal.md, or any redesign of the existing order/payment/pickup flows.
   - It does not authorize implementing an HTML/CSS invoice renderer, a
     drag-and-drop design editor, a vendor font upload, an automatic PDF field
     detector, or a white-box masking default.
   - It does not authorize replacing, hiding or restyling the existing default
     order bill in views/orders/show.ejs, or generating any generic FlashFoods
     PDF invoice/receipt for shops without an active custom template. That
     existing bill is the locked fallback.

1. READ THE DOCUMENTATION
   Read every Markdown file in billing-template/, in this order:
   README.md, 00_PRODUCT_CONTRACT.md, 01_CODEBASE_AUDIT.md,
   02_SYSTEM_ARCHITECTURE.md, 04_PDF_TEMPLATE_ENGINE.md,
   05_INVOICE_DATA_AND_GENERATION.md, 03_VENDOR_UPLOAD_WORKFLOW.md,
   06_STORAGE_SECURITY_AND_INTEGRATION.md, 08_IMPLEMENTATION_PHASES.md,
   07_TESTING_AND_ACCEPTANCE.md.
   Do not skim 04_PDF_TEMPLATE_ENGINE.md or 05_INVOICE_DATA_AND_GENERATION.md.

2. READ THE ENGINEERING INSTRUCTIONS
   Read .ai/ORCHESTRATOR.md, .ai/rules.md, .ai/BUSINESS_RULES.md,
   .ai/ARCHITECTURE.md, .ai/DEPENDENCY_GRAPH.md, .ai/COMMON_PATTERNS.md,
   .ai/STATUS.md, .ai/test.md, .ai/UI_STANDARD.md, .ai/VALIDATION_CHECKLIST.md.
   Note: .ai/goal.md currently holds the F09 contract. Do not overwrite or
   reinterpret it. For this feature the locked contract is
   billing-template/00_PRODUCT_CONTRACT.md; it takes precedence for F10 scope
   only and does not modify F09.

3. RE-INSPECT THE LIVE SOURCE (MANDATORY, BEFORE ANY EDIT)
   Verify the current contents of at least:
   models/Shop.js, models/Order.js, models/User.js, models/MenuItem.js,
   routes/vendor.js, routes/orders.js, routes/webhooks.js, routes/admin.js,
   views/vendor/menu.ejs, views/partials/menu-manager.ejs,
   views/orders/show.ejs, views/orders/index.ejs,
   middleware/auth.js, middleware/upload.js, middleware/requireDb.js,
   middleware/csrfOriginProtection.js, middleware/csrfConfig.js,
   config/cloudinary.js, utils/money.js, utils/order-math.js, utils/discount.js,
   utils/order-adjust.js, utils/order-cancel.js, utils/pricing.js,
   utils/payment-verification.js, utils/qr-pickup.js,
   server.js, package.json, tests/unit/**, playwright*.config.js,
   scripts/qa-vendor-profile-server.mjs.
   Also inspect anything else the code points you to (for example a helper used
   by a completion path you are about to integrate with).

4. COMPARE DOCUMENTATION WITH CODE
   Build a short discrepancy list before coding: for each item, state the
   documented claim, the actual source evidence (file + symbol/line), and the
   resolution. Resolution rule: the live code wins for facts about the current
   application; the locked requirements in 00_PRODUCT_CONTRACT.md win for
   product behavior. When the two genuinely conflict and no evidence resolves
   it, stop that work unit and record it as HUMAN DECISION REQUIRED — do not
   guess silently and do not weaken a requirement.
   Record this discrepancy log in .ai/STATUS.md or in a file under
   billing-template/ (never edit .ai/goal.md's F09 section).

5. IMPLEMENT IN DEPENDENCY ORDER
   Follow billing-template/08_IMPLEMENTATION_PHASES.md:
     Phase 1 Foundation → Phase 2 PDF template engine →
     Phase 3 Invoice generation and persistence → Phase 4 Student delivery →
     Phase 5 QA and regression.
   A phase is eligible only when every dependency is complete with evidence.
   Do not begin a later phase to "save time", do not combine phases, and do not
   implement Phase 3 rendering hooks before Phase 2 coordinate mapping is
   verified.

6. WORK PHASE BY PHASE, SMALLEST CHANGE FIRST
   For each work unit: re-read the exact source you will touch, make the
   smallest change that satisfies the unit, keep existing architecture
   (Express 5 + EJS + Mongoose, ES modules, route-handler middleware chain
   requireDb → requireAuth → requireVendor/requireStudent → requireVendorShop),
   reuse existing utilities instead of duplicating them, and do not refactor
   unrelated code.

7. TEST AFTER EACH PHASE (AND AFTER EACH UNIT THAT CAN FAIL)
   Use the acceptance tests in billing-template/07_TESTING_AND_ACCEPTANCE.md and
   obey .ai/test.md safety rules:
   - Allowed: `npm test` / `npm run test:unit` (in-memory Mongo), isolated
     Playwright via `playwright.vendor-profile.config.js` or a new isolated
     harness using mongodb-memory-server-core, local headless browser checks.
   - Forbidden: the default `npm run test:e2e` config (real-DB hooks),
     `npm run seed`, any live payment gateway call, real FCM sends, real
     Cloudinary uploads, reading or printing .env values, production MongoDB.
   Never mark a test passed unless you executed it and observed the result.
   Record command, scope, pass/fail counts, failures, fixes and reruns.

8. PRESERVE EXISTING BEHAVIOR
   Do not regress: order lifecycle transitions (pending_payment → paid →
   accepted → ready_for_pickup → completed, plus cancellation), QR and OTP
   pickup completion in POST /vendor/verify and POST /vendor/verify-qr,
   Razorpay/Easebuzz/PhonePe create/verify/callback flows, mock checkout
   restricted to the `testing` shop, webhook idempotency, refunds and
   adjustments, vendor menu CRUD and image upload, admin routes, session auth,
   flash behavior, CSRF Origin/Referer protection, Socket.IO notifications,
   and the desktop-frozen UI policy.
   Preserve the existing default order bill in views/orders/show.ejs as the
   billing experience for shops with no template, an unconfigured template, or a
   removed template. Never generate a generic PDF as a fallback, and only offer
   an invoice download when an actual custom invoice exists.

9. RECORD PROGRESS AND EVIDENCE
   Update .ai/STATUS.md at every phase transition with: phase state
   (PENDING/IN_PROGRESS/COMPLETE/BLOCKED), files changed, commands run, observed
   results, and any blocked checks with reasons. Do not claim unexecuted tests.
   Documentation or code existing is not evidence of working behavior.

10. STOP CONDITIONS
    Stop and report (marking the affected phase BLOCKED) when you hit:
    - a genuinely unresolved business decision (for example statutory invoice
      number format, or whether vendor totals are tax-inclusive),
    - a requirement that cannot be met without destructive or irreversible
      action,
    - a locked requirement that contradicts verified code and cannot be
      reconciled safely,
    - a security/authorization defect you cannot fix inside the current phase,
    - a regression in payment, pickup, order totals, or existing vendor/student
      flows.
    Do not stop for ordinary implementation difficulties, and never ask the
    human to choose the next phase.

11. FINAL IMPLEMENTATION REPORT
    Produce REPORT_BILLING_TEMPLATE.md at the repository root containing:
    - phases completed with acceptance evidence (commands + observed results),
    - every file added or modified, with purpose,
    - the invoice data contract as implemented (field → source),
    - invoice numbering and idempotency mechanism,
    - storage locations and access-control rules,
    - the default-bill fallback behavior for the four shop states (no template,
      uploaded-but-unconfigured, active, removed), with evidence that no PDF is
      generated for the first two and the last,
    - test matrix results (passed/failed/skipped, and why anything was skipped),
    - discrepancies found between documentation and code, and how each was
      resolved,
    - remaining DECISION items and their current default behavior,
    - explicit statements: no production database was touched, no .env value was
      read or printed, and no F09 work was modified.

Remember, and repeat in your reports: implement the custom PDF overlay billing
system; do not recreate vendor invoices using HTML/CSS; do not build an invoice
designer; use Roboto for all dynamic text; preserve the original vendor PDF
design.
```

---

## Notes for the human operator

- The prompt deliberately repeats the mission statement because a future agent
  may read only the trigger, not this package.
- If the repository later records this feature as a numbered goal in
  `.ai/goal.md`, change step 2 so the agent reads that contract as well; until
  then `billing-template/00_PRODUCT_CONTRACT.md` is the contract.
- The trigger does not permit the agent to alter the invoice eligibility rules
  as an implementation convenience. If eligibility cannot be satisfied for a
  payment path, the correct action is to exclude that path and record it.
- The fallback is deliberately the existing HTML order bill, not a PDF. If a
  future human decision asks for a FlashFoods-branded PDF receipt, that is a
  separate feature and must not be folded into this one.
