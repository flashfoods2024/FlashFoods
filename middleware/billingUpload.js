import multer from "multer";
import { MAX_TEMPLATE_BYTES } from "../utils/invoice/pdf-validate.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TEMPLATE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || "");
    const mime = String(file.mimetype || "");
    if (
      /\.pdf$/i.test(name) ||
      mime === "application/pdf" ||
      mime === "application/octet-stream" ||
      mime === ""
    ) {
      cb(null, true);
      return;
    }
    cb(new Error("Only PDF files are supported."));
  },
});

function wantsJson(req) {
  return req.accepts(["json", "html"]) === "json";
}

/**
 * Dedicated billing template upload (PDF, memory storage, 10 MB). Image
 * Multer/Cloudinary settings are deliberately not reused.
 */
export function handleBillingTemplateUpload(req, res, next) {
  upload.single("template")(req, res, (error) => {
    if (!error) return next();

    const message =
      error instanceof multer.MulterError
        ? "PDF upload failed. Use a PDF under 10 MB."
        : error.message || "PDF upload failed.";

    if (wantsJson(req)) {
      return res.status(400).json({ ok: false, error: message });
    }
    req.flash("error", message);
    return res.redirect("/vendor/menu");
  });
}
