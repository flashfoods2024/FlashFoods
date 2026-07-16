export function computeParcelCharge(shop, orderType) {
  if (!shop) return 0;
  if (orderType !== "parcel") return 0;
  if (!shop.parcelChargeEnabled) return 0;
  return Math.max(0, Number(shop.parcelCharge) || 0);
}

export function computeOrderTotal(foodTotal, shop, orderType) {
  return foodTotal + computeParcelCharge(shop, orderType);
}
