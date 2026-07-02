/**
 * Multer configuration for menu import file uploads.
 *
 * Stores uploaded files in a local temp directory instead of Cloudinary.
 * This is deliberate: import files (menu scans, PDFs, CSVs) are temporary
 * staging artifacts, not permanent menu item images.
 *
 * Future parsers (OCR, PDF, Excel, AI) will read from this temp location.
 */

import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(__dirname, "..", "temp", "imports");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const tempStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = crypto.randomBytes(12).toString("hex");
    cb(null, `${unique}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowedExtensions = [".png", ".jpg", ".jpeg", ".webp", ".pdf"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
    return;
  }
  cb(new Error(`Unsupported file type "${ext}". Allowed: ${allowedExtensions.join(", ")}`));
};

export const uploadImportFile = multer({
  storage: tempStorage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});
