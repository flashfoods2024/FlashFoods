// TODO: Integrate Paytm payment gateway using shop.paymentSettings credentials.

export async function createOrder({ amount, shop }) {
  return {
    provider: "paytm",
    orderId: `mock_paytm_${Date.now()}`,
    amount: Math.round(Number(amount) * 100),
    currency: "INR",
    mock: true,
    message: "Paytm integration pending",
  };
}

export async function verifyPayment(payload) {
  return {
    success: false,
    message: "Paytm payment verification is not implemented yet.",
    mock: true,
  };
}
