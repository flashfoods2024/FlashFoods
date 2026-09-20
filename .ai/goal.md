# FlashFoods V2 — Stage 1 Feature Goal

## Objective

Complete the Stage 1 feature set below in the existing FlashFoods application while preserving existing functionality and meeting the testing and security requirements defined in `.ai`.

## Feature Order

### F01 — Student Profile

Create or complete a student profile experience containing the student's existing account information and relevant activity information.

Core behaviour:
- display the authenticated student's profile information,
- allow only approved editable fields,
- preserve the existing student profile flow,
- provide sensible empty and error states.

### F02 — Vendor Profile

Provide a vendor self-profile and compact business analytics experience.

Core behaviour:
- vendor account information,
- editable name and phone,
- read-only email,
- Today / Week / Month / Custom analytics,
- orders, revenue, items sold, average order value,
- top-5 best-selling items,
- strict authenticated-vendor/shop isolation.

### F03 — Shop Open / Close Timing

Add shop operating hours and shop availability behaviour.

Core behaviour:
- opening time,
- closing time,
- shop open/closed state,
- student-facing availability based on configured hours,
- safe handling of invalid or missing time configuration.

### F04 — Pickup Slots

Allow appropriate vendor/admin controls for pickup slots.

Core behaviour:
- slot start/end configuration,
- slot duration,
- capacity per slot,
- student slot availability,
- server-side capacity enforcement,
- prevention of overbooking.

### F05 — Vendor Discounts

Allow discounts to be configured by vendor/admin according to the application's business rules.

Core behaviour:
- enable/disable,
- configurable percentage discount,
- authoritative server-side calculation,
- correct order/payment totals,
- correct rounding and edge-case handling.

### F06 — FCM Migration

Move appropriate notification delivery from the current real-time-only approach toward Firebase Cloud Messaging while preserving required real-time behaviour.

Core behaviour:
- token registration and refresh,
- appropriate foreground/background delivery,
- vendor-specific targeting,
- invalid-token handling,
- no duplicate notification behaviour,
- preserve required Socket.IO functionality where still appropriate.

### F07 — QR Pickup

Add QR-code pickup as an alternative to OTP pickup.

Core behaviour:
- student can present an order-specific QR code,
- vendor can scan it,
- server validates the request,
- successful verification completes pickup,
- OTP remains available as a fallback,
- QR cannot be replayed, forged, or used for another vendor/shop.

## Stage 1 Completion Goal

Stage 1 is complete only when every feature above is implemented and passes its feature-level tests, followed by the comprehensive, risk-based, regression, smoke, stress, and global tests defined in `test.md`.
