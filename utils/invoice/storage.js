import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// Private document storage for billing templates and generated invoices.
// Files live outside public/ and are only read through authorized routes.
export function storageRoot() {
  return path.resolve(process.env.BILLING_STORAGE_DIR || "storage");
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

export function templateKey(shopId, templateId, version, sha256) {
  return `templates/${shopId}/${templateId}/v${version}-${sha256}.pdf`;
}

export function invoiceKey(shopId, invoiceId, sha256) {
  return `invoices/${shopId}/${invoiceId}/${sha256}.pdf`;
}

export function previewKey(shopId, templateId, version, mappingHash) {
  return `previews/${shopId}/${templateId}/v${version}-${mappingHash}.pdf`;
}
