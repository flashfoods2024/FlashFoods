import crypto from "node:crypto";

// Deterministic JSON used for mapping/snapshot hashes. Keys are sorted, numbers
// are rounded to 3 decimals so float noise cannot change a hash.
function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(3));
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return null;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function hashJson(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
