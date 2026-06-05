export function formatPickupTime(pickupTime) {
  if (!pickupTime) return "Not specified";

  const date = new Date(pickupTime);
  if (Number.isNaN(date.getTime())) return "Not specified";

  return date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatLocalDateTime(value) {
  if (!value) return "Not specified";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not specified";

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function getPickupUrgency(pickupTime, now = new Date()) {
  if (!pickupTime) return "muted";

  const date = new Date(pickupTime);
  if (Number.isNaN(date.getTime())) return "muted";

  const minutesUntilPickup = (date.getTime() - now.getTime()) / 60000;
  if (minutesUntilPickup < 0) return "danger";
  if (minutesUntilPickup <= 20) return "pending";
  return "ok";
}
