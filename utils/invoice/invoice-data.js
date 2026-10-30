import { toPaise } from "../money.js";
import { computeDiscountPaise } from "../discount.js";
import {
  amountInWords,
  formatPaise,
  formatDateIst,
  formatDateTimeIst,
  formatTimeIst,
} from "./format.js";

export class InvoiceBuildError extends Error {
  constructor(reason, details) {
    super(reason);
    this.reason = reason;
    this.details = details || null;
  }
}

const IST = "Asia/Kolkata";

function verificationSource(order) {
  if (order.paymentNote === "mock") return "mock";
  if (order.razorpayPaymentId) return "razorpay";
  if (order.gatewayTxnId) return "gateway_transaction";
  if (order.transactionId) return "payment_reference";
  return "none";
}

function buildLines(order) {
  const lines = [];
  let foodSubtotalPaise = 0;

  order.items.forEach((item, index) => {
    if (item.status === "removed") return;
    const unitRatePaise = toPaise(item.price);
    const quantity = Number(item.quantity);
    if (
      unitRatePaise === null ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      throw new InvoiceBuildError("invalid_order_item");
    }
    const lineAmountPaise = unitRatePaise * quantity;
    foodSubtotalPaise += lineAmountPaise;
    lines.push({
      index: lines.length + 1,
      description: item.variantName
        ? `${item.name} (${item.variantName})`
        : item.name,
      quantity,
      unitRatePaise,
      lineAmountPaise,
      unitRateText: formatPaise(unitRatePaise),
      lineAmountText: formatPaise(lineAmountPaise),
      foodType: "",
      sourceIndex: index,
    });
  });

  return { lines, foodSubtotalPaise };
}

function buildTax(payablePaise, mapping) {
  if (mapping.taxMode !== "inclusive_breakdown") {
    return {
      taxMode: mapping.taxMode === "inclusive_breakdown" ? "inclusive_breakdown" : "none",
      taxableBasePaise: null,
      cgstPercent: null,
      cgstPaise: null,
      sgstPercent: null,
      sgstPaise: null,
      cgstText: "",
      sgstText: "",
      taxableBaseText: "",
    };
  }

  const totalRateBp = mapping.cgstRateBp + mapping.sgstRateBp;
  let taxableBasePaise = Math.round((payablePaise * 10000) / (10000 + totalRateBp));
  const cgstPaise = Math.round((taxableBasePaise * mapping.cgstRateBp) / 10000);
  const sgstPaise = Math.round((taxableBasePaise * mapping.sgstRateBp) / 10000);
  // Single deterministic correction so the breakdown sums to the payable total.
  taxableBasePaise += payablePaise - (taxableBasePaise + cgstPaise + sgstPaise);

  return {
    taxMode: "inclusive_breakdown",
    taxableBasePaise,
    cgstPercent: mapping.cgstRateBp / 100,
    cgstPaise,
    sgstPercent: mapping.sgstRateBp / 100,
    sgstPaise,
    cgstText: formatPaise(cgstPaise),
    sgstText: formatPaise(sgstPaise),
    taxableBaseText: formatPaise(taxableBasePaise),
  };
}

/**
 * Build the frozen invoice data contract from persisted documents only.
 * Throws InvoiceBuildError with a named reason when data cannot be trusted.
 */
export function buildInvoiceData({
  order,
  shop,
  customer,
  mapping,
  invoiceNumber,
  mode = "final",
  rendererVersion = 1,
  templateVersionId = "",
}) {
  if (!order || !shop || !customer) {
    throw new InvoiceBuildError("missing_documents");
  }
  if (!mapping) throw new InvoiceBuildError("missing_mapping");

  const { lines, foodSubtotalPaise } = buildLines(order);
  if (!lines.length) throw new InvoiceBuildError("no_billable_items");

  const payablePaise = toPaise(order.total);
  if (payablePaise === null || payablePaise <= 0) {
    throw new InvoiceBuildError("invalid_payable");
  }

  const discountPercent = Number(order.discountPercent) || 0;
  const persistedDiscount = Number(order.discountAmountPaise);
  const discountPaise =
    Number.isFinite(persistedDiscount) && persistedDiscount > 0
      ? Math.round(persistedDiscount)
      : computeDiscountPaise(foodSubtotalPaise, discountPercent);

  const parcelChargePaise =
    order.orderType === "parcel" ? toPaise(order.parcelCharge) || 0 : 0;

  if (discountPaise > foodSubtotalPaise) {
    throw new InvoiceBuildError("totals_mismatch", {
      reason: "discount_exceeds_subtotal",
      foodSubtotalPaise,
      discountPaise,
    });
  }

  if (foodSubtotalPaise - discountPaise + parcelChargePaise !== payablePaise) {
    throw new InvoiceBuildError("totals_mismatch", {
      foodSubtotalPaise,
      discountPaise,
      parcelChargePaise,
      payablePaise,
    });
  }

  const tax = buildTax(payablePaise, mapping);
  const taxReconciles =
    tax.taxMode !== "inclusive_breakdown" ||
    tax.taxableBasePaise + tax.cgstPaise + tax.sgstPaise === payablePaise;
  if (!taxReconciles) throw new InvoiceBuildError("tax_reconciliation_failed");

  const chargedRaw = Number(order.amountChargedPaise);
  const amountChargedPaise = Number.isFinite(chargedRaw) ? Math.round(chargedRaw) : null;
  const refundRaw = Number(order.refundAmount);
  const refundPaise =
    Number.isFinite(refundRaw) && refundRaw > 0 ? toPaise(refundRaw) : null;

  const removedItems = (order.items || [])
    .filter((item) => item.status === "removed")
    .map((item) => item.name);

  return {
    schemaVersion: 1,
    mode,
    issuedAt: new Date().toISOString(),
    invoice: {
      number: invoiceNumber,
      dateIst: formatDateIst(new Date()),
      timeIst: formatTimeIst(new Date()),
      templateVersionId: String(templateVersionId || ""),
      rendererVersion,
    },
    shop: {
      id: String(shop._id || ""),
      name: shop.name || "",
      slug: shop.slug || "",
      orderTypeLabel: order.orderType === "parcel" ? "Parcel" : "Dine In",
    },
    order: {
      id: String(order._id || ""),
      shortRef: String(order._id || "").slice(-6).toUpperCase(),
      createdAtIst: formatDateTimeIst(order.createdAt),
      collectedAtIst: formatDateTimeIst(order.collectedAt),
      pickupMethod: order.pickupMethod || "",
      pickupTimeIst: formatTimeIst(order.pickupTime),
      status: order.status,
    },
    customer: {
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
    },
    lines,
    totals: {
      foodSubtotalPaise,
      discountPercent,
      discountPaise,
      parcelChargePaise,
      ...tax,
      payablePaise,
      foodSubtotalText: formatPaise(foodSubtotalPaise),
      discountText: formatPaise(-discountPaise),
      parcelChargeText: formatPaise(parcelChargePaise),
      payableText: formatPaise(payablePaise),
      amountInWords: amountInWords(payablePaise),
    },
    payment: {
      method: order.paymentNote || "",
      note: order.paymentNote || "",
      transactionId: order.transactionId || "",
      gatewayTxnId: order.gatewayTxnId || null,
      amountChargedPaise,
      amountChargedText:
        amountChargedPaise !== null ? formatPaise(amountChargedPaise) : "",
      refundStatus: order.refundStatus || "none",
      refundPaise,
      refundText: refundPaise !== null ? formatPaise(refundPaise) : "",
      refundProcessedAtIst: formatDateTimeIst(order.refundProcessedAt),
      verificationSource: verificationSource(order),
      mock: order.paymentNote === "mock",
    },
    adjustment: {
      adjusted: Boolean(order.adjustedAt),
      adjustedAtIst: formatDateTimeIst(order.adjustedAt),
      reason: order.adjustmentReason || null,
      removedItems,
      originalTotalPaise: Number.isFinite(Number(order.originalTotal))
        ? toPaise(order.originalTotal)
        : null,
      updatedTotalPaise: Number.isFinite(Number(order.updatedTotal))
        ? toPaise(order.updatedTotal)
        : null,
    },
    constants: {
      sellerNote: mapping.constants?.sellerNote || "",
      termsText: mapping.constants?.termsText || "",
    },
    timeZone: IST,
  };
}

/** Deterministic synthetic data for the vendor's sample invoice preview. */
export function buildSampleData({ shop, mapping }) {
  const lines = [
    ["Sample Masala Dosa", 2, 9000],
    ["Sample Filter Coffee", 3, 3500],
    ["Sample Veg Sandwich (Large)", 1, 7000],
  ].map(([description, quantity, unitRatePaise], index) => ({
    index: index + 1,
    description,
    quantity,
    unitRatePaise,
    lineAmountPaise: unitRatePaise * quantity,
    unitRateText: formatPaise(unitRatePaise),
    lineAmountText: formatPaise(unitRatePaise * quantity),
    foodType: "",
    sourceIndex: index,
  }));

  const foodSubtotalPaise = lines.reduce((sum, line) => sum + line.lineAmountPaise, 0);
  const discountPercent = 10;
  const discountPaise = computeDiscountPaise(foodSubtotalPaise, discountPercent);
  const parcelChargePaise = 2000;
  const payablePaise = foodSubtotalPaise - discountPaise + parcelChargePaise;
  const tax = buildTax(payablePaise, mapping);

  return {
    schemaVersion: 1,
    mode: "sample",
    issuedAt: new Date().toISOString(),
    invoice: {
      number: "SAMPLE",
      dateIst: formatDateIst(new Date()),
      timeIst: formatTimeIst(new Date()),
      templateVersionId: "",
      rendererVersion: 1,
    },
    shop: {
      id: String(shop?._id || ""),
      name: shop?.name || "Sample Canteen",
      slug: shop?.slug || "sample",
      orderTypeLabel: "Parcel",
    },
    order: {
      id: "sample",
      shortRef: "SAMPLE",
      createdAtIst: formatDateTimeIst(new Date()),
      collectedAtIst: formatDateTimeIst(new Date()),
      pickupMethod: "qr",
      pickupTimeIst: formatTimeIst(new Date()),
      status: "completed",
    },
    customer: {
      name: "Sample Student",
      phone: "98765 43210",
      email: "sample.student@example.com",
    },
    lines,
    totals: {
      foodSubtotalPaise,
      discountPercent,
      discountPaise,
      parcelChargePaise,
      ...tax,
      payablePaise,
      foodSubtotalText: formatPaise(foodSubtotalPaise),
      discountText: formatPaise(-discountPaise),
      parcelChargeText: formatPaise(parcelChargePaise),
      payableText: formatPaise(payablePaise),
      amountInWords: amountInWords(payablePaise),
    },
    payment: {
      method: "sample",
      note: "SAMPLE",
      transactionId: "SAMPLE",
      gatewayTxnId: null,
      amountChargedPaise: payablePaise,
      amountChargedText: formatPaise(payablePaise),
      refundStatus: "none",
      refundPaise: null,
      refundText: "",
      refundProcessedAtIst: "",
      verificationSource: "sample",
      mock: false,
    },
    adjustment: {
      adjusted: false,
      adjustedAtIst: "",
      reason: null,
      removedItems: [],
      originalTotalPaise: null,
      updatedTotalPaise: null,
    },
    constants: {
      sellerNote: mapping.constants?.sellerNote || "",
      termsText: mapping.constants?.termsText || "",
    },
    timeZone: "Asia/Kolkata",
  };
}
