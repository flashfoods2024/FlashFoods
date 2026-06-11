// TODO: Integrate PhonePe payment gateway using shop.paymentSettings credentials.

export async function createOrder({ amount, shop }) {
  return {
    provider: "phonepe",
    orderId: `mock_phonepe_${Date.now()}`,
    amount: Math.round(Number(amount) * 100),
    currency: "INR",
    mock: true,
    message: "PhonePe integration pending",
  };
}

export async function verifyPayment(payload) {
  return {
    success: false,
    message: "PhonePe payment verification is not implemented yet.",
    mock: true,
  };
}
