import {
  AMOUNT_WORDS_STYLES,
  DEFAULT_AMOUNT_WORDS_STYLE,
} from "./format.js";

/**
 * Vendor invoice masters are not uniform. Some leave the amount-in-words line
 * completely blank, some print "Only" after the empty box, and the Well B master
 * prints "Rupees only". Detecting that static label lets the generated value
 * complement the template instead of repeating it.
 *
 * Detection is strictly best-effort: it reads the ORIGINAL template bytes (never
 * the rendered output) with pdf.js, looks only at text on the same baseline band
 * as the configured field, and returns null if anything about the inspection
 * fails. A failed inspection must never block invoice issuance.
 */
const CURRENCY_WORD = /\b(?:rupees?|rs\.?|inr)\b/i;
const ONLY_WORD = /\bonly\b/i;

// pdf.js has changed its teardown API across majors; releasing the parser must
// never throw, because that would turn a successful detection into an error.
async function releaseDocument(pdf) {
  try {
    if (typeof pdf?.destroy === "function") await pdf.destroy();
    else if (typeof pdf?.cleanup === "function") await pdf.cleanup();
  } catch {
    // Best effort only.
  }
}

export async function detectAmountWordsStyle({
  templateBytes,
  pageIndex = 0,
  field,
}) {
  if (!templateBytes || !templateBytes.length || !field) return null;
  if (!Number.isFinite(Number(field.y))) return null;

  let pdf = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(templateBytes),
      useSystemFonts: false,
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;

    const page = await pdf.getPage(Number(pageIndex) + 1);
    const content = await page.getTextContent();

    // Only text on the field's own line can be its suffix; a "Rupees" mention
    // elsewhere on the page (table header, terms) must not change the output.
    const band = Math.max(6, Number(field.fontSize) * 2.2);
    const nearby = content.items
      .filter((item) => typeof item.str === "string" && item.str.trim())
      .filter((item) => {
        const y = Number(item.transform?.[5]);
        return Number.isFinite(y) && Math.abs(y - Number(field.y)) <= band;
      })
      .map((item) => item.str)
      .join(" ");

    const hasCurrency = CURRENCY_WORD.test(nearby);
    const hasOnly = ONLY_WORD.test(nearby);

    if (hasCurrency) return "wordsOnly";
    if (hasOnly) return "noOnly";
    return "full";
  } catch {
    return null;
  } finally {
    await releaseDocument(pdf);
  }
}

/**
 * Effective suffix style: an explicit vendor choice wins, otherwise the
 * template's own printed label decides. Falls back to the safe default.
 */
export async function resolveAmountWordsStyle({
  mapping,
  templateBytes,
  pageIndex = 0,
}) {
  const field =
    mapping?.fields?.amountInWords ||
    mapping?.continuationTotals?.amountInWords ||
    null;
  if (!field) return null;

  if (AMOUNT_WORDS_STYLES.includes(field.wordsStyle)) return field.wordsStyle;

  const detected = await detectAmountWordsStyle({
    templateBytes,
    pageIndex,
    field,
  });
  return detected || DEFAULT_AMOUNT_WORDS_STYLE;
}
