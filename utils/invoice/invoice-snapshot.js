import { hashJson } from "./canonical.js";

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}

/** Freeze the invoice data plus its provenance into an immutable snapshot. */
export function buildSnapshot({ data, template, renderer, eligibility }) {
  return deepFreeze({
    ...data,
    template: {
      versionId: String(template?.versionId || ""),
      version: template?.version || null,
      sha256: template?.sha256 || "",
      mappingHash: template?.mappingHash || "",
      page: template?.page ?? 0,
    },
    renderer: {
      version: renderer?.version || 1,
      fontSha256: renderer?.fontSha256 || {},
    },
    eligibility: {
      verificationSource: eligibility?.verificationSource || "none",
      checkedAt: eligibility?.checkedAt || new Date().toISOString(),
    },
  });
}

export function attachOutput(snapshot, output) {
  return deepFreeze({
    ...snapshot,
    output: {
      sha256: output.sha256,
      byteSize: output.byteSize,
      pageCount: output.pageCount,
    },
  });
}

export function snapshotHash(snapshot) {
  return hashJson(snapshot);
}
