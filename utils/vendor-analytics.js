import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import {
  startOfIstDay,
  startOfIstMonth,
  startOfIstWeek,
} from "./admin.js";
import { validateIndianPhone } from "./phone.js";

// Vendor Profile V2 analytics. Everything here is shop-scoped: callers must
// pass the shop id derived server-side from the authenticated vendor, never a
// value that came from the browser.

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const MAX_CUSTOM_RANGE_DAYS = 366;

export const VENDOR_ANALYTICS_RANGES = ["today", "week", "month", "custom"];
export const BEST_SELLER_LIMIT = 5;
export const VENDOR_NAME_MAX_LENGTH = 80;

// Revenue is denominated in rupees; keep it to paise precision so the display
// layer never shows float noise.
export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Date helpers (Asia/Kolkata)
// ---------------------------------------------------------------------------

/** End (inclusive) of the IST day that starts at `date`. */
export function endOfIstDay(date) {
  return new Date(new Date(date).getTime() + DAY_MS - 1);
}

/** Start of the IST day after `date`. */
export function startOfNextIstDay(date = new Date()) {
  return startOfIstDay(new Date(new Date(date).getTime() + DAY_MS));
}

/**
 * Parses a `YYYY-MM-DD` calendar date as an IST boundary.
 * Returns a Date (start of day, or end of day when `endOfDay`), or null when
 * the input is not a real calendar date (rejects `2026-02-30`, empty, `abc`).
 */
export function parseIstDate(value, { endOfDay = false } = {}) {
  const raw = value === null || value === undefined ? "" : String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const start = new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);

  // Round-trip check: JavaScript normalises overflow dates (Feb 30 -> Mar 2),
  // so compare the IST calendar date back against the input.
  const ist = new Date(start.getTime() + IST_OFFSET_MS);
  if (
    ist.getUTCFullYear() !== year ||
    ist.getUTCMonth() !== month - 1 ||
    ist.getUTCDate() !== day
  ) {
    return null;
  }

  return endOfDay ? endOfIstDay(start) : start;
}

/** Formats a Date as the IST calendar date `YYYY-MM-DD`. */
export function formatIstDate(date) {
  const ist = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatIstDateLabel(date) {
  return new Date(date).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Resolves a requested range into inclusive IST bounds.
 * Presets run from the IST boundary up to the end of the current IST day;
 * custom ranges require both dates and must be well formed and ordered.
 * Returns `{ ok: false, error }` for anything the caller should surface
 * (invalid dates, missing dates, reversed range, oversized range) instead of
 * throwing, so the route can answer with a 400 and the UI can show an error
 * state.
 */
export function resolveDateRange({
  range,
  startDate,
  endDate,
  now = new Date(),
} = {}) {
  const key = range === null || range === undefined ? "" : String(range).trim();
  const effective = key || "month";

  if (!VENDOR_ANALYTICS_RANGES.includes(effective)) {
    return { ok: false, error: "Invalid date range." };
  }

  const todayStart = startOfIstDay(now);
  const todayEnd = endOfIstDay(todayStart);

  if (effective === "today") {
    return {
      ok: true,
      range: "today",
      start: todayStart,
      end: todayEnd,
      label: "Today",
    };
  }

  if (effective === "week") {
    return {
      ok: true,
      range: "week",
      start: startOfIstWeek(now),
      end: todayEnd,
      label: "This week",
    };
  }

  if (effective === "month") {
    return {
      ok: true,
      range: "month",
      start: startOfIstMonth(now),
      end: todayEnd,
      label: "This month",
    };
  }

  const hasStart = startDate !== null && startDate !== undefined && String(startDate).trim() !== "";
  const hasEnd = endDate !== null && endDate !== undefined && String(endDate).trim() !== "";
  if (!hasStart || !hasEnd) {
    return { ok: false, error: "Select both a start and an end date." };
  }

  const start = parseIstDate(startDate);
  const end = parseIstDate(endDate, { endOfDay: true });
  if (!start || !end) {
    return { ok: false, error: "Enter valid dates in YYYY-MM-DD format." };
  }

  if (start.getTime() > end.getTime()) {
    return { ok: false, error: "Start date cannot be after the end date." };
  }

  if (end.getTime() - start.getTime() > MAX_CUSTOM_RANGE_DAYS * DAY_MS) {
    return {
      ok: false,
      error: `Date range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days.`,
    };
  }

  const label =
    formatIstDate(start) === formatIstDate(end)
      ? formatIstDateLabel(start)
      : `${formatIstDateLabel(start)} – ${formatIstDateLabel(end)}`;

  return { ok: true, range: "custom", start, end, label };
}

// ---------------------------------------------------------------------------
// Aggregation pipelines
// ---------------------------------------------------------------------------

function toShopObjectId(shopId) {
  if (shopId instanceof mongoose.Types.ObjectId) return shopId;
  if (!mongoose.isValidObjectId(shopId)) {
    throw new Error("Invalid shop id.");
  }
  return new mongoose.Types.ObjectId(String(shopId));
}

// Only completed orders count as revenue/units, matching the existing admin
// analytics definition of confirmed revenue.
function completedRangeMatch(shopId, start, end) {
  return {
    shop: toShopObjectId(shopId),
    status: "completed",
    createdAt: { $gte: new Date(start), $lte: new Date(end) },
  };
}

/** Totals (orders, revenue) + items sold for one shop over one range. */
export function buildSummaryPipeline(shopId, start, end) {
  return [
    { $match: completedRangeMatch(shopId, start, end) },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              orders: { $sum: 1 },
              revenue: { $sum: "$total" },
            },
          },
        ],
        items: [
          { $unwind: "$items" },
          { $match: { "items.status": { $ne: "removed" } } },
          { $group: { _id: null, itemsSold: { $sum: "$items.quantity" } } },
        ],
      },
    },
  ];
}

/** Top N items by quantity sold (removed items excluded). */
export function buildBestSellersPipeline(
  shopId,
  start,
  end,
  limit = BEST_SELLER_LIMIT,
) {
  const safeLimit = Math.min(Math.max(Number(limit) || BEST_SELLER_LIMIT, 1), 50);
  return [
    { $match: completedRangeMatch(shopId, start, end) },
    { $unwind: "$items" },
    { $match: { "items.status": { $ne: "removed" } } },
    {
      $group: {
        _id: "$items.name",
        quantity: { $sum: "$items.quantity" },
        revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
      },
    },
    { $sort: { quantity: -1, revenue: -1, _id: 1 } },
    { $limit: safeLimit },
    { $project: { _id: 0, name: "$_id", quantity: 1, revenue: 1 } },
  ];
}

/**
 * today / this week / this month in a single aggregation. The outer match uses
 * the earliest of the three boundaries (a week can start in the previous
 * month) so no bucket is silently truncated.
 */
export function buildPeriodsPipeline(shopId, now = new Date()) {
  const todayStart = startOfIstDay(now);
  const todayEnd = endOfIstDay(todayStart);
  const weekStart = startOfIstWeek(now);
  const monthStart = startOfIstMonth(now);
  const overallStart = new Date(
    Math.min(todayStart.getTime(), weekStart.getTime(), monthStart.getTime()),
  );

  const bucket = (start) => [
    { $match: { createdAt: { $gte: start, $lte: todayEnd } } },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        revenue: { $sum: "$total" },
      },
    },
  ];

  return [
    {
      $match: {
        shop: toShopObjectId(shopId),
        status: "completed",
        createdAt: { $gte: overallStart, $lte: todayEnd },
      },
    },
    {
      $facet: {
        today: bucket(todayStart),
        week: bucket(weekStart),
        month: bucket(monthStart),
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------

/** Turns the summary facet output into `{ orders, revenue, itemsSold, averageOrderValue }`. */
export function summarizeAnalytics(facet) {
  const summary = facet?.summary?.[0] || {};
  const items = facet?.items?.[0] || {};

  const orders = Number(summary.orders) || 0;
  const revenue = roundMoney(summary.revenue);
  const itemsSold = Number(items.itemsSold) || 0;

  return {
    orders,
    revenue,
    itemsSold,
    averageOrderValue: orders > 0 ? Math.round(revenue / orders) : 0,
  };
}

/** Turns the periods facet output into today/week/month `{ orders, revenue }`. */
export function summarizePeriods(facet) {
  const pick = (rows) => {
    const row = rows?.[0] || {};
    return {
      orders: Number(row.orders) || 0,
      revenue: roundMoney(row.revenue),
    };
  };
  return {
    today: pick(facet?.today),
    week: pick(facet?.week),
    month: pick(facet?.month),
  };
}

export function normalizeBestSellers(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    name: String(row?.name ?? "Unknown item"),
    quantity: Number(row?.quantity) || 0,
    revenue: roundMoney(row?.revenue),
  }));
}

/**
 * Full analytics payload for one shop: range totals, best sellers, and the
 * fixed today/week/month snapshot.
 *
 * `shopId` must already be an authorized, server-derived shop id.
 */
export async function getVendorProfileAnalytics({
  shopId,
  range = "month",
  startDate,
  endDate,
  now = new Date(),
} = {}) {
  const resolved = resolveDateRange({ range, startDate, endDate, now });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const shopObjectId = toShopObjectId(shopId);

  const [summaryRows, bestSellerRows, periodRows] = await Promise.all([
    Order.aggregate(buildSummaryPipeline(shopObjectId, resolved.start, resolved.end)),
    Order.aggregate(buildBestSellersPipeline(shopObjectId, resolved.start, resolved.end)),
    Order.aggregate(buildPeriodsPipeline(shopObjectId, now)),
  ]);

  return {
    ok: true,
    range: resolved.range,
    label: resolved.label,
    startDate: formatIstDate(resolved.start),
    endDate: formatIstDate(resolved.end),
    summary: summarizeAnalytics(summaryRows[0]),
    bestSellers: normalizeBestSellers(bestSellerRows),
    periods: summarizePeriods(periodRows[0]),
  };
}

// ---------------------------------------------------------------------------
// Profile editing
// ---------------------------------------------------------------------------

/**
 * Validates a vendor profile edit and returns ONLY the allowed fields.
 *
 * The allowlist is the whole point: anything the vendor must not change
 * (role, shop, isActive, email, password, payment/security fields) is dropped
 * here rather than being filtered later, so a crafted body can never mass
 * assign onto the user document.
 */
export function validateVendorProfileUpdate({ name, phone } = {}) {
  const updates = {};

  const hasName = name !== undefined && name !== null;
  const hasPhone = phone !== undefined && phone !== null;

  if (!hasName && !hasPhone) {
    return { ok: false, error: "Nothing to update." };
  }

  // Nested form encoding (`name[x]=..`) or a crafted JSON body can deliver an
  // object/array here; only flat strings are ever accepted.
  if (hasName && typeof name !== "string") {
    return { ok: false, field: "name", error: "Enter a valid name." };
  }
  if (hasPhone && typeof phone !== "string") {
    return {
      ok: false,
      field: "phone",
      error: "Enter a valid 10-digit Indian mobile number.",
    };
  }

  if (hasName) {
    const clean = String(name).replace(/\s+/g, " ").trim();
    if (!clean) {
      return { ok: false, field: "name", error: "Name is required." };
    }
    if (clean.length < 2) {
      return {
        ok: false,
        field: "name",
        error: "Name must be at least 2 characters.",
      };
    }
    if (clean.length > VENDOR_NAME_MAX_LENGTH) {
      return {
        ok: false,
        field: "name",
        error: `Name must be ${VENDOR_NAME_MAX_LENGTH} characters or fewer.`,
      };
    }
    updates.name = clean;
  }

  if (hasPhone) {
    const raw = String(phone).trim();
    if (!raw) {
      // Vendors may clear an optional phone number.
      updates.phone = "";
    } else {
      const digits = validateIndianPhone(raw);
      if (!digits) {
        return {
          ok: false,
          field: "phone",
          error: "Enter a valid 10-digit Indian mobile number.",
        };
      }
      updates.phone = digits;
    }
  }

  return { ok: true, updates };
}
