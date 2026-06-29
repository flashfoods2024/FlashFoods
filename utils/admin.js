const IST_OFFSET_MINUTES = 330;

function toIstDateParts(date = new Date()) {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const istMs = utcMs + IST_OFFSET_MINUTES * 60000;
  const ist = new Date(istMs);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    second: ist.getUTCSeconds(),
  };
}

function fromIstParts(parts) {
  const utcMs = Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
    parts.millisecond || 0,
  );
  return new Date(utcMs - IST_OFFSET_MINUTES * 60000);
}

export function startOfIstDay(date = new Date()) {
  const parts = toIstDateParts(date);
  return fromIstParts({
    year: parts.year,
    month: parts.month,
    day: parts.day,
  });
}

export function startOfIstWeek(date = new Date()) {
  const parts = toIstDateParts(date);
  const start = fromIstParts({
    year: parts.year,
    month: parts.month,
    day: parts.day,
  });
  const istDay = new Date(start.getTime() + IST_OFFSET_MINUTES * 60000).getUTCDay();
  const diff = (istDay + 6) % 7;
  start.setUTCDate(start.getUTCDate() - diff);
  return start;
}

export function startOfIstMonth(date = new Date()) {
  const parts = toIstDateParts(date);
  return fromIstParts({
    year: parts.year,
    month: parts.month,
    day: 1,
  });
}

export function normalizeQuery(value) {
  return String(value || "").trim();
}

export function formatOrderStatus(status) {
  const labels = {
    pending_payment: "Pending payment",
    paid: "Paid / Preparing",
    accepted: "Accepted",
    ready_for_pickup: "Ready for pickup",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  return labels[status] || status || "Unknown";
}

export function formatBooleanStatus(value, trueLabel = "Enabled", falseLabel = "Disabled") {
  return value ? trueLabel : falseLabel;
}
