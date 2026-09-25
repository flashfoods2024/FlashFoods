import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyRazorpayWebhook } from "../../utils/webhook-signature.js";
import { resolveWebhookSecret } from "../../config/razorpay.js";

const sign = (secret, body) =>
  crypto.createHmac("sha256", secret).update(body).digest("hex");

const BODY = Buffer.from(JSON.stringify({ event: "payment.captured" }));
const SECRET = "whsec_unit_test_secret";

test("valid signature verifies", () => {
  const verdict = verifyRazorpayWebhook({
    secret: SECRET,
    rawBody: BODY,
    signature: sign(SECRET, BODY),
  });
  assert.equal(verdict.ok, true);
});

test("tampered body fails verification", () => {
  const verdict = verifyRazorpayWebhook({
    secret: SECRET,
    rawBody: Buffer.from(JSON.stringify({ event: "payment.failed" })),
    signature: sign(SECRET, BODY),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "invalid_signature");
});

test("wrong secret fails verification", () => {
  const verdict = verifyRazorpayWebhook({
    secret: SECRET,
    rawBody: BODY,
    signature: sign("another-secret", BODY),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "invalid_signature");
});

test("empty or whitespace secret fails closed (never verifies)", () => {
  for (const secret of ["", "   ", undefined, null]) {
    // Even a signature computed with an empty key must NOT be accepted.
    const verdict = verifyRazorpayWebhook({
      secret,
      rawBody: BODY,
      signature: sign("", BODY),
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "missing_secret");
  }
});

test("missing signature fails closed", () => {
  const verdict = verifyRazorpayWebhook({ secret: SECRET, rawBody: BODY });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "missing_signature");
});

test("empty body fails closed", () => {
  const verdict = verifyRazorpayWebhook({
    secret: SECRET,
    rawBody: Buffer.alloc(0),
    signature: sign(SECRET, Buffer.alloc(0)),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "missing_body");
});

// --- webhook secret resolution -------------------------------------------

function withPlatformSecret(value, fn) {
  const original = process.env.RAZORPAY_WEBHOOK_SECRET;
  try {
    if (value === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = value;
    return fn();
  } finally {
    if (original === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = original;
  }
}

const customShop = (webhookSecret) => ({
  _id: "shop1",
  paymentConfigured: true,
  paymentSettings: {
    razorpay: { keyId: "rzp_live_x", keySecret: "secret", webhookSecret },
  },
});

const platformShop = {
  _id: "shop2",
  paymentConfigured: false,
  paymentSettings: { razorpay: {} },
};

test("custom shop with its own webhook secret uses it", () => {
  const { secret, source } = resolveWebhookSecret(customShop("vendor-whsec"));
  assert.equal(secret, "vendor-whsec");
  assert.equal(source, "vendor");
});

test("custom shop without a webhook secret is rejected, never falls back to platform secret", () => {
  withPlatformSecret("platform-whsec", () => {
    const res = resolveWebhookSecret(customShop(""));
    assert.equal(res.secret, null);
    assert.equal(res.reason, "vendor_webhook_secret_missing");
  });
});

test("platform shop uses the platform secret when configured", () => {
  withPlatformSecret("platform-whsec", () => {
    const res = resolveWebhookSecret(platformShop);
    assert.equal(res.secret, "platform-whsec");
    assert.equal(res.source, "platform");
  });
});

test("platform shop without a platform secret is rejected", () => {
  withPlatformSecret(undefined, () => {
    const res = resolveWebhookSecret(platformShop);
    assert.equal(res.secret, null);
    assert.equal(res.reason, "platform_webhook_secret_missing");
  });
});
