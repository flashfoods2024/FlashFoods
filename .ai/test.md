# FlashFoods V2 — Stage 1 Test Protocol

## Purpose

Testing is a sequence of quality gates. Passing one feature is required before starting the next.

## 1. Feature-Level Testing

For each feature from `goal.md`:

BUILD
↓
RUN FEATURE TESTS
↓
FAILED?
↓ yes
FOLLOW bug_fix.md
↓
FIX
↓
RUN FAILED TEST AGAIN
↓
RUN RELEVANT REGRESSION TESTS
↓
VERIFY
↓
PASS
↓
NEXT FEATURE

Do not proceed while the current feature has failing required tests.

## 2. Minimum Feature Test Requirements

### F01 Student Profile

Verify:
- authenticated student access,
- correct student data,
- approved editing only,
- unauthorized access blocked,
- existing profile behaviour preserved.

### F02 Vendor Profile

Verify:
- authenticated vendor access,
- vendor account data,
- name/phone editing,
- email read-only,
- Today/Week/Month/Custom analytics,
- correct orders/revenue/items/AOV,
- best sellers,
- empty states,
- IST boundaries,
- shop isolation,
- vendor IDOR attempts,
- shop IDOR attempts,
- restricted-field protection,
- student profile regression.

### F03 Shop Open / Close

Verify:
- opening/closing configuration,
- valid/invalid values,
- shop availability,
- boundary times,
- missing configuration,
- student/vendor behaviour.

### F04 Pickup Slots

Verify:
- slot creation/configuration,
- slot visibility,
- capacity,
- full slots,
- invalid slots,
- outside-hours slots,
- overbooking attempts,
- concurrent booking behaviour,
- authorization.

### F05 Discounts

Verify:
- enable/disable,
- valid percentage,
- invalid percentage,
- boundary values,
- correct server-side total,
- correct payment amount,
- rounding,
- cancellation/refund interactions where applicable,
- vendor isolation.

### F06.5 Student Order Ready Notification — COMPLETE

Verify:
- vendor marking ready triggers exactly one student notification,
- correct student targeting (no cross-student leak),
- single notification sound (no alarm, no continuous ringing),
- background/closed-PWA delivery,
- tap opens the correct order page,
- existing vendor notifications unchanged.

### F07 QR Pickup — READY (trigger: `Execute F07.`)

Verify:
- student QR generated per order,
- vendor scanner shows name, phone, order number, items, quantity, amount,
- valid QR closes order immediately (completed),
- invalid/failed QR does NOT close order (stays ready_for_pickup),
- malformed QR,
- wrong vendor,
- wrong shop,
- wrong order,
- reused QR,
- replay attempt,
- concurrent verification (single close),
- server-authoritative pickup completion,
- OTP fallback works when QR fails,
- existing OTP flow still functional,
- no vendor pickup-confirm button exists in the flow,
- no partial-close state and no order reopening.

## 3. New-Feature Comprehensive Test

After F01–F05 + F06.5 + F07 all individually pass:

Run the complete feature set together.

Test interactions such as:
- shop hours + pickup slots,
- discounts + payment totals,
- pickup slots + orders,
- QR pickup + order status,
- F06.5 ready-notification + F07 QR pickup,
- profiles + role authorization.

## 4. Risk-Based Testing

After comprehensive feature testing, inspect modules affected by Stage 1 from highest to lowest risk.

Highest-risk areas should generally include:

1. payment/order total logic,
2. pickup verification and order status transitions,
3. authorization/ownership boundaries,
4. notification delivery,
5. slot capacity/concurrency,
6. shop timing logic,
7. analytics queries,
8. profile/UI-only changes.

This ordering is a risk-testing preference, not a claim that a specific module currently contains a defect.

## 5. Regression Testing

Verify existing behaviour for:

- authentication,
- student profile,
- student ordering,
- vendor dashboard,
- vendor pending orders,
- vendor pickup verification,
- vendor menu,
- vendor payment settings,
- completed orders,
- admin panel,
- admin analytics,
- payment flows,
- webhooks,
- existing notifications.

## 6. Smoke Testing

Verify the application can:

- start successfully,
- connect to the configured database,
- authenticate users,
- load student panel,
- load vendor panel,
- load admin panel,
- create/view an order,
- transition an order through its expected flow,
- verify pickup through supported mechanisms.

## 7. Stress / Load Testing

Use the repository's existing load-testing tooling where available.

Test realistic high-load paths, especially:
- order creation,
- order status changes,
- analytics endpoints,
- pickup verification,
- notification-triggering events.

Record observed failures rather than declaring success based only on average latency.

## 8. Global Test

After all previous gates pass, test the entire website/module surface.

Roles:
- Student
- Vendor
- Admin

Test categories:
- smoke,
- regression,
- integration,
- authorization/security,
- stress/load where applicable,
- critical business-flow verification.

The Global Test is the final Stage 1 quality gate.

## 9. Evidence Rule

Never mark a test as PASS unless it was actually executed or otherwise verified from concrete evidence.

Record:
- test command,
- scope,
- result,
- failures,
- fixes,
- rerun result.
