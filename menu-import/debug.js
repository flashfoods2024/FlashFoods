import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEBUG_ROOT = path.resolve(__dirname, "..", "temp", "debug");

if (!fs.existsSync(DEBUG_ROOT)) {
  fs.mkdirSync(DEBUG_ROOT, { recursive: true });
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}${mo}${dd}-${h}${mi}${s}`;
}

function safeWrite(filePath, content) {
  try {
    if (typeof content === "object") {
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf-8");
    } else {
      fs.writeFileSync(filePath, String(content), "utf-8");
    }
  } catch {
    // never crash the main flow
  }
}

export class DebugSession {
  constructor(filePath) {
    console.log("[MARK-debug] DebugSession constructor — filePath:", filePath);
    this._dir = null;
    this._report = {
      finishReason: null,
      usageMetadata: null,
      responseLength: null,
      parserStage: null,
      recoveryMethod: null,
      success: false,
      failureReason: null,
    };

    try {
      this._dir = path.join(DEBUG_ROOT, timestamp());
      console.log("[MARK-debug] mkdirSync:", this._dir);
      fs.mkdirSync(this._dir, { recursive: true });
      if (filePath && fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const dest = path.join(this._dir, `image${ext}`);
        console.log("[MARK-debug] copyFileSync:", filePath, "->", dest);
        fs.copyFileSync(filePath, dest);
        console.log("[MARK-debug] copyFileSync done");
      }
    } catch (err) {
      console.log("[MARK-debug] constructor CATCH — err:", err?.message);
      this._dir = null;
    }
  }

  get dir() {
    return this._dir;
  }

  saveRequest(requestBody, apiKey) {
    console.log("[MARK-debug] saveRequest");
    if (!this._dir) return;
    try {
      const redacted = JSON.parse(JSON.stringify(requestBody));
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";
      safeWrite(
        path.join(this._dir, "request.json"),
        JSON.stringify({ url, headers: { "Content-Type": "application/json" }, body: redacted }, null, 2),
      );
      console.log("[MARK-debug] saveRequest done");
    } catch (err) {
      console.log("[MARK-debug] saveRequest CATCH:", err?.message);
    }
  }

  saveResponse(responseData) {
    console.log("[MARK-debug] saveResponse");
    if (!this._dir) return;
    safeWrite(path.join(this._dir, "response.json"), responseData);
    console.log("[MARK-debug] saveResponse done");
  }

  saveCandidateText(text) {
    console.log("[MARK-debug] saveCandidateText — length:", text.length);
    if (!this._dir) return;
    safeWrite(path.join(this._dir, "candidate.txt"), text);
    console.log("[MARK-debug] saveCandidateText done");
  }

  saveParsed(parsed) {
    console.log("[MARK-debug] saveParsed");
    if (!this._dir) return;
    safeWrite(path.join(this._dir, "parsed.json"), parsed);
    console.log("[MARK-debug] saveParsed done");
  }

  saveRecovered(recovered) {
    console.log("[MARK-debug] saveRecovered");
    if (!this._dir) return;
    safeWrite(path.join(this._dir, "recovered.json"), recovered);
    console.log("[MARK-debug] saveRecovered done");
  }

  setReportField(key, value) {
    this._report[key] = value;
  }

  finalize() {
    console.log("[MARK-debug] finalize — dir:", this._dir);
    if (!this._dir) return;
    safeWrite(path.join(this._dir, "parse-report.txt"), this._formatReport());
    console.log("[MARK-debug] finalize done");
  }

  _formatReport() {
    const r = this._report;
    const lines = [
      "=== Gemini Extraction Debug Report ===",
      "",
      `finishReason: ${r.finishReason || "N/A"}`,
      `usageMetadata: ${r.usageMetadata ? JSON.stringify(r.usageMetadata) : "N/A"}`,
      `responseLength: ${r.responseLength !== null ? r.responseLength + " chars" : "N/A"}`,
      `parserStage: ${r.parserStage || "N/A"}`,
      `recoveryMethod: ${r.recoveryMethod || "N/A"}`,
      `success: ${r.success}`,
      `failureReason: ${r.failureReason || "N/A"}`,
      "",
    ];
    return lines.join("\n");
  }
}
