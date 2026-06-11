// TODO: Integrate CCAvenue payment gateway using shop.paymentSettings credentials.

export async function createOrder({ amount, shop }) {
  return {
    provider: "ccavenue",
    orderId: `mock_ccavenue_${Date.now()}`,
    amount: Math.round(Number(amount) * 100),
    currency: "INR",
    mock: true,
    message: "CCAvenue integration pending",
  };
}

export async function verifyPayment(payload) {
  return {
    success: false,
    message: "CCAvenue payment verification is not implemented yet.",
    mock: true,
  };
}
