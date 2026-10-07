# Project Status

## FlashFoods — Smart College Canteen Pre-ordering System

**Version:** 1.0.1
**Last Updated:** 2026-10-07
**Status:** F08 IN PROGRESS — Phase 4 docs complete, awaiting Phase 5 approval

---

## Current State

- **Server:** Express 5 (ES modules)
- **Database:** MongoDB with Mongoose ODM
- **Templating:** EJS server-side rendering
- **Real-time:** Socket.IO for order notifications
- **Push:** FCM infrastructure (order-ready student notifications)
- **Testing:** unit (`npm test`, 266 green) + Playwright E2E (Chromium, Firefox, WebKit)
- **CI/CD:** GitHub Actions (Playwright on push/PR)

## Current Feature / Phase / Blockers

- Current feature: F08 Student Portal UI Standardization (Mobile-Only)
- Current phase: F08.7 DONE (profile converted, render smoke + div balance) → next F08.8 login
- Blockers: none (locked decisions: orange→red CTA, 35% card fill,
  Student Home desktop as-is, auth in scope; baseline committed at HEAD)

## Last Milestone

F07 QR Pickup COMPLETE (2026-09-24), incl. Pending Orders primary pickup
surface; full-suite QA PASS (68/68 live checks, reports at repo root).
History: `.ai/HISTORY.md`.

## Known Issues (carried forward, non-blocking)

1. MemoryStore for sessions is not production-safe
2. Easebuzz refunds not implemented (manual processing required)
3. Paytm and BharatPe payment flows not implemented
4. No admin audit logging
5. Password reset does not invalidate existing sessions
6. No CSRF protection (sameSite cookie commented out)
7. No rate limiting (removed by product policy, not a defect)
8. Cart not persisted across server restarts
9. Socket.IO has no authentication middleware
