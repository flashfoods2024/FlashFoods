import multer from "multer";
import {
  isCloudinaryConfigured,
  menuImageStorage,
  shopImageStorage,
} from "../config/cloudinary.js";

const imageFileFilter = (req, file, cb) => {
  if (file.mimetype && file.mimetype.startsWith("image/")) {
    cb(null, true);
    return;
  }

  cb(new Error("Only image files are allowed."));
};

export const uploadMenuImage = multer({
  storage: menuImageStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

export const uploadShopImage = multer({
  storage: shopImageStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function handleImageUpload(upload, redirectPath) {
  return function (req, res, next) {
    if (!isCloudinaryConfigured()) {
      const message =
        "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to .env, then restart the server.";

      if (req.accepts("json") && !req.accepts("html")) {
        return res.status(500).json({ error: message });
      }

      req.flash("error", message);
      return res.redirect(redirectPath);
    }

    upload.single("image")(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      const message =
        error instanceof multer.MulterError
          ? "Image upload failed. Use an image under 5MB."
          : error.message || "Image upload failed.";

      if (req.accepts("json") && !req.accepts("html")) {
        return res.status(400).json({ error: message });
      }

      req.flash("error", message);
      return res.redirect(redirectPath);
    });
  };
}

export function handleMenuImageUpload(req, res, next) {
  return handleImageUpload(uploadMenuImage, "/vendor/menu")(req, res, next);
}

export function handleShopImageUpload(redirectPath = "/admin/shops/new") {
  return function (req, res, next) {
    const resolvedPath =
      typeof redirectPath === "function" ? redirectPath(req) : redirectPath;
    return handleImageUpload(uploadShopImage, resolvedPath)(req, res, next);
  };
}
