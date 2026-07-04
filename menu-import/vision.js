import fs from "fs";
import path from "path";
import { safeParse } from "./json-recovery.js";
import { DebugSession } from "./debug.js";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

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

const EXTRACTION_PROMPT = `You are a restaurant menu extraction system. Read this menu image and extract every item exactly as shown.

Return ONLY valid JSON. Do not include markdown, code fences, or any text outside the JSON object.

Use this exact structure:
{
  "items": [
    {
      "name": "Item name exactly as shown on menu",
      "description": "Item description as shown, or empty string if none",
      "category": "Category/section heading as shown on menu",
      "foodType": "must be one of: veg, non-veg, egg, unknown",
      "variants": [
        {
          "label": "Size or portion label exactly as shown (e.g. Half, Full, S, M, L, Regular, Large, Mini, Jumbo)",
          "price": 0.00
        }
      ],
      "confidence": 0.95
    }
  ],
  "rawText": "Every piece of text visible in the menu image, preserving original layout and line breaks"
}

FOOD TYPE RULES:
- Look for veg/non-veg indicators: green/red dots, (V)/(NV) markers, leaf/non-veg symbols, explicit "Veg"/"Non-Veg" labels, coloured backgrounds.
- If the menu clearly marks a type, use it.
- If the menu does NOT indicate food type for an item, return "unknown".
- NEVER guess. If there is no indicator, return "unknown".

VARIANT RULES:
- Many menus list multiple prices per item separated by slashes or portion labels (e.g. "Half 45 / Full 85", "S 5 / M 7 / L 10", "45 / 85").
- Detect ALL pricing variants. Return each as a separate entry in the variants array with its label and numeric price.
- If a menu shows only a single price with no portion/size label, return one variant with label "Regular" and that price.
- If a menu shows multiple prices without explicit labels (e.g. "45 / 85"), assign labels based on context — often "Half" and "Full" in Indian menus, or "Regular" and "Large" otherwise.
- Extract the EXACT label text as shown. Do not normalize labels.
- Do NOT assume any currency — return only the numeric price value.
- If no price is visible at all, use price 0.

OTHER RULES:
- Extract EVERY item. Do not skip any.
- If no description, use "".
- Use the category/section heading exactly as shown. Do not invent categories.
- If no categories are shown on the menu, group similar items and assign a logical category name.
- Preserve original spelling and capitalization.
- Set confidence (0.0–1.0) per item based on how clearly you can read it.
- If the image contains no menu items, return {"items": [], "rawText": ""}.`;

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
      maxOutputTokens: 8192,
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
    const rawText = String(result.parsed.rawText || "");
    console.log("[MARK-vision] validateAndNormalizeItems done — items count:", items.length);

    if (items.length === 0 && !rawText) {
      console.log("[MARK-vision] no items and no rawText");
      debug.setReportField("failureReason", "No menu items or text found in the uploaded image.");
      return {
        items: [],
        rawText: "",
        metadata: {
          error: "No menu items or text found in the uploaded image.",
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
      rawText,
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
