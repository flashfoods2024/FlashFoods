import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

export const menuImageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "fast-food/menu-items",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    resource_type: "image",
    transformation: [
      { width: 500, height: 500, crop: "fill", gravity: "auto", quality: "auto", fetch_format: "auto" },
    ],
  },
});

export const shopImageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "fast-food/shops",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    resource_type: "image",
    transformation: [
      { width: 900, height: 600, crop: "fill", gravity: "auto", quality: "auto", fetch_format: "auto" },
    ],
  },
});
