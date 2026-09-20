# FlashFoods V2 — Stage 1 Roadmap

## Roadmap Philosophy

This document defines the preferred path to the goal. It is guidance, not a rigid script.

If a recommended implementation path does not fit the actual codebase:

1. identify why it fails,
2. inspect the dependency causing the problem,
3. design the smallest safe alternative,
4. implement the alternative,
5. test it,
6. continue toward the same goal.

Never abandon the feature merely because the preferred implementation path failed.

## Execution Rule

For every feature:

BUILD → FEATURE TEST → FIX → RETEST → VERIFY → PASS

Only after the current feature passes may the next feature begin.

## Recommended Sequence

### F01 — Student Profile

Start with the least invasive user-facing profile work.

Preferred approach:
- inspect current student profile implementation,
- preserve existing routes/authentication,
- make the smallest safe additions needed for the goal,
- add focused tests.

### F02 — Vendor Profile

Build on existing vendor authentication, vendor-to-shop ownership and existing admin analytics patterns.

Preferred approach:
- derive ownership from authenticated vendor/session,
- reuse existing shop/order analytics logic,
- use bounded MongoDB aggregation,
- keep EJS UI consistent with the current application,
- add focused authorization and analytics tests.

### F03 — Shop Open / Close Timing

Implement operating-hours configuration before pickup-slot logic so later slot behaviour can depend on valid shop hours.

Preferred approach:
- centralize time validation,
- reuse existing shop state logic,
- define clear timezone behaviour,
- test boundary conditions before continuing.

### F04 — Pickup Slots

Use the established shop-hours behaviour as the constraint for slot generation.

Preferred approach:
- define slot generation rules,
- define capacity rules,
- enforce capacity server-side,
- test concurrency/overbooking cases,
- preserve existing pickup workflow.

### F05 — Vendor Discounts

Implement discounts after order/shop configuration is stable.

Preferred approach:
- define authoritative discount calculation,
- reuse existing money utilities,
- ensure payment amounts use server-calculated totals,
- test rounding, invalid values, disabled discounts, cancellations/refunds where applicable.

### F06 — FCM Migration

Perform notification architecture work only after the order/pickup features are stable.

Preferred approach:
- map current Socket.IO notification flows,
- identify what must remain real-time,
- introduce FCM incrementally,
- preserve fallback behaviour while validating background delivery,
- test token lifecycle and duplicate delivery.

### F07 — QR Pickup

Implement QR pickup last among the feature builds because it touches an operationally sensitive workflow and must coexist safely with OTP pickup.

Preferred approach:
- define a minimal signed/validated payload,
- make the server authoritative,
- bind verification to authenticated vendor + order + shop,
- prevent replay and duplicate completion,
- keep OTP as fallback,
- test malformed, expired, reused, wrong-shop, wrong-order, and concurrent cases.

## After F01–F07

Run the post-feature quality sequence defined in `test.md`:

1. comprehensive test of all newly built features,
2. risk-based regression of affected modules from highest to lowest risk,
3. security-focused verification,
4. smoke tests,
5. stress/load tests where applicable,
6. global application test across student, vendor, and admin panels.

## Recovery Rule

If any later test reveals a regression in an earlier feature, return to that feature, use `bug_fix.md`, fix the root cause, retest it, then resume the roadmap.
