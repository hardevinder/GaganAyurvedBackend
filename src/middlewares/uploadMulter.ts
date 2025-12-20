// src/middleware/uploadMulter.ts
// Real multer-based upload middleware for Fastify preHandlers

import type { FastifyRequest, FastifyReply } from "fastify";
import multer from "multer";
import path from "path";
import fs from "fs";

// Root uploads folder: /home/ubuntu/GaganAyurvedBackend/uploads
const uploadsRoot = path.join(process.cwd(), "uploads");

// Ensure root uploads dir exists
if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
  // eslint-disable-next-line no-console
  console.log("[uploadMulter] Created uploads directory:", uploadsRoot);
}

// Store product images in /uploads/products
const productsDir = path.join(uploadsRoot, "products");
if (!fs.existsSync(productsDir)) {
  fs.mkdirSync(productsDir, { recursive: true });
  // eslint-disable-next-line no-console
  console.log("[uploadMulter] Created products uploads directory:", productsDir);
}

// Multer disk storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, productsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    const baseName = path
      .basename(file.originalname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "");

    const timestamp = Date.now();
    const safeName = `${baseName || "image"}_${timestamp}${ext}`;
    cb(null, safeName);
  },
});

// Allow only common image types
const baseMulter = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PNG, JPG, and WEBP images are allowed"));
    }
  },
});

/**
 * Wrap a multer middleware so it works as a Fastify preHandler:
 * Fastify gives us FastifyRequest/FastifyReply, but multer expects
 * raw Node req/res, so we pass req.raw / reply.raw.
 */
function wrapMulter(
  inner: (req: any, res: any, next: (err?: any) => void) => void
) {
  return (
    req: FastifyRequest,
    reply: FastifyReply,
    next?: () => void
  ): void => {
    inner(req.raw, reply.raw, (err?: any) => {
      if (err) {
        const msg = err?.message || "File upload error";
        reply.status(400).send({ message: msg });
        return;
      }
      if (typeof next === "function") next();
    });
  };
}

// API compatible with old shim: upload.single / array / fields / none
const upload: any = {
  single: (field: string) => wrapMulter(baseMulter.single(field)),
  array: (field: string, maxCount?: number) =>
    wrapMulter(baseMulter.array(field, maxCount)),
  fields: (specs: any[]) => wrapMulter(baseMulter.fields(specs)),
  none: () => wrapMulter(baseMulter.none()),
};

export default upload;
export { upload };
