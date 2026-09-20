// Pickup-slot logic.
//
// A shop may configure a daily pickup window (start/end) split into fixed
// duration slots, each with its own capacity. Students choose a slot instead of
// a free-form time, and capacity is enforced atomically through the
// PickupSlotBooking ledger so a slot can never be overbooked.
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
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MIN_DURATION = 5;
const MAX_DURATION = 240;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 500;
const MAX_DAYS_AHEAD = 7;

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
    const daysAhead = Number(raw.daysAhead);
    if (Number.isInteger(daysAhead) && daysAhead >= 0 && daysAhead <= MAX_DAYS_AHEAD) {
      settings.daysAhead = daysAhead;
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
      error: `Slot duration must be between ${MIN_DURATION} and ${MAX_DURATION} minutes.`,
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

  let daysAhead = raw.daysAhead === undefined || raw.daysAhead === "" ? 1 : Number(raw.daysAhead);
  if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > MAX_DAYS_AHEAD) {
    return { ok: false, error: `Days ahead must be between 0 and ${MAX_DAYS_AHEAD}.` };
  }

  return {
    ok: true,
    settings: {
      enabled: true,
      startTime: start,
      endTime: end,
      durationMinutes: duration,
      capacity,
      daysAhead,
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

// Generate the concrete slot instants for today + `daysAhead` future IST days.
// Only slots that start strictly in the future are returned, so a student can
// never book a slot that has already begun.
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

  const daysAhead = Number.isInteger(settings.daysAhead) ? settings.daysAhead : 1;
  const { y, m, d } = istDateParts(now);
  const out = [];

  for (let day = 0; day <= daysAhead; day++) {
    const base = new Date(Date.UTC(y, m, d) + day * MS_PER_DAY);
    const yy = base.getUTCFullYear();
    const mm = base.getUTCMonth();
    const dd = base.getUTCDate();
    for (let t = startMinutes; t + duration <= endMinutes; t += duration) {
      const start = istWallTimeToDate(yy, mm, dd, t);
      const end = istWallTimeToDate(yy, mm, dd, t + duration);
      if (start.getTime() > now.getTime()) {
        out.push({ start, end });
      }
    }
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

// Resolve a submitted value to one of the shop's real slots.
export function resolvePickupSlot(shop, value, now = new Date()) {
  const settings = shop?.pickupSlots;
  if (!settings || settings.enabled !== true) {
    return { ok: false, error: "This shop does not use pickup slots." };
  }
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    return { ok: false, error: "Please choose a valid pickup slot." };
  }
  const match = generateSlotInstants(settings, now)
    .filter((slot) => isWithinOperatingHours(shop, slot.start))
    .find((slot) => slot.start.getTime() === target.getTime());
  if (!match) {
    return { ok: false, error: "Please choose a valid pickup slot." };
  }
  return { ok: true, slot: match };
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
