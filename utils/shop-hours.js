// Shop operating-hours logic.
//
// Times are stored on the Shop document as "HH:MM" strings and are interpreted
// in IST (Asia/Kolkata), the same timezone the rest of the app formats pickup
// times in. The manual `isOpen` flag remains the master switch; configured
// operating hours only further constrain availability.
//
// A shop whose hours are missing or invalid is never accidentally hidden: an
// unconfigured/invalid window is treated as "no hour constraint" so availability
// falls back to the manual open/closed state (safe handling).

// Accepts both padded ("09:05") and unpadded ("9:05") 24-hour hours.
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const IST_OFFSET_MINUTES = 330; // UTC+05:30

export const MINUTES_PER_DAY = 24 * 60;

// "H:MM", "HH:MM" (24-hour) -> minutes since midnight, or null when invalid.
export function parseTimeToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Canonical "HH:MM" string for a valid time, else null.
export function normalizeTime(value) {
  const minutes = parseTimeToMinutes(value);
  if (minutes === null) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

// Minutes since midnight in IST for an instant.
export function istMinutesOfDay(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

// Validate an opening/closing pair coming from a form.
//
// Both blank => hours intentionally not configured (allowed).
// Exactly one set, a malformed value, or identical times => rejected.
// Returns { ok: true, openingTime, closingTime } or { ok: false, error }.
export function validateOperatingHours(openingTime, closingTime) {
  const hasOpen = openingTime !== undefined && openingTime !== null && String(openingTime).trim() !== "";
  const hasClose = closingTime !== undefined && closingTime !== null && String(closingTime).trim() !== "";

  if (!hasOpen && !hasClose) {
    return { ok: true, openingTime: "", closingTime: "" };
  }
  if (!hasOpen || !hasClose) {
    return {
      ok: false,
      error: "Set both opening and closing time, or leave both blank.",
    };
  }

  const opening = normalizeTime(String(openingTime));
  if (opening === null) {
    return { ok: false, error: "Opening time must be a valid time (HH:MM)." };
  }
  const closing = normalizeTime(String(closingTime));
  if (closing === null) {
    return { ok: false, error: "Closing time must be a valid time (HH:MM)." };
  }
  if (opening === closing) {
    return {
      ok: false,
      error: "Opening and closing time cannot be the same.",
    };
  }

  return { ok: true, openingTime: opening, closingTime: closing };
}

// True only when a valid opening/closing pair is present.
export function hasConfiguredHours(shop) {
  if (!shop) return false;
  const open = parseTimeToMinutes(shop.openingTime);
  const close = parseTimeToMinutes(shop.closingTime);
  return open !== null && close !== null && open !== close;
}

// Is `now` inside the configured window?
//
// - Unconfigured or invalid hours => true (no constraint, defer to manual flag).
// - opening < closing => same-day window, inclusive of opening, exclusive of closing.
// - opening > closing => overnight window spanning midnight.
export function isWithinOperatingHours(shop, now = new Date()) {
  const open = parseTimeToMinutes(shop?.openingTime);
  const close = parseTimeToMinutes(shop?.closingTime);
  if (open === null || close === null || open === close) return true;

  const minutes = istMinutesOfDay(now);
  if (open < close) return minutes >= open && minutes < close;
  return minutes >= open || minutes < close;
}

// Effective student-facing availability: active AND manually open AND within
// configured hours.
export function isShopAvailable(shop, now = new Date()) {
  if (!shop) return false;
  if (shop.isActive === false) return false;
  if (shop.isOpen === false) return false;
  return isWithinOperatingHours(shop, now);
}

// 24-hour "HH:MM" -> "9:00 AM" style label for display.
export function formatTimeLabel(value) {
  const minutes = parseTimeToMinutes(value);
  if (minutes === null) return null;
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

// A view-friendly summary of a shop's availability, used by the student-facing
// templates. Never throws on malformed shop data.
export function getShopAvailability(shop, now = new Date()) {
  const configured = hasConfiguredHours(shop);
  const openingTime = configured ? normalizeTime(shop.openingTime) : null;
  const closingTime = configured ? normalizeTime(shop.closingTime) : null;
  const withinHours = isWithinOperatingHours(shop, now);
  const available = isShopAvailable(shop, now);

  let label;
  if (!shop || shop.isActive === false) label = "Unavailable";
  else if (shop.isOpen === false) label = "Closed";
  else if (!withinHours) label = "Closed";
  else label = "Open";

  const hoursLabel =
    configured && formatTimeLabel(openingTime) && formatTimeLabel(closingTime)
      ? `${formatTimeLabel(openingTime)} – ${formatTimeLabel(closingTime)}`
      : "Hours not set";

  return {
    available,
    configured,
    withinHours,
    openingTime,
    closingTime,
    hoursLabel,
    label,
  };
}
