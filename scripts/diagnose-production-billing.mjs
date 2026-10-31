#!/usr/bin/env node
/**
 * Read-only production diagnosis for the custom PDF invoice system.
 *
 * This script NEVER writes: no records are created, updated or deleted, no
 * invoices are generated, and no template files are uploaded. It only reads the
 * configured MongoDB database and the billing storage directory, and reports
 * which check is failing.
 *
 * Usage
 *   node scripts/diagnose-production-billing.mjs --order <24-hex-order-id>
 *   node scripts/diagnose-production-billing.mjs --order <id> --json
 *   node scripts/diagnose-production-billing.mjs --order <id> --env-file .env
 *   node scripts/diagnose-production-billing.mjs --order <id> --logs /path/app.log
 *   node scripts/diagnose-production-billing.mjs --order <id> --compare <hash>
 *
 * Run it once against the local environment and once against production and
 * compare the DATABASE FINGERPRINT lines. A different fingerprint proves the two
 * environments are talking to different endpoints (and therefore that a
 * template configured locally was never configured in production).
 *
 * Secrets: MongoDB URIs, credentials, session secrets and storage keys are
 * never printed. The fingerprint is a one-way hash of the credentials-stripped
 * connection endpoint plus the database name.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";

const argv = process.argv.slice(2);

function argValue(flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

const AS_JSON = argv.includes("--json");
const ORDER_ID = argValue("--order");
const LOG_FILE = argValue("--logs");
const ENV_FILE = argValue("--env-file");
const COMPARE = argValue("--compare");

/** One-way, credentials-free identifier for the configured endpoint. */
function endpointFingerprint(uri) {
  if (!uri) return null;
  try {
    // Strip the entire userinfo section before hashing so a password can never
    // be recovered from the fingerprint.
    const stripped = String(uri).replace(/\/\/[^@/]*@/, "//");
    return crypto.createHash("sha256").update(stripped).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/** Host with the identifying labels masked, keeping only the public suffix. */
function redactHost(uri) {
  try {
    const practice = String(uri).replace(/^mongodb(\+srv)?:\/\//, "http://");
    const host = new URL(practice).hostname;
    if (
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      host.includes(":") ||
      host.startsWith("[")
    ) {
      return "***";
    }
    const labels = host.split(".");
    if (labels.length <= 2) return `***.${labels[labels.length - 1]}`;
    // Keep only the public suffix (mongodb.net, com): the cluster/shard label
    // identifies the deployment, which is what must not be pasted into a ticket.
    return `***.${labels.slice(-2).join(".")}`;
  } catch {
    return "***";
  }
}

function redactDbName(uri) {
  try {
    const practice = String(uri).replace(/^mongodb(\+srv)?:\/\//, "http://");
    const name = new URL(practice).pathname.replace(/^\//, "");
    return name || "(driver default)";
  } catch {
    return "(unknown)";
  }
}

function shortHash(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function maskStorageKey(key) {
  if (!key) return null;
  // Keep the category prefix (invoices/<shop>/...) so the failing bucket is
  // visible, but hash the file name so no customer-identifying path leaks.
  const parts = String(key).split("/");
  const prefix = parts.slice(0, 2).join("/");
  return `${prefix}/<sha256:${shortHash(key)}>`;
}

function platformHints() {
  const hints = {};
  const keys = [
    "RENDER",
    "RENDER_SERVICE_ID",
    "VERCEL",
    "FLY_APP_NAME",
    "DYNO",
    "K_SERVICE",
    "RAILWAY_ENVIRONMENT",
    "AWS_LAMBDA_FUNCTION_NAME",
    "HEROKU_APP_NAME",
  ];
  for (const key of keys) {
    if (process.env[key]) hints[key] = true;
  }
  return hints;
}

function line(label, value) {
  return `${label.padEnd(46)} ${value}`;
}

function emit(report, code) {
  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    renderReport(report);
  }
  process.exitCode = code;
}

function renderReport(report) {
  const out = [];
  const heading = (text) => {
    out.push("");
    out.push("=".repeat(72));
    out.push(text);
    out.push("=".repeat(72));
  };

  heading("A. ENVIRONMENT FINGERPRINTS");
  for (const [key, value] of Object.entries(report.environment)) {
    out.push(line(key, value === null ? "(none)" : String(value)));
  }

  if (COMPARE) {
    const same = COMPARE === report.environment.databaseFingerprint;
    out.push(
      line(
        "Compare with supplied fingerprint",
        same
          ? "MATCH — same endpoint and database"
          : "MISMATCH — different endpoint or database",
      ),
    );
  }

  if (report.order) {
    heading("B. ORDER");
    for (const [key, value] of Object.entries(report.order)) {
      out.push(line(key, value === null ? "(none)" : String(value)));
    }
  }

  heading("C. INVOICE RECORD");
  for (const [key, value] of Object.entries(report.invoice)) {
    out.push(line(key, value === null ? "(none)" : String(value)));
  }

  heading("D. ACTIVE TEMPLATE LOOKUP (findActiveVersion)");
  const checks = report.template?.checks;
  if (!checks) {
    // Inspection stopped before the template lookup (no connection, unknown
    // order or missing configuration). Say so instead of printing empty tables.
    out.push(line("Template lookup", "not evaluated (inspection stopped earlier)"));
  } else {
    out.push(line("Check", "Result"));
    out.push("-".repeat(72));
    for (const [check, result] of Object.entries(checks)) {
      out.push(line(check, result ? "PASS" : "FAIL"));
    }
    out.push(line("Resolver verdict", report.template.resolution));
    out.push(line("getBillingCardState().state", report.template.cardState));
    out.push(
      line("Card/resolver consistent", report.template.consistent ? "YES" : "NO"),
    );
  }

  if (report.logs) {
    heading("E. APPLICATION LOG LINES");
    if (!report.logs.readable) {
      out.push(`Could not read log file: ${report.logs.error}`);
    } else {
      out.push(line("Matched lines", report.logs.matched));
      for (const entry of report.logs.lines) out.push(`  ${entry}`);
    }
  }

  heading("ROOT CAUSE SIGNAL");
  out.push(report.verdict);

  process.stdout.write(`${out.join("\n")}\n`);
}

async function readLogEvidence(orderId) {
  if (!LOG_FILE) return null;
  try {
    const text = await fs.readFile(LOG_FILE, "utf8");
    const needles = [String(orderId), "[billing] invoice not issued", "[billing] invoice issuance failed"];
    const matches = text
      .split("\n")
      .filter((entry) => needles.some((needle) => entry.includes(needle)))
      .slice(-50)
      // Never echo connection strings or absolute storage paths from logs.
      .map((entry) =>
        entry
          .replace(/mongodb(\+srv)?:\/\/\S+/gi, "mongodb://<redacted>")
          .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "<redacted-email>")
          .slice(0, 400),
      );
    return { readable: true, matched: matches.length, lines: matches };
  } catch (err) {
    return { readable: false, error: err?.code || "read_failed", matched: 0, lines: [] };
  }
}

async function main() {
  if (!ORDER_ID) {
    process.stderr.write(
      "A full MongoDB order ID is required.\n" +
        "  node scripts/diagnose-production-billing.mjs --order <24-hex-order-id>\n" +
        "Do not derive it from the six-character display code.\n",
    );
    process.exitCode = 1;
    return;
  }
  if (!mongoose.isValidObjectId(ORDER_ID)) {
    process.stderr.write("That is not a valid full MongoDB ObjectId (expected 24 hex characters).\n");
    process.exitCode = 1;
    return;
  }

  if (ENV_FILE) {
    const dotenv = (await import("dotenv")).default;
    dotenv.config({ path: path.resolve(ENV_FILE) });
  }

  const { storageConfig, storageStatus, fileStatus } = await import(
    "../utils/invoice/storage.js"
  );
  const { evaluateEligibility, resolveActiveTemplate } = await import(
    "../utils/invoice/invoice-resolver.js"
  );
  const { getBillingCardState } = await import("../utils/invoice/template-service.js");
  const { sha256 } = await import("../utils/invoice/canonical.js");
  const { Order } = await import("../models/Order.js");
  const { Invoice } = await import("../models/Invoice.js");
  const { Shop } = await import("../models/Shop.js");

  const mongoDbUri = String(process.env.MONGODB_URI || "").trim();
  const mongoUri = String(process.env.MONGO_URI || "").trim();
  const selectedVar = mongoDbUri ? "MONGODB_URI" : mongoUri ? "MONGO_URI" : "(none)";
  const selectedUri = mongoDbUri || mongoUri;
  const fallback = !selectedUri;

  const environment = {
    nodeEnv: process.env.NODE_ENV || "(unset)",
    mongodbVariableSelected: selectedVar,
    mongodbUriConfigured: Boolean(mongoDbUri),
    mongoUriConfigured: Boolean(mongoUri),
    bothConfigured: Boolean(mongoDbUri && mongoUri),
    bothDiffer: Boolean(mongoDbUri && mongoUri && mongoDbUri !== mongoUri),
    endpointHost: selectedUri ? redactHost(selectedUri) : "(none)",
    databaseName: selectedUri ? redactDbName(selectedUri) : "(none)",
    databaseFingerprint: endpointFingerprint(selectedUri),
    fallsBackToLocalhost: fallback,
  };

  const billingStorage = storageConfig();
  const storage = await storageStatus();
  environment.billingStorageDirConfigured = billingStorage.configured;
  environment.billingStoragePath = storage.dir;
  // Reported for the machine running this script; the serving process may be
  // deployed with a different working directory or mount.
  environment.billingStorageExists = storage.exists;
  environment.billingStorageWritable = storage.writable;
  environment.billingStorageError = storage.errorCode || null;
  environment.billingStoragePersistent = "unknown — verify the host mount; a container-local path is lost on redeploy";
  environment.workingDirectory = process.cwd();
  environment.platformHints = Object.keys(platformHints());

  const baseReport = {
    environment,
    order: null,
    invoice: {},
    template: {},
    logs: null,
    verdict: "",
  };

  if (fallback) {
    baseReport.verdict =
      "No MongoDB URI is configured, so this run would inspect a local database. Set MONGODB_URI to the environment under diagnosis.";
    emit(baseReport, 1);
    return;
  }

  mongoose.set("bufferCommands", false);
  try {
    await mongoose.connect(selectedUri, {
      serverSelectionTimeoutMS: 12000,
      socketTimeoutMS: 30000,
    });
  } catch (err) {
    baseReport.verdict = `Could not connect to MongoDB (${err?.name || "error"}). No data was read or changed.`;
    emit(baseReport, 1);
    return;
  }

  try {
    const connection = mongoose.connection;
    baseReport.environment.connectedDatabaseName = connection.name;
    baseReport.environment.connectedHost = connection.host
      ? redactHost(`mongodb://${connection.host}`)
      : "(unknown)";

    const order = await Order.findById(ORDER_ID).lean();
    if (!order) {
      baseReport.verdict = "The order does not exist in this database — wrong environment or wrong ID.";
      emit(baseReport, 1);
      return;
    }

    const shop = await Shop.findById(order.shop).select("name slug").lean();
    const eligibility = evaluateEligibility(order);
    baseReport.order = {
      orderFound: true,
      orderId: String(order._id),
      shopObjectId: String(order.shop),
      shopSlug: shop?.slug || "(shop document missing)",
      status: order.status,
      collectedAtPresent: Boolean(order.collectedAt),
      pickupMethod: order.pickupMethod || "(none)",
      amountChargedPaiseValidPositive:
        Number.isFinite(Number(order.amountChargedPaise)) && Number(order.amountChargedPaise) > 0,
      paymentNoteIsMock: order.paymentNote === "mock",
      payableTotalPositive: eligibility.ok
        ? eligibility.payablePaise > 0
        : null,
      eligibility: eligibility.ok ? "ELIGIBLE" : `NOT ELIGIBLE (${eligibility.reason})`,
    };

    const invoice = await Invoice.findOne({ order: order._id }).lean();
    if (!invoice) {
      baseReport.invoice = { invoiceRecordExists: false };
    } else {
      const file = await fileStatus(invoice.storageKey);
      let signatureValid = null;
      let checksumMatches = null;
      let actualSize = null;
      let readError = null;
      if (file.exists) {
        actualSize = file.size;
        try {
          const bytes = await fs.readFile(path.resolve(storageConfig().dir, invoice.storageKey));
          signatureValid = bytes.subarray(0, 5).toString() === "%PDF-";
          checksumMatches = sha256(bytes) === invoice.outputSha256;
        } catch (err) {
          readError = err?.code || "read_failed";
        }
      }
      baseReport.invoice = {
        invoiceRecordExists: true,
        invoiceId: String(invoice._id),
        invoiceNumber: invoice.number,
        invoiceShopId: String(invoice.shop),
        shopMatchesOrder: String(invoice.shop) === String(order.shop),
        customerMatchesOrder: String(invoice.customer) === String(order.customer),
        storageKeyMasked: maskStorageKey(invoice.storageKey),
        storedByteSize: invoice.byteSize,
        outputSha256: invoice.outputSha256
          ? `${invoice.outputSha256.slice(0, 16)}…`
          : null,
        pdfExistsOnDisk: file.exists,
        actualFileSize: actualSize,
        storageErrorCode: file.errorCode || readError || null,
        pdfSignatureValid: signatureValid,
        checksumMatchesRecord: checksumMatches,
      };
    }

    const template = await resolveActiveTemplate(order.shop, { verifyTemplateSha: true });
    const card = await getBillingCardState(order.shop).catch((err) => ({
      state: `error:${err?.message || "unknown"}`,
    }));
    const resolverUsable = Boolean(template.ok);
    const cardSaysActive = card.state === "active";
    baseReport.template = {
      checks: {
        "InvoiceTemplate record exists for order.shop": template.checks.templateFound,
        "Template shop ID matches order.shop": template.checks.shopMatches,
        "currentVersionId exists": template.checks.currentVersionSet,
        "Matching version exists": template.checks.versionFound,
        "Matching version status is exactly active": template.checks.versionActive,
        "Version mapping exists": template.checks.mappingPresent,
        "Mapping passes validation": template.checks.mappingValid,
        "Original template PDF exists in storage": template.checks.originalFilePresent,
        "Template SHA-256 matches stored metadata": template.checks.templateShaMatches,
      },
      resolution: resolverUsable ? "USABLE" : `UNUSABLE (${template.reason})`,
      cardState: card.state,
      consistent: cardSaysActive === resolverUsable,
    };

    baseReport.logs = await readLogEvidence(ORDER_ID);

    // Verdict: distinguish "never issued" from "issued but unreadable".
    if (baseReport.invoice.invoiceRecordExists) {
      if (baseReport.invoice.pdfExistsOnDisk && baseReport.invoice.checksumMatchesRecord) {
        baseReport.verdict =
          "Invoice record and PDF are intact. If the student still sees a failure, the serving process is reading a different storage directory or is not this database.";
      } else if (!baseReport.invoice.pdfExistsOnDisk) {
        baseReport.verdict =
          "CAUSE B: the Invoice record exists but its PDF is missing from this storage path. Issuance happened elsewhere (ephemeral filesystem, different mount, or a different instance).";
      } else {
        baseReport.verdict =
          "CAUSE B: the stored PDF exists but failed integrity checks (signature or checksum). Do not re-render; restore the original file.";
      }
    } else if (!eligibility.ok) {
      baseReport.verdict = `No invoice and the order fails eligibility (${eligibility.reason}), so issuance was correctly skipped.`;
    } else if (!template.ok) {
      baseReport.verdict = `CAUSE A: no usable active template for this shop (${template.reason}). Issuance cannot start.`;
    } else {
      baseReport.verdict =
        "Order is eligible and the template is usable, but no invoice exists — issuance was never attempted (check pickup completion logs).";
    }

    emit(baseReport, baseReport.verdict.startsWith("Invoice record and PDF are intact") ? 0 : 2);
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

await main();
