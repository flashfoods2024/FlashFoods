# Project Status

## FlashFoods — Smart College Canteen Pre-ordering System

**Version:** 1.0.0
**Last Updated:** 2026-07-15
**Status:** Active Development

---

## Current State

- **Server:** Express 5 (ES modules)
- **Database:** MongoDB with Mongoose ODM
- **Templating:** EJS server-side rendering
- **Real-time:** Socket.IO for order notifications
- **Testing:** Playwright E2E (Chromium, Firefox, WebKit)
- **CI/CD:** GitHub Actions (Playwright on push/PR)

## Documentation

| Area | Location | Status |
|------|----------|--------|
| AI Knowledge Base | `.ai/` | ✅ Complete (11 files) |
| Technical Docs | `docs/` | ✅ Complete (13 files) |
| Engineering Audit | `docs/ENGINEERING_AUDIT.md` | ✅ Complete |

## Cleanup Completed

- Removed backup files (`package.json.bak`, `package-lock.json.bak`)
- Removed accidental cookie file (`-b`)
- Removed duplicate image (`background-image copy.png`)
- Removed binary test file (`test.txt`)
- Updated `.gitignore` with backup and temp patterns

## Tests Added

| Test File | Tests | Type |
|-----------|-------|------|
| `tests/login.spec.js` | 3 | Auth E2E |
| `tests/smoke.spec.js` | 6 | Page load smoke tests |
| `tests/permissions.spec.js` | 10 | Role-based access control |
| `tests/vendor-workflow.spec.js` | 5 | Vendor operations |
| `tests/student-workflow.spec.js` | 6 | Student operations |

## Known Issues

1. MemoryStore for sessions is not production-safe
2. Easebuzz refunds not implemented (manual processing required)
3. Paytm and BharatPe payment flows not implemented
4. No admin audit logging
5. Password reset does not invalidate existing sessions
6. No CSRF protection (sameSite cookie commented out)
7. No auth rate limiting (brute force risk)
8. Cart not persisted across server restarts
9. Socket.IO has no authentication middleware
10. Debug console logs in production code
