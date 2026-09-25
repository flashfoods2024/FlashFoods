import {
  ALLOWED_CSRF_ORIGINS,
  CSRF_EXEMPT_PATHS,
} from "./csrfConfig.js";

const CSRF_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF protection via Origin/Referer allowlist for every same-origin
 * state-changing request (POST/PUT/PATCH/DELETE).
 *
 * Browsers send an Origin header on all non-GET requests, including plain
 * form POSTs, so this requires NO changes to existing EJS forms, the health
 * of Razorpay/PhonePe/Easebuzz flows, or the JSON API. It complements
 * SameSite=Lax (which already blocks cross-site top-level form POSTs) by
 * also covering cross-origin fetch/JSON requests, which SameSite=Lax does
 * not protect.
 */
export function csrfOriginProtection(req, res, next) {
  if (!CSRF_METHODS.has(req.method)) return next();

  const path = req.path;

  // EXEMPT: cross-origin payment-gateway browser postbacks/redirects that
  // carry a foreign (gateway) Origin and cannot carry our token. These are
  // authenticity-gated by their own mechanisms (the Easebuzz callback is
  // hash-verified against shop salt before any status change).
  if (CSRF_EXEMPT_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    return next();
  }

  // RFC 6454: the Origin header is the authoritative CSRF signal and is
  // forgery-resistant for cross-origin requests. Prefer it; fall back to
  // Referer (present on same-origin navigation POSTs when an older client
  // omits Origin).
  const origin = req.get("origin");
  const referer = req.get("referer");

  // RFC 6454 serializes an origin with no usable information as the literal
  // "null" (some engines also emit "None"). Sandboxed iframes, data:/about:blank
  // documents, and cross-site redirect chains all legitimately produce it — it
  // is a browser-generated value, not a CSRF attack (a cross-site attack always
  // sends a real Origin and is already stopped by SameSite=Lax + this
  // allowlist). Treat it as absent; new URL("null") would otherwise throw.
  const usable = (h) => h && h !== "null" && h !== "None";
  const originSignal = usable(origin) ? origin : "";
  const refererSignal = usable(referer) ? referer : "";

  if (!originSignal && !refererSignal) {
    // No usable Origin/Referer: a non-browser client (curl, health check,
    // server-side connector) or an opaque-origin browser request. Cross-origin
    // browser attacks always carry a real Origin, so a missing/opaque signal
    // cannot be one.
    return next();
  }

  const target = originSignal || refererSignal;
  let host;
  try {
    host = new URL(target).host;
  } catch {
    // A malformed (attacker-controlled) Origin/Referer cannot be a first-party
    // submission — reject.
    return res.status(403).json({ error: "CSRF check failed." });
  }

  if (ALLOWED_CSRF_ORIGINS.includes(host) || host === req.get("host")) {
    return next();
  }

  if (origin) {
    return res.status(403).json({ error: "Origin not allowed." });
  }
  return res.status(403).send("Forbidden");
}