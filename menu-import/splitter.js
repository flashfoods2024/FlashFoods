/**
 * Menu Image Splitter
 *
 * Splits large restaurant menu images into smaller overlapping vertical chunks
 * so each chunk can be processed individually by a downstream vision parser
 * (e.g. Gemini Vision) without cutting text in half.
 *
 * This module is completely independent from any AI, database, Express, or
 * business-logic code.  It only crops images.
 */

import sharp from "sharp";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Root directory where chunk output folders are created. */
const CHUNKS_ROOT = path.resolve(__dirname, "..", "temp", "chunks");

/** Default overlap in pixels between adjacent chunks. */
const DEFAULT_OVERLAP_PX = 50;

/** Image formats that sharp can decode. */
const VALID_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tiff",
  ".avif",
  ".heif",
]);

/**
 * Determines the number of vertical chunks based on image width.
 *
 * @param {number} width – Image width in pixels.
 * @returns {number} Number of chunks (1–4).
 */
function determineChunkCount(width) {
  if (typeof width !== "number" || !Number.isFinite(width) || width < 0) {
    return 1;
  }
  if (width < 1000) return 1;
  if (width <= 1800) return 2;
  if (width <= 2600) return 3;
  return 4;
}

/**
 * @typedef {Object} SplitResult
 * @property {number}   width      – Original image width in pixels.
 * @property {number}   height     – Original image height in pixels.
 * @property {number}   chunkCount – Number of chunks produced.
 * @property {string}   outputDir  – Absolute path to the output directory.
 * @property {string[]} chunks     – Absolute paths to each chunk file.
 */

/**
 * Splits a large menu image into overlapping vertical chunks.
 *
 * The number of chunks is determined automatically from the image width
 * (see {@link determineChunkCount}).  Every chunk overlaps the previous
 * one by {@link DEFAULT_OVERLAP_PX} pixels (configurable via options) so
 * that no text is ever cut in half.
 *
 * @param {string} imagePath – Absolute or relative path to the source image.
 * @param {object} [options] – Optional settings.
 * @param {number} [options.overlap=50] – Overlap between chunks in pixels.
 * @returns {Promise<SplitResult>}
 * @throws {Error} When the file does not exist, the format is unsupported,
 *                 or the image has zero / invalid dimensions.
 */
export async function splitMenuImage(imagePath, options = {}) {
  /* ---- input validation ---- */

  if (!imagePath || typeof imagePath !== "string") {
    throw new Error("splitMenuImage: imagePath must be a non-empty string.");
  }

  const resolvedPath = path.resolve(imagePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`splitMenuImage: file not found — ${resolvedPath}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!VALID_EXTENSIONS.has(ext)) {
    throw new Error(
      `splitMenuImage: unsupported image format "${ext}". ` +
      `Supported: ${[...VALID_EXTENSIONS].join(", ")}`,
    );
  }

  /* ---- read metadata ---- */

  let metadata;
  try {
    metadata = await sharp(resolvedPath).metadata();
  } catch (err) {
    throw new Error(
      `splitMenuImage: failed to read metadata from "${resolvedPath}" — ${err.message}`,
    );
  }

  const { width, height } = metadata;

  if (!width || !height || width <= 0 || height <= 0) {
    throw new Error(
      `splitMenuImage: invalid image dimensions (${width} x ${height})`,
    );
  }

  /* ---- determine split parameters ---- */

  const overlap =
    options.overlap != null && Number.isFinite(options.overlap)
      ? Math.max(0, options.overlap)
      : DEFAULT_OVERLAP_PX;

  const chunkCount = determineChunkCount(width);

  /* ---- create output directory ---- */

  if (!fs.existsSync(CHUNKS_ROOT)) {
    fs.mkdirSync(CHUNKS_ROOT, { recursive: true });
  }

  const uuid = crypto.randomUUID();
  const outputDir = path.join(CHUNKS_ROOT, uuid);
  fs.mkdirSync(outputDir, { recursive: true });

  /* ---- extract chunks ---- */

  const chunks = [];

  if (chunkCount === 1) {
    const chunkPath = path.join(outputDir, "chunk-1.png");
    await sharp(resolvedPath).png().toFile(chunkPath);
    chunks.push(chunkPath);
  } else {
    const chunkWidth = Math.ceil(
      (width + (chunkCount - 1) * overlap) / chunkCount,
    );

    for (let i = 0; i < chunkCount; i++) {
      const left = Math.max(0, i * (chunkWidth - overlap));
      const cropWidth = Math.min(chunkWidth, width - left);

      if (cropWidth <= 0) break;

      const chunkPath = path.join(outputDir, `chunk-${i + 1}.png`);
      await sharp(resolvedPath)
        .extract({ left, top: 0, width: cropWidth, height })
        .png()
        .toFile(chunkPath);

      chunks.push(chunkPath);
    }
  }

  return {
    width,
    height,
    chunkCount: chunks.length,
    outputDir,
    chunks,
  };
}
