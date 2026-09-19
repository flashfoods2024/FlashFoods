import test from "node:test";
import assert from "node:assert/strict";
import {
  sendWithRetry,
  extractInvalidTokens,
} from "../../utils/notification-dispatch.js";

// Regression for the ReferenceError: `invalidTokens` used to be declared inside
// the `if (response.failureCount > 0)` block but referenced on the success path.
// The thrown ReferenceError was swallowed by the catch and triggered pointless
// retries, so the send call happened multiple times. It must happen exactly once.
test("success path does not throw and does not retry", async () => {
  let calls = 0;
  const messaging = {
    async sendEachForMulticast() {
      calls++;
      return {
        successCount: 2,
        failureCount: 0,
        responses: [{ success: true }, { success: true }],
      };
    },
  };

  await assert.doesNotReject(() =>
    sendWithRetry(
      ["token-1", "token-2"],
      { title: "New Order", body: "₹100 — 2 item(s)", icon: "/icons/i.png" },
      { tag: "flashfoods-new-order-1", click_action: "/vendor/orders/pending" },
      0,
      messaging,
    ),
  );

  assert.equal(calls, 1, "successful send must not be retried");
});

test("extractInvalidTokens classifies permanent failures only", () => {
  const tokens = ["a", "b", "c", "d"];
  const response = {
    responses: [
      { success: true },
      {
        success: false,
        error: { code: "messaging/registration-token-not-registered" },
      },
      { success: false, error: { code: "messaging/server-unavailable" } },
      { success: false, error: { code: "messaging/invalid-registration-token" } },
    ],
  };

  assert.deepEqual(extractInvalidTokens(response, tokens), ["b", "d"]);
});

test("extractInvalidTokens tolerates empty/missing responses", () => {
  assert.deepEqual(extractInvalidTokens({ responses: [] }, []), []);
  assert.deepEqual(extractInvalidTokens({}, ["a"]), []);
  assert.deepEqual(extractInvalidTokens(null, ["a"]), []);
});
