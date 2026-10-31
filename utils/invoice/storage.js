import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Private document storage for billing templates and generated invoices.
// Files live outside public/ and are only read through authorized routes.
export function storageRoot() {
  return path.resolve(process.env.BILLING_STORAGE_DIR || "storage");
}

/**
 * Explicit storage configuration. `configured` is false when the process is
 * silently relying on the relative "./storage" default, which is only durable
 * when the working directory itself is persistent and shared by every instance.
 */
export function storageConfig() {
  const configured = String(process.env.BILLING_STORAGE_DIR || "").trim();
  return {
    configured: Boolean(configured),
    dir: path.resolve(configured || "storage"),
  };
}

/** Backend health for startup logs and diagnostics. Contains no secrets. */
export async function storageStatus() {
  const config = storageConfig();
  let exists = false;
  let writable = false;
  let errorCode = null;
  try {
    const stat = await fs.stat(config.dir);
    exists = stat.isDirectory();
  } catch (err) {
    errorCode = err?.code || "UNKNOWN";
  }
  if (exists) {
    try {
      await fs.access(config.dir, fsConstants.W_OK);
      writable = true;
    } catch (err) {
      errorCode = err?.code || "UNKNOWN";
    }
  }
  return { ...config, exists, writable, errorCode };
}

/** Normalized filesystem/object-storage failure, safe to log. */
export function describeStorageError(err) {
  return {
    code: err?.code || "UNKNOWN",
    message: String(err?.message || "storage failure").slice(0, 200),
  };
}

function resolveKey(key) {
  const root = storageRoot();
  const abs = path.resolve(root, key);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Invalid storage key.");
  }
  return abs;
}

export async function putFile(key, bytes) {
  const abs = resolveKey(key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${crypto.randomUUID()}`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, abs);
  return key;
}

export async function getFile(key) {
  return fs.readFile(resolveKey(key));
}

export async function fileExists(key) {
  try {
    await fs.access(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

/** Existence, size and the raw error code without throwing. */
export async function fileStatus(key) {
  let abs;
  try {
    abs = resolveKey(key);
  } catch {
    return { exists: false, size: 0, errorCode: "INVALID_KEY" };
  }
  try {
    const stat = await fs.stat(abs);
    return { exists: stat.isFile(), size: stat.size, errorCode: null };
  } catch (err) {
    return { exists: false, size: 0, errorCode: err?.code || "UNKNOWN" };
  }
}

export function templateDir(shopId, templateId) {
  return `templates/${shopId}/${templateId}`;
}

export function templateKey(shopId, templateId, version, sha256) {
  return `${templateDir(shopId, templateId)}/v${version}-${sha256}.pdf`;
}

export function invoiceKey(shopId, invoiceId, sha256) {
  return `invoices/${shopId}/${invoiceId}/${sha256}.pdf`;
}

export function previewDir(shopId, templateId) {
  return `previews/${shopId}/${templateId}`;
}

export function previewKey(shopId, templateId, version, mappingHash) {
  return `${previewDir(shopId, templateId)}/v${version}-${mappingHash}.pdf`;
}

/** Every stored file below a directory, as absolute paths. Missing = empty. */
async function walkFiles(directory, out = []) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return out;
    throw err;
  }
  for (const entry of entries) {
    const abs = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkFiles(abs, out);
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

/**
 * Delete stored files below `prefix` except the keys listed in `keep`.
 *
 * Only paths inside storageRoot() are ever touched: the directory is resolved
 * through resolveKey() (which rejects traversal) and the walk never leaves it.
 * A missing directory is not an error, so cleanup is safe to repeat. Keys are
 * compared against the storage key form (`a/b/c.pdf`), not caller strings.
 */
export async function sweepFiles(prefix, { keep = [] } = {}) {
  const keepSet = new Set(keep.map((key) => String(key ?? "")).filter(Boolean));
  const removed = [];
  const errorCodes = [];

  let directory;
  try {
    directory = resolveKey(prefix);
  } catch {
    return { removed, errorCodes: ["INVALID_KEY"] };
  }

  let files;
  try {
    files = await walkFiles(directory);
  } catch (err) {
    return { removed, errorCodes: [err?.code || "UNKNOWN"] };
  }

  const root = storageRoot();
  for (const abs of files) {
    const key = path.relative(root, abs).split(path.sep).join("/");
    if (keepSet.has(key)) continue;
    try {
      await fs.unlink(abs);
      removed.push(key);
    } catch (err) {
      if (err?.code !== "ENOENT") errorCodes.push(err?.code || "UNKNOWN");
    }
  }

  return { removed, errorCodes };
}
