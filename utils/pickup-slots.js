// Pickup-slot logic.
//
// A shop may configure a daily pickup window (start/end). Students choose a
// slot instead of a free-form time, and capacity is enforced atomically
// through the PickupSlotBooking ledger so a slot can never be overbooked.
//
// The configured `durationMinutes` is the shop's "Preparation Time (minutes)"
// — the minimum lead time before a pickup can occur. The earliest valid
// pickup is `max(now + preparation time, window start)`; the first slot
// starts exactly there and later slots follow at `duration`-minute steps
// (see `generateSlotInstants`). The same value is also the slot width.
//
// All wall-clock times are IST (Asia/Kolkata), matching the rest of the app.

import { PickupSlotBooking } from "../models/PickupSlotBooking.js";
import {
  parseTimeToMinutes,
  normalizeTime,
  isWithinOperatingHours,
} from "./shop-hours.js";
import { validatePickupTime } from "./time.js";

const IST_OFFSET_MS = 330 * 60 * 1000;

const MIN_DURATION = 5;
const MAX_DURATION = 240;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 500;
// ponytail: daysAhead removed from F04; stored Shop.pickupSlots.daysAhead (if
// present on old documents) is ignored, never read. DB field kept so no
// migration is needed.

function isEnabledFlag(value) {
  return value === true || value === "true" || value === "on" || value === "1" || value === 1;
}

// Validate the vendor/admin slot settings form.
// Returns { ok: true, settings } or { ok: false, error }.
export function validatePickupSlotSettings(raw = {}) {
  const enabled = isEnabledFlag(raw.enabled);

  if (!enabled) {
    // Best-effort: retain any valid values the caller submitted, otherwise the
    // schema defaults apply when the subdocument is replaced.
    const settings = { enabled: false };
    const start = normalizeTime(String(raw.startTime ?? ""));
    if (start !== null) settings.startTime = start;
    const end = normalizeTime(String(raw.endTime ?? ""));
    if (end !== null) settings.endTime = end;
    const duration = Number(raw.durationMinutes);
    if (Number.isInteger(duration) && duration >= MIN_DURATION && duration <= MAX_DURATION) {
      settings.durationMinutes = duration;
    }
    const capacity = Number(raw.capacity);
    if (Number.isInteger(capacity) && capacity >= MIN_CAPACITY && capacity <= MAX_CAPACITY) {
      settings.capacity = capacity;
    }
    return { ok: true, settings };
  }

  const start = normalizeTime(String(raw.startTime ?? ""));
  if (start === null) {
    return { ok: false, error: "Slot start time must be a valid time (HH:MM)." };
  }
  const end = normalizeTime(String(raw.endTime ?? ""));
  if (end === null) {
    return { ok: false, error: "Slot end time must be a valid time (HH:MM)." };
  }
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (endMinutes <= startMinutes) {
    return { ok: false, error: "Slot end time must be after the slot start time." };
  }

  const duration = Number(raw.durationMinutes);
  if (!Number.isInteger(duration) || duration < MIN_DURATION || duration > MAX_DURATION) {
    return {
      ok: false,
      error: `Preparation time must be between ${MIN_DURATION} and ${MAX_DURATION} minutes.`,
    };
  }
  if (endMinutes - startMinutes < duration) {
    return { ok: false, error: "The slot window must be at least one slot long." };
  }

  const capacity = Number(raw.capacity);
  if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
    return {
      ok: false,
      error: `Slot capacity must be between ${MIN_CAPACITY} and ${MAX_CAPACITY}.`,
    };
  }

  return {
    ok: true,
    settings: {
      enabled: true,
      startTime: start,
      endTime: end,
      durationMinutes: duration,
      capacity,
    },
  };
}

function istDateParts(now) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
  };
}

function istWallTimeToDate(y, m, d, minutes) {
  return new Date(
    Date.UTC(y, m, d, Math.floor(minutes / 60), minutes % 60) - IST_OFFSET_MS,
  );
}

// Generate today's concrete slot instants (IST).
//
// earliestPickup = max(now + preparation time, window start). The first slot
// starts EXACTLY at earliestPickup — it is never rounded forward to the old
// window-start grid — and later slots follow at `duration`-minute steps. A
// slot is emitted only when its full interval fits inside the window
// (`start + duration <= window end`), so past slots never appear.
export function generateSlotInstants(settings, now = new Date()) {
  if (!settings || settings.enabled !== true) return [];

  const startMinutes = parseTimeToMinutes(settings.startTime);
  const endMinutes = parseTimeToMinutes(settings.endTime);
  const duration = Number(settings.durationMinutes);
  if (
    startMinutes === null ||
    endMinutes === null ||
    !Number.isInteger(duration) ||
    duration <= 0 ||
    endMinutes <= startMinutes
  ) {
    return [];
  }

  const stepMs = duration * 60 * 1000;
  const { y, m, d } = istDateParts(now);
  const windowStartMs = istWallTimeToDate(y, m, d, startMinutes).getTime();
  const windowEndMs = istWallTimeToDate(y, m, d, endMinutes).getTime();
  // ponytail: ceil to the whole minute so every student viewing within the
  // same minute sees the identical lattice (shared capacity buckets) and a
  // displayed slot stays bookable for checkout. Never rounded to the old
  // window-start grid; prep is only ever rounded UP, never cut short.
  const earliestMs =
    Math.ceil(Math.max(now.getTime() + stepMs, windowStartMs) / 60000) * 60000;
  const out = [];

  for (let s = earliestMs; s + stepMs <= windowEndMs; s += stepMs) {
    out.push({ start: new Date(s), end: new Date(s + stepMs) });
  }

  return out;
}

export function formatSlotLabel(start, end, now = new Date()) {
  const timeOpts = {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  const startLabel = new Date(start).toLocaleTimeString("en-IN", timeOpts);
  const endLabel = new Date(end).toLocaleTimeString("en-IN", timeOpts);
  const sameIstDay =
    new Date(start).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) ===
    new Date(now).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const dayPrefix = sameIstDay
    ? ""
    : `${new Date(start).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" })} `;
  return `${dayPrefix}${startLabel} – ${endLabel}`;
}

// Ensure the ledger document exists, tolerating the benign upsert race.
async function ensureBookingDoc(shopId, slotStart) {
  try {
    await PickupSlotBooking.updateOne(
      { shop: shopId, slotStart },
      { $setOnInsert: { booked: 0 } },
      { upsert: true },
    );
  } catch (err) {
    // 11000 = another concurrent request created it first; harmless.
    if (err?.code !== 11000) throw err;
  }
}

// Atomically take one place in a slot. Returns { ok } or { ok:false, error }.
export async function reserveSlot(shopId, slotStart, capacity) {
  await ensureBookingDoc(shopId, slotStart);

  const updated = await PickupSlotBooking.findOneAndUpdate(
    { shop: shopId, slotStart, booked: { $lt: capacity } },
    { $inc: { booked: 1 } },
    { new: true },
  );

  if (!updated) {
    return {
      ok: false,
      error: "That pickup slot is full. Please choose another slot.",
    };
  }
  return { ok: true };
}

// Return a previously reserved place. Safe to call redundantly — it will never
// drive `booked` below zero.
export async function releaseSlot(shopId, slotStart) {
  if (!shopId || !slotStart) return;
  await PickupSlotBooking.updateOne(
    { shop: shopId, slotStart, booked: { $gt: 0 } },
    { $inc: { booked: -1 } },
  );
}

// Resolve a submitted value to a valid pickup slot. Validated structurally
// (same IST day, full interval inside the window, preparation time met,
// operating hours) instead of exact-matching a regenerated lattice, because
// the lattice anchor moves with `now` — exact-matching would reject honestly
// displayed slots seconds after the cart page rendered them.
const RESOLVE_SKEW_MS = 60 * 1000; // clock/round-trip tolerance, << prep range
export function resolvePickupSlot(shop, value, now = new Date()) {
  const settings = shop?.pickupSlots;
  if (!settings || settings.enabled !== true) {
    return { ok: false, error: "This shop does not use pickup slots." };
  }
  const duration = Number(settings.durationMinutes);
  if (!Number.isInteger(duration) || duration <= 0) {
    return { ok: false, error: "Please choose a valid pickup slot." };
  }
  const target = new Date(value);
  const t = target.getTime();
  if (Number.isNaN(t)) {
    return { ok: false, error: "Please choose a valid pickup slot." };
  }
  const startMinutes = parseTimeToMinutes(settings.startTime);
  const endMinutes = parseTimeToMinutes(settings.endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return { ok: false, error: "Please choose a valid pickup slot." };
  }
  // Today-only: the slot must fall on the same IST day as `now`.
  const { y, m, d } = istDateParts(now);
  const tp = istDateParts(target);
  if (tp.y !== y || tp.m !== m || tp.d !== d) {
    return { ok: false, error: "Please choose a valid pickup slot." };
  }
  const stepMs = duration * 60 * 1000;
  const windowStartMs = istWallTimeToDate(y, m, d, startMinutes).getTime();
  const windowEndMs = istWallTimeToDate(y, m, d, endMinutes).getTime();
  if (t < windowStartMs || t + stepMs > windowEndMs) {
    return { ok: false, error: "Please choose a valid pickup slot." };
  }
  // Preparation time: reject a slot that starts before now + prep.
  if (t < now.getTime() + stepMs - RESOLVE_SKEW_MS) {
    return { ok: false, error: "Please choose a valid pickup slot." };
  }
  if (!isWithinOperatingHours(shop, target)) {
    return { ok: false, error: "Please choose a valid pickup slot." };
  }
  return { ok: true, slot: { start: target, end: new Date(t + stepMs) } };
}

// Validate + reserve in one step for order creation.
//
// For shops without slots this preserves the existing free-form pickup-time
// validation exactly (no reservation is taken).
export async function reservePickupSlot(shop, rawValue, now = new Date()) {
  const settings = shop?.pickupSlots;

  if (!settings || settings.enabled !== true) {
    const validation = validatePickupTime(rawValue);
    if (!validation.valid) return { ok: false, error: validation.error };
    return { ok: true, date: validation.date || null, reserved: false };
  }

  const resolved = resolvePickupSlot(shop, rawValue, now);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const reserved = await reserveSlot(shop._id, resolved.slot.start, settings.capacity);
  if (!reserved.ok) return { ok: false, error: reserved.error };

  return {
    ok: true,
    date: resolved.slot.start,
    reserved: true,
    slotStart: resolved.slot.start,
  };
}

// Slot list with live remaining capacity, for the student-facing UI.
export async function getSlotAvailability(shop, now = new Date()) {
  const settings = shop?.pickupSlots;
  if (!settings || settings.enabled !== true) {
    return { enabled: false, slots: [] };
  }

  // A slot is only offered when it also falls inside the shop's operating
  // hours (when those are configured) — an "outside-hours" slot is never valid.
  const instants = generateSlotInstants(settings, now).filter((slot) =>
    isWithinOperatingHours(shop, slot.start),
  );
  const capacity = Number(settings.capacity);
  const bookings = await PickupSlotBooking.find({
    shop: shop._id,
    slotStart: { $in: instants.map((slot) => slot.start) },
  }).lean();
  const bookedByStart = new Map(
    bookings.map((row) => [row.slotStart.getTime(), row.booked || 0]),
  );

  return {
    enabled: true,
    capacity,
    slots: instants.map((slot) => {
      const booked = bookedByStart.get(slot.start.getTime()) || 0;
      const remaining = Math.max(0, capacity - booked);
      return {
        start: slot.start,
        startIso: slot.start.toISOString(),
        endIso: slot.end.toISOString(),
        label: formatSlotLabel(slot.start, slot.end, now),
        capacity,
        booked,
        remaining,
        available: remaining > 0,
      };
    }),
  };
}
