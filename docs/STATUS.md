# Project Status

**Project:** FlashFoods — Smart College Canteen Pre-ordering System
**Version:** 1.0.0
**Last Updated:** 2026-07-15
**Status:** Active Development

## Current State

| Component | Status | Notes |
|-----------|--------|-------|
| Server | ✅ Running | Express 5 on port 3000 |
| Database | ✅ Connected | MongoDB via Mongoose |
| Auth | ✅ Working | Session-based, bcrypt |
| Shop CRUD | ✅ Working | Admin + vendor management |
| Menu CRUD | ✅ Working | With variants and images |
| Cart | ✅ Working | Session-based, single-shop |
| Orders | ✅ Working | Full lifecycle |
| Razorpay | ✅ Working | Production-tested |
| Easebuzz | ✅ Implemented | Test mode |
| PhonePe | ✅ Implemented | UAT mode |
| Paytm | ❌ Not implemented | Schema only |
| BharatPe | ❌ Not implemented | Schema only |
| Refunds | ✅ Partial | Razorpay + PhonePe; Easebuzz pending |
| Socket.IO | ✅ Working | Pending order notifications |
| Menu Import (AI) | ✅ Working | Gemini Vision API |
| Cloudinary | ✅ Working | Image uploads |
| Email (Resend) | ✅ Working | Password reset only |
| Password Reset | ✅ Working | 15-min token expiry |
| Admin Dashboard | ✅ Working | Stats, analytics |
| Rate Limiting | ✅ Working | 300 req/15min |
| Helmet | ✅ Working | CSP disabled |
| E2E Tests | ⚠️ Minimal | 1 login test only |
| CI/CD | ✅ Setup | GitHub Actions |

## Known Issues

1. MemoryStore for sessions is not production-safe; should migrate to connect-mongo or Redis
2. Easebuzz refunds are not implemented (manual processing required)
3. Paytm and BharatPe payment flows are not implemented
4. No audit logging for admin actions
5. Only one E2E test exists (login)
6. No health check endpoint
7. No rate limiting specifically on auth routes (brute force risk)
8. Password reset does not invalidate existing sessions
9. Cart is not persisted across sessions (server restart loses carts)
10. No notification preferences configuration

## Upcoming

- Production session store migration
- Easebuzz refund implementation
- Comprehensive test suite
- Admin audit logging
- Auth route rate limiting
