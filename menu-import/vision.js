import fs from "fs";
import path from "path";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";

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

function extractJsonFromResponse(text) {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }

  return null;
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
  const ext = path.extname(filePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
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
  } catch {
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
    return {
      items: [],
      rawText: "",
      metadata: { error: "Uploaded file is empty.", provider: "gemini-vision" },
    };
  }

  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    return {
      items: [],
      rawText: "",
      metadata: {
        error: "File exceeds 10 MB limit for AI processing.",
        provider: "gemini-vision",
      },
    };
  }

  const base64 = imageBuffer.toString("base64");
  const mimeType = getMimeType(ext);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const isRateLimit = response.status === 429;
      const errorBody = await response.text().catch(() => "Unknown error");

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

    const data = await response.json();

    if (data.error) {
      return {
        items: [],
        rawText: "",
        metadata: {
          error: `API error: ${data.error.message || JSON.stringify(data.error)}`,
          provider: "gemini-vision",
        },
      };
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      return {
        items: [],
        rawText: "",
        metadata: {
          error: "No response candidates from AI provider.",
          provider: "gemini-vision",
        },
      };
    }

    if (!isRelevantFinishReason(candidate.finishReason)) {
      return {
        items: [],
        rawText: "",
        metadata: {
          error: `Generation blocked. Reason: ${candidate.finishReason}`,
          provider: "gemini-vision",
        },
      };
    }

    const responseText = candidate.content?.parts?.[0]?.text || "";
    if (!responseText) {
      return {
        items: [],
        rawText: "",
        metadata: {
          error: "Empty response from AI provider.",
          provider: "gemini-vision",
        },
      };
    }

    const jsonStr = extractJsonFromResponse(responseText);
    if (!jsonStr) {
      return {
        items: [],
        rawText: responseText,
        metadata: {
          error: "AI response did not contain valid JSON. Raw text shown instead.",
          provider: "gemini-vision",
        },
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return {
        items: [],
        rawText: responseText,
        metadata: {
          error: "Failed to parse AI response as JSON. Raw text shown instead.",
          provider: "gemini-vision",
        },
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return {
        items: [],
        rawText: responseText,
        metadata: {
          error: "AI response was not a valid object.",
          provider: "gemini-vision",
        },
      };
    }

    const items = validateAndNormalizeItems(parsed.items);
    const rawText = String(parsed.rawText || "");

    if (items.length === 0 && !rawText) {
      return {
        items: [],
        rawText: "",
        metadata: {
          error: "No menu items or text found in the uploaded image.",
          provider: "gemini-vision",
        },
      };
    }

    const avgConfidence =
      items.length > 0
        ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length
        : 0;

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
    if (err.name === "AbortError") {
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

    return {
      items: [],
      rawText: "",
      metadata: {
        error: err.message || "AI processing failed.",
        provider: "gemini-vision",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
