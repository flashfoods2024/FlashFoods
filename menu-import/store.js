/**
 * In-memory staging store for menu import sessions.
 *
 * Holds uploaded file metadata and staged results WITHOUT writing to MongoDB.
 * Future OCR/PDF/AI parsers will write their results into this store.
 * A TTL sweep could be added later for production use.
 */

const sessions = new Map();

/**
 * @param {string} id – Unique import session ID
 * @param {object} data – Session payload
 *   .filePath    – Absolute path to the temp file
 *   .fileName    – Original file name
 *   .fileSize    – File size in bytes
 *   .mimeType    – Detected MIME type
 *   .vendorId    – The vendor this import belongs to
 *   .shopId      – The shop the items will be added to
 *   .status      – 'uploaded' | 'validating' | 'ready' | 'processing' | 'complete' | 'error'
 *   .parsed      – Array of parsed items (populated by OCR/parser later)
 *   .errors      – Array of validation/parse errors
 *   .createdAt   – ISO timestamp
 */
export function setSession(id, data) {
  sessions.set(id, { ...data, createdAt: new Date().toISOString() });
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function updateSession(id, patch) {
  const existing = sessions.get(id);
  if (existing) {
    sessions.set(id, { ...existing, ...patch });
  }
}

export function removeSession(id) {
  sessions.delete(id);
}

export function hasSession(id) {
  return sessions.has(id);
}
