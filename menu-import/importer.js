/**
 * Menu import orchestrator.
 *
 * Coordinates the import pipeline:
 *   1. Receive uploaded file       → upload.js (multer)
 *   2. Validate file               → validator.js
 *   3. Stage in temp store          → store.js   (no MongoDB)
 *   4. Parse / OCR (future)        → parser plugin
 *   5. Build preview                → preview.js
 *   6. Confirm & persist (future)  → admin confirms → MenuItem.create()
 *
 * Every step is a separate module.  New parsers (OCR, PDF, Excel, AI)
 * only need to implement step 4 and register here.
 */

import { setSession, getSession, updateSession, removeSession } from "./store.js";
import { validateImportFile } from "./validator.js";
import { buildPreview } from "./preview.js";
import crypto from "crypto";
import fs from "fs";

/**
 * Stages an uploaded file for import without writing to MongoDB.
 *
 * @param {object}  file      – Multer file object
 * @param {string}  vendorId  – Target vendor ObjectId
 * @param {string}  shopId    – Target shop ObjectId
 * @returns {{ importId: string, session: object }}
 */
export async function stageImport(file, vendorId, shopId) {
  const validation = validateImportFile(file);
  if (!validation.valid) {
    throw new ImportError(validation.errors.join(" "));
  }

  const importId = crypto.randomUUID();

  setSession(importId, {
    filePath: file.path,
    fileName: file.originalname,
    fileSize: file.size,
    mimeType: file.mimetype,
    vendorId,
    shopId,
    status: "uploaded",
    parsed: null,
    preview: null,
    errors: [],
  });

  return { importId, session: getSession(importId) };
}

/**
 * Returns the current state of a staged import.
 *
 * @param {string} importId
 * @returns {object|null}
 */
export function getImport(importId) {
  return getSession(importId);
}

/**
 * Updates the status of a staged import.
 */
export function markProcessing(importId) {
  updateSession(importId, { status: "processing" });
}

export function markReady(importId, parsedItems) {
  const preview = buildPreview(parsedItems);
  updateSession(importId, { status: "ready", parsed: parsedItems, preview });
}

export function markError(importId, errorMessage) {
  const session = getSession(importId);
  const errors = [...(session?.errors || []), errorMessage];
  updateSession(importId, { status: "error", errors });
}

/**
 * Cleans up a staged import (temp file + session).
 */
export function discardImport(importId) {
  const session = getSession(importId);
  if (session?.filePath) {
    fs.unlink(session.filePath, () => {});
  }
  removeSession(importId);
}

class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportError";
  }
}
