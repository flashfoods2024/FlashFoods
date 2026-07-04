import fs from "fs";
import path from "path";
import { safeParse } from "./json-recovery.js";
import { DebugSession } from "./debug.js";

// const GEMINI_API_URL =
//   "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_CONFIDENCE = 0.85;

const MIME_MAP = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const EXTRACTION_PROMPT = `Extract every menu item from this restaurant menu image.

Return ONLY valid JSON using this exact structure:
{"items":[{"name":"","description":"","category":"","foodType":"veg|non-veg|egg|unknown","variants":[{"label":"Regular","price":0}],"confidence":0.95}]}

RULES:
- Extract EVERY item. Do not skip any.
- foodType: use only "veg", "non-veg", "egg", or "unknown". NEVER guess — use "unknown" if not indicated.
- variants: if the menu shows multiple sizes/prices (e.g. Half/Full, S/M/L), add one variant per size. If only one price, use label "Regular".
- description: use "" if none shown.
- category: use the section heading exactly as shown. If no headings, group similar items.
- confidence: 0.0–1.0 based on readability.
- Preserve original spelling and capitalization.
- If no menu items are visible, return {"items":[]}.`;

function getMimeType(ext) {
  return MIME_MAP[ext] || "image/jpeg";
}

function isRelevantFinishReason(finishReason) {
  const terminal = ["STOP", "MAX_TOKENS"];
  return terminal.includes(finishReason);
}

const VALID_FOOD_TYPES = ["veg", "non-veg", "egg", "unknown"];

function normalizePrice(value) {
  if (value == null) return 0;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 100) / 100 : 0;
}

function normalizeConfidence(value) {
  if (value == null) return DEFAULT_CONFIDENCE;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 && num <= 1 ? num : DEFAULT_CONFIDENCE;
}

function normalizeFoodType(value) {
  const raw = String(value || "").trim().toLowerCase();
  return VALID_FOOD_TYPES.includes(raw) ? raw : "unknown";
}

function normalizeVariants(rawVariants) {
  if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
    return [{ label: "Regular", price: 0 }];
  }

  return rawVariants
    .filter((v) => v && typeof v === "object")
    .map((v) => ({
      label: String(v.label || "Regular").trim() || "Regular",
      price: normalizePrice(v.price),
    }));
}

function validateAndNormalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const variants = normalizeVariants(item.variants);

      return {
        name: String(item.name || "").trim(),
        description: String(item.description || "").trim(),
        category: String(item.category || "Uncategorized").trim(),
        foodType: normalizeFoodType(item.foodType),
        variants,
        confidence: normalizeConfidence(item.confidence),
        _tempIndex: index,
      };
    })
    .filter((item) => item.name.length > 0);
}

export async function extractMenu(filePath) {
  console.log("[MARK-vision] extractMenu start — filePath:", filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    console.log("[MARK-vision] unsupported extension:", ext);
    return {
      items: [],
      rawText: "",
      metadata: {
        error: `Unsupported file type "${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}.`,
        provider: "gemini-vision",
      },
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[MARK-vision] no API key");
    return {
      items: [],
      rawText: "",
      metadata: {
        error: "GEMINI_API_KEY is not configured. Add it to .env and restart.",
        provider: "gemini-vision",
      },
    };
  }

  let imageBuffer;
  try {
    imageBuffer = fs.readFileSync(filePath);
    console.log("[MARK-vision] file read — size:", imageBuffer.length);
  } catch (readErr) {
    console.error("=== [MARK-vision] file read FAILED ===");
    console.error("Error message:", readErr.message || readErr);
    console.error("Full stack:", readErr instanceof Error ? readErr.stack : "(no stack)");
    return {
      items: [],
      rawText: "",
      metadata: {
        error: "Could not read the uploaded file. It may have been moved or deleted.",
        provider: "gemini-vision",
      },
    };
  }

  if (imageBuffer.length === 0) {
    console.log("[MARK-vision] empty file");
    return {
      items: [],
      rawText: "",
      metadata: { error: "Uploaded file is empty.", provider: "gemini-vision" },
    };
  }

  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    console.log("[MARK-vision] file too large:", imageBuffer.length);
    return {
      items: [],
      rawText: "",
      metadata: {
        error: "File exceeds 10 MB limit for AI processing.",
        provider: "gemini-vision",
      },
    };
  }

  console.log("[MARK-vision] readFileSync done — building request body");
  const base64 = imageBuffer.toString("base64");
  const mimeType = getMimeType(ext);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const requestBody = {
    contents: [
      {
        parts: [
          { text: EXTRACTION_PROMPT },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95,
      maxOutputTokens: 65536,
    },
  };

  console.log("[MARK-vision] DebugSession constructor");
  const debug = new DebugSession(filePath);
  console.log("[MARK-vision] DebugSession dir:", debug.dir);
  console.log("[MARK-vision] saveRequest");
  debug.saveRequest(requestBody, apiKey);
  console.log("[MARK-vision] saveRequest done — entering try block");

  try {
    console.log("[MARK-vision] before fetch — sending Gemini request");
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    console.log("[MARK-vision] after fetch — status:", response.status);
    console.log("[MARK-vision] status text:", response.statusText);
    const rawBody = await response.text();
    console.log("[MARK-vision] raw response body:", rawBody);
    try {
      console.log("[MARK-vision] pretty-printed body:", JSON.stringify(JSON.parse(rawBody), null, 2));
    } catch {
      console.log("[MARK-vision] body is not JSON");
    }

    if (!response.ok) {
      console.log("[MARK-vision] HTTP error:", response.status);
      const isRateLimit = response.status === 429;
      const errorBody = rawBody;
      try { debug.saveResponse(JSON.parse(errorBody)); } catch { debug.saveResponse(errorBody); }
      debug.setReportField("failureReason", isRateLimit
        ? "AI provider rate limit exceeded."
        : `HTTP ${response.status}: ${errorBody.substring(0, 200)}`);

      console.log("[MARK-vision] returning HTTP error result");
      return {
        items: [],
        rawText: "",
        metadata: {
          error: isRateLimit
            ? "AI provider rate limit exceeded. Please wait and try again."
            : `AI provider returned HTTP ${response.status}: ${errorBody}`,
          provider: "gemini-vision",
        },
      };
    }

    console.log("[MARK-vision] parsing response JSON");
    const data = JSON.parse(rawBody);
    console.log("[MARK-vision] response JSON parsed — modelVersion:", data.modelVersion);
    debug.saveResponse(data);

    if (data.error) {
      console.log("[MARK-vision] API error in response body");
      debug.setReportField("failureReason", `API error: ${data.error.message || JSON.stringify(data.error)}`);
      return {
        items: [],
        rawText: "",
        metadata: {
          error: `API error: ${data.error.message || JSON.stringify(data.error)}`,
          provider: "gemini-vision",
        },
      };
    }

    console.log("[MARK-vision] checking candidate");
    const candidate = data.candidates?.[0];
    if (!candidate) {
      console.log("[MARK-vision] no candidate");
      debug.setReportField("failureReason", "No response candidates from AI provider.");
      return {
        items: [],
        rawText: "",
        metadata: {
          error: "No response candidates from AI provider.",
          provider: "gemini-vision",
        },
      };
    }

    console.log("[MARK-vision] finishReason:", candidate.finishReason);
    if (!isRelevantFinishReason(candidate.finishReason)) {
      console.log("[MARK-vision] blocked — finishReason:", candidate.finishReason);
      debug.setReportField("failureReason", `Generation blocked. Reason: ${candidate.finishReason}`);
      return {
        items: [],
        rawText: "",
        metadata: {
          error: `Generation blocked. Reason: ${candidate.finishReason}`,
          provider: "gemini-vision",
        },
      };
    }

    console.log("[MARK-vision] extracting response text");
    const responseText = candidate.content?.parts?.[0]?.text || "";
    debug.saveCandidateText(responseText);
    debug.setReportField("finishReason", candidate.finishReason);
    debug.setReportField("responseLength", responseText.length);
    if (data.usageMetadata) debug.setReportField("usageMetadata", data.usageMetadata);

    if (!responseText) {
      console.log("[MARK-vision] empty response text");
      debug.setReportField("failureReason", "Empty response from AI provider.");
      return {
        items: [],
        rawText: "",
        metadata: {
          error: "Empty response from AI provider.",
          provider: "gemini-vision",
        },
      };
    }

    console.log("[MARK-vision] safeParse start");
    const result = safeParse(responseText);
    console.log("safeParse parsed keys:", Object.keys(result.parsed || {}));
console.log("items type:", typeof result.parsed.items);
console.log("isArray:", Array.isArray(result.parsed.items));
console.log("items length:", result.parsed.items?.length);
console.log(
  "first item:",
  JSON.stringify(result.parsed.items?.[0], null, 2)
);

    console.log("[MARK-vision] safeParse done — success:", result.success, "recovery:", result.recovery);
    debug.setReportField("parserStage", result.recovery || "direct");
    if (result.success) {
      console.log("[MARK-vision] saveParsed");
      debug.saveParsed(result.parsed);
      if (result.recovery && result.recovery.includes("recovery")) {
        console.log("[MARK-vision] saveRecovered");
        try { debug.saveRecovered(JSON.parse(result.cleaned)); } catch {}
        debug.setReportField("recoveryMethod", result.recovery);
      }
    }

    if (!result.success) {
      console.log("[MARK-vision] parse failed");
      debug.setReportField("failureReason", "AI response did not contain valid JSON.");
      return {
        items: [],
        rawText: responseText,
        metadata: {
          error: "AI response did not contain valid JSON. Raw text shown instead.",
          provider: "gemini-vision",
        },
      };
    }

    console.log("[MARK-vision] validateAndNormalizeItems start");
    const items = validateAndNormalizeItems(result.parsed.items);
    console.log("[MARK-vision] validateAndNormalizeItems done — items count:", items.length);

    if (items.length === 0) {
      console.log("[MARK-vision] no items and no rawText");
      debug.setReportField("failureReason", "No menu items or text found in the uploaded image.");
      return {
        items: [],
        rawText: "",
        metadata: {
          error: "No menu items found in the uploaded image.",
          provider: "gemini-vision",
        },
      };
    }

    console.log("[MARK-vision] computing average confidence");
    const avgConfidence =
      items.length > 0
        ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length
        : 0;

    debug.setReportField("success", true);
    console.log("[MARK-vision] SUCCESS — returning", items.length, "items");

    return {
      items,
      rawText: "",
      metadata: {
        provider: "gemini-vision",
        itemCount: items.length,
        averageConfidence: Math.round(avgConfidence * 10000) / 10000,
      },
    };
  } catch (err) {
    console.error("=== [MARK-vision] CATCH — Gemini fetch/processing error ===");
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    console.error("Full stack:", err instanceof Error ? err.stack : "(no stack)");
    if (err.name === "AbortError") {
      debug.setReportField("failureReason", "Request timed out.");
      return {
        items: [],
        rawText: "",
        metadata: {
          error:
            "Request timed out. The image may be too complex or the service is unavailable.",
          provider: "gemini-vision",
        },
      };
    }

    if (err.name === "TypeError" && err.message?.includes("fetch")) {
      debug.setReportField("failureReason", "Network error.");
      return {
        items: [],
        rawText: "",
        metadata: {
          error:
            "Network error: could not reach the AI provider. Check your internet connection.",
          provider: "gemini-vision",
        },
      };
    }

    console.error("=== [MARK-vision] UNKNOWN error caught ===");
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    console.error("Full stack:", err instanceof Error ? err.stack : "(no stack)");
    debug.setReportField("failureReason", err.message || "AI processing failed.");
    return {
      items: [],
      rawText: "",
      metadata: {
        error: err.message || "AI processing failed.",
        provider: "gemini-vision",
      },
    };
  } finally {
    console.log("[MARK-vision] finally — clearing timeout, finalizing debug");
    clearTimeout(timeout);
    debug.finalize();
    console.log("[MARK-vision] extractMenu EXIT");
  }
}
