/**
 * Allowlist for the Origin/Referer CSRF protection (middleware/csrfOriginProtection.js).
 *
 * ALLOWED_CSRF_ORIGINS: extra hosts (beyond the request's own Host) that are
 * permitted to submit state-changing requests. Browsers include Origin on all
 * non-GET requests, so add any legitimately-first-party origin here (e.g. the
 * www host while the app serves on the apex domain). Requests from the request's
 * own Host are always allowed.
 *
 * CSRF_EXEMPT_PATHS: path prefixes skipped by the check. Only payment-gateway
 * postbacks/redirects that carry a foreign Origin AND are already
 * authenticity-gated server-side belong here. Do not widen without reason.
 */
export const ALLOWED_CSRF_ORIGINS = ["www.flashfoods.in"];

export const CSRF_EXEMPT_PATHS = [
  "/easebuzz/callback",
  "/phonepe/callback",
];