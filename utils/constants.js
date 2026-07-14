export const BCRYPT_SALT_ROUNDS = 10;

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_MAX = 300;

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_RESET_EXPIRY_MS = 15 * 60 * 1000;

export const OTP_LENGTH = 6;
export const MAX_QUANTITY = 99;
export const MIN_QUANTITY = 1;

export const IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const PICKUP_URGENCY_PENDING_MINUTES = 20;

export const IST_OFFSET_MINUTES = 330;

export const ORDER_STATUSES = {
  PENDING_PAYMENT: "pending_payment",
  PAID: "paid",
  ACCEPTED: "accepted",
  READY_FOR_PICKUP: "ready_for_pickup",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

export const REFUND_STATUSES = {
  NONE: "none",
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
};

export const ROLES = {
  STUDENT: "student",
  VENDOR: "vendor",
  ADMIN: "admin",
};

export const FOOD_TYPES = {
  VEG: "veg",
  NON_VEG: "non-veg",
  EGG: "egg",
  UNKNOWN: "unknown",
};

export const PAYMENT_GATEWAYS = {
  RAZORPAY: "razorpay",
  EASEBUZZ: "easebuzz",
  PHONEPE: "phonepe",
  PAYTM: "paytm",
  BHARATPE: "bharatpe",
};

export const ORDER_STATUS_LABELS = {
  pending_payment: "Pending payment",
  paid: "Paid / Preparing",
  accepted: "Accepted",
  ready_for_pickup: "Ready for pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ADJUSTMENT_REASONS = [
  "Out of Stock",
  "Preparation Issue",
  "Ingredient Unavailable",
  "Kitchen Issue",
  "Other",
];

export const DEFAULT_VARIANT_LABEL = "Regular";

export const ADMIN_SECTIONS = {
  DASHBOARD: "dashboard",
  SHOPS: "shops",
  VENDORS: "vendors",
  STUDENTS: "students",
  ORDERS: "orders",
  MENUS: "menus",
  ANALYTICS: "analytics",
};
