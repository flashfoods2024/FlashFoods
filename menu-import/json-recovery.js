const DEV = process.env.NODE_ENV !== "production";

function tryParse(str) {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

function findMatchingBrace(text, startPos) {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startPos; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        continue;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth++;
      continue;
    }

    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

const FIXES = [
  (s) => s.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"'),
  (s) => s.replace(/[\u2018\u2019\u201B\u2032\u2035]/g, "'"),
  (s) => s.replace(/,+/g, ","),
  (s) => s.replace(/,(\s*[}\]])/g, "$1"),
  (s) => s.replace(/,(\s*)$/, ""),
  (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFEFF]/g, ""),
  (s) => s.trim(),
];

function recoverJson(badJson) {
  let cleaned = badJson;
  for (const fix of FIXES) {
    cleaned = fix(cleaned);
  }
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    return null;
  }
}

function scoreCandidate(parsed) {
  if (parsed === null || typeof parsed !== "object") return 0;
  if (Array.isArray(parsed)) return 1;

  let score = 1;

  if (Array.isArray(parsed.items)) {
    score += 100;
    score += Math.min(parsed.items.length, 50);
  } else if ("items" in parsed) {
    score += 30;
  }

  if (typeof parsed.rawText === "string") {
    score += 15;
    if (parsed.rawText.length > 0) {
      score += Math.min(parsed.rawText.length / 100, 10);
    }
  }

  if (parsed.metadata && typeof parsed.metadata === "object") {
    score += 5;
  }

  return Math.max(0, score);
}

function collectCandidates(text) {
  const candidates = [];

  candidates.push({ text, source: "direct" });

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fenceRegex.exec(text)) !== null) {
    candidates.push({ text: match[1].trim(), source: "fence" });
  }

  let pos = 0;
  while ((pos = text.indexOf("{", pos)) !== -1) {
    const end = findMatchingBrace(text, pos);
    if (end !== -1) {
      candidates.push({ text: text.substring(pos, end + 1), source: "brace" });
    }
    pos++;
  }

  return candidates;
}

function findBestCandidate(text) {
  const candidates = collectCandidates(text);

  let best = null;
  let bestScore = -1;
  let bestSource = null;
  let bestRecovered = false;

  for (const candidate of candidates) {
    let cleaned = candidate.text;
    let recovered = false;

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const recoveredText = recoverJson(cleaned);
      if (recoveredText) {
        parsed = JSON.parse(recoveredText);
        cleaned = recoveredText;
        recovered = true;
      } else {
        continue;
      }
    }

    const score = scoreCandidate(parsed);
    if (score > bestScore) {
      best = cleaned;
      bestScore = score;
      bestSource = candidate.source;
      bestRecovered = recovered;
    }
  }

  if (!best) return null;

  let recovery;
  if (bestSource === "direct" && !bestRecovered) {
    recovery = null;
  } else if (bestRecovered) {
    recovery = bestSource + "-recovery";
  } else {
    recovery = bestSource + "-extract";
  }

  return { cleaned: best, recovery };
}

function log(...args) {
  if (DEV) {
    console.error("[json-recovery]", ...args);
  }
}

export function safeParse(rawText) {
  if (!rawText || typeof rawText !== "string") {
    log("input is empty or not a string");
    return { success: false, parsed: null, rawText: "", cleaned: "", recovery: null };
  }

  const extraction = findBestCandidate(rawText);

  if (extraction) {
    return {
      success: true,
      parsed: JSON.parse(extraction.cleaned),
      rawText,
      cleaned: extraction.cleaned,
      recovery: extraction.recovery,
    };
  }

  log("all strategies exhausted");
  return { success: false, parsed: null, rawText, cleaned: "", recovery: null };
}
