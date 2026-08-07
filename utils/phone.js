// Indian mobile phone normalization + validation. Shared by signup and profile.
const INDIAN_PHONE = /^[6-9]\d{9}$/;

// Accepts 9001234567, 90012 34567, +91 9001234567, +91 90012 34567, 919001234567.
// Returns the 10-digit form, or null when not a valid Indian mobile number.
export function validateIndianPhone(value) {
  const digits = String(value || "")
    .replace(/[\s-]/g, "")
    .replace(/^\+?91/, "")
    .replace(/\D/g, "");
  return INDIAN_PHONE.test(digits) ? digits : null;
}
