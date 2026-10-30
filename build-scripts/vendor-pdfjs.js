// Copies the pinned PDF.js runtime into public/vendor/pdfjs so the preview and
// coordinate editor load from this origin (no CDN, no hand-edited public files).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "node_modules", "pdfjs-dist", "build");
const TARGET = path.join(ROOT, "public", "vendor", "pdfjs");

const FILES = ["pdf.min.mjs", "pdf.worker.min.mjs"];

fs.mkdirSync(TARGET, { recursive: true });

for (const file of FILES) {
  const from = path.join(SOURCE, file);
  const to = path.join(TARGET, file);
  if (!fs.existsSync(from)) {
    console.error(`[vendor:pdfjs] missing ${from} — run npm install first`);
    process.exit(1);
  }
  fs.copyFileSync(from, to);
  console.log(`[vendor:pdfjs] ${file} -> ${path.relative(ROOT, to)}`);
}
