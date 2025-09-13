// src/server.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import path from "path";
import fs from "fs/promises";
import { existsSync, mkdirSync, createWriteStream } from "fs";

import prismaPlugin from "./config/prisma";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import productRoutes from "./routes/products";
import orderRoutes from "./routes/orders";
import blogRoutes from "./routes/blogs";
import categoriesRoutes from "./routes/categories";
import cartRoutes from "./routes/cart";
import checkoutRoutes from "./routes/checkout";

import shippingRulesRoutes from "./routes/admin/shippingRules"; // admin shipping rules routes
import * as shippingCtrl from "./controllers/admin/shippingRulesController"; // for computeShippingForPincode

import adminOrdersRoutes from "./routes/admin/orders"; // <-- NEW: admin orders routes

import authPlugin from "./plugins/auth"; // optionalAuthOrGuestToken / requireAuth

const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || "0.0.0.0";

// Comma-separated list of allowed frontend origins in prod
const FRONTEND_ORIGINS = isProd
  ? (process.env.FRONTEND_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])
  : ["http://localhost:3000"]; // dev default

const app = Fastify({
  logger: true,
  trustProxy: true, // important behind proxies/load balancers
});

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads", "products");
const INVOICES_DIR = process.env.INVOICE_UPLOAD_DIR || path.join(process.cwd(), "uploads", "invoices");

async function ensureDir(dirPath: string) {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  await fs.access(dirPath).catch(() => fs.mkdir(dirPath, { recursive: true }));
}

async function start() {
  try {
    // global safety handlers
    process.on("unhandledRejection", (err) => {
      app.log.error(err, "unhandledRejection");
    });
    process.on("uncaughtException", (err) => {
      app.log.error(err, "uncaughtException");
    });

    // 1) Security headers
    await app.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    });

    // 2) Basic rate limiting
    await app.register(rateLimit, {
      max: 300,
      timeWindow: "1 minute",
      allowList: (req) => {
        const ip = String((req as any).ip || "");
        return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
      },
    });

    // 3) CORS — allow edit verbs + Authorization header
    await app.register(cors, {
      origin: (origin, cb) => {
        // allow server-to-server requests (no origin like curl)
        if (!origin) return cb(null, true);

        const allowed = FRONTEND_ORIGINS.length > 0 && FRONTEND_ORIGINS.includes(origin);
        cb(null, allowed);
      },
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With", "Cookie"],
      exposedHeaders: ["set-cookie"],
      credentials: true,
      maxAge: 86400,
    });

    // 4) JWT — Bearer tokens
    await app.register(fastifyJwt, {
      secret: process.env.JWT_SECRET || "supersecret",
    });

    // register auth helpers plugin (decorate with optionalAuthOrGuestToken / requireAuth)
    await app.register(authPlugin);

    // 5) Prisma
    await app.register(prismaPlugin);

    //
    // IMPORTANT: register multipart BEFORE routes that need file uploads.
    //
    await app.register(fastifyMultipart, {
      limits: {
        fileSize: Number(process.env.UPLOAD_FILE_SIZE_LIMIT || 50 * 1024 * 1024),
        files: Number(process.env.UPLOAD_MAX_FILES || 10),
      },
      attachFieldsToBody: true,
    });

    // Register cookie plugin so handlers can read/set cookies (sessionId)
    await app.register(fastifyCookie, {
      secret: process.env.COOKIE_SECRET || undefined,
    });

    // Ensure upload directories exist BEFORE registering static file serving
    await ensureDir(UPLOAD_DIR);
    await ensureDir(INVOICES_DIR);

    // 6) Static files (important for serving product images)
    await app.register(fastifyStatic, {
      root: path.join(process.cwd(), "uploads", "products"),
      prefix: "/uploads/products/",
      decorateReply: false,
    });

    // Serve invoices directory statically as well (optional)
    await app.register(fastifyStatic, {
      root: path.join(process.cwd(), "uploads", "invoices"),
      prefix: "/uploads/invoices/",
      decorateReply: false,
    });

    // Optional debug route to help diagnose uploads (safe + writes files)
    app.post("/debug-upload", async (req, reply) => {
      req.log.info({ headers: req.headers }, "debug-upload headers");
      try {
        await ensureDir(UPLOAD_DIR);

        const bodyAny: any = req.body || {};
        const bodyPreview: Record<string, any> = {};
        for (const k of Object.keys(bodyAny)) {
          const v = bodyAny[k];
          if (v instanceof Buffer) bodyPreview[k] = `[Buffer ${v.length} bytes]`;
          else if (typeof v === "object") bodyPreview[k] = JSON.stringify(Object.keys(v)).slice(0, 200);
          else bodyPreview[k] = v;
        }

        const seen: any[] = [];
        const anyReq: any = req;

        if (typeof anyReq.multipart === "function") {
          await new Promise<void>((resolve, reject) => {
            try {
              anyReq.multipart(
                async (field: string, stream: NodeJS.ReadableStream, filename: string, _encoding: string, mimetype: string) => {
                  void _encoding;
                  const ext = path.extname(filename || "");
                  const base = (path.basename(filename || "file", ext) || "file").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
                  const outName = `${base}_${Date.now()}${ext}`;
                  const outPath = path.join(UPLOAD_DIR, outName);

                  const writeStream = createWriteStream(outPath);
                  try {
                    for await (const chunk of stream as any) {
                      writeStream.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
                    }
                    writeStream.end();
                    await new Promise<void>((res) => writeStream.on("close", () => res()));
                    const stat = await fs.stat(outPath);
                    seen.push({ type: "file", field, filename, savedAs: outName, size: stat.size, mimetype });
                  } catch (e) {
                    try {
                      writeStream.destroy();
                    } catch (_) {}
                    reject(e);
                  }
                },
                (err: any, fields: Record<string, any> | undefined) => {
                  if (err) return reject(err);
                  if (fields) {
                    for (const fk of Object.keys(fields)) {
                      seen.push({ type: "field", field: fk, value: String(fields[fk]).slice(0, 400) });
                    }
                  }
                  resolve();
                }
              );
            } catch (ex) {
              reject(ex);
            }
          });
        } else if (typeof anyReq.parts === "function") {
          for await (const p of anyReq.parts()) {
            if (p.file) {
              const filename = p.filename || "file";
              const ext = path.extname(filename);
              const base = path.basename(filename, ext).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
              const outName = `${base}_${Date.now()}${ext}`;
              const outPath = path.join(UPLOAD_DIR, outName);

              const writeStream = createWriteStream(outPath);
              let total = 0;
              for await (const chunk of p.file) {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                total += buf.length;
                writeStream.write(buf);
              }
              writeStream.end();
              await new Promise<void>((r) => writeStream.on("close", () => r()));
              seen.push({ type: "file", field: p.fieldname, filename, savedAs: outName, size: total, mimetype: p.mimetype });
            } else {
              seen.push({ type: "field", field: p.fieldname, value: String(p.value).slice(0, 400) });
            }
          }
        } else {
          if (bodyAny.images) {
            const arr = Array.isArray(bodyAny.images) ? bodyAny.images : [bodyAny.images];
            for (const f of arr) {
              if (f && typeof f === "object") {
                seen.push({
                  type: "attached-file-object",
                  originalname: f.filename || f.originalname || f.name,
                  filepath: f.filepath || f.path || undefined,
                  mimetype: f.mimetype || f.type || undefined,
                });
              }
            }
          }
        }

        req.log.info({ bodyPreview, seen }, "debug-upload data (safe)");
        return reply.send({ ok: true, body: bodyPreview, seen });
      } catch (err: any) {
        req.log.error(err, "debug-upload error");
        return reply.code(500).send({ error: err?.message || "err" });
      }
    });

    // 7) Register admin routes (shipping rules & orders) BEFORE other app routes so admin prefix is reserved
    // These routes include a preHandler that checks request.user?.isAdmin (see route files).
    app.register(shippingRulesRoutes, { prefix: "/api/admin" });
    app.register(adminOrdersRoutes, { prefix: "/api/admin" }); // <-- NEW

    /**
     * Public shipping calculation endpoint
     * GET /api/shipping/calculate?pincode=XXXXX&subtotal=NNN
     * - no auth, lightweight validation, re-uses controller helper computeShippingForPincode
     */
    app.get("/api/shipping/calculate", async (request, reply) => {
      try {
        const q: any = request.query || {};
        const pincodeRaw = q.pincode;
        const subtotalRaw = q.subtotal;

        if (!pincodeRaw || String(pincodeRaw).trim() === "") {
          return reply.code(400).send({ error: "pincode required" });
        }
        const pincodeDigits = String(pincodeRaw).replace(/\D/g, "");
        if (!pincodeDigits) return reply.code(400).send({ error: "invalid pincode" });
        const pincode = Number(pincodeDigits);
        if (!Number.isInteger(pincode) || pincode < 10000 || pincode > 999999) {
          return reply.code(400).send({ error: "invalid pincode" });
        }

        let subtotal = 0;
        if (subtotalRaw !== undefined && subtotalRaw !== null && String(subtotalRaw).trim() !== "") {
          const s = Number(String(subtotalRaw));
          if (Number.isFinite(s)) subtotal = s;
        }

        // reuse controller helper
        const result = await shippingCtrl.computeShippingForPincode(pincode, subtotal);

        return reply.send({
          data: {
            pincode,
            subtotal,
            shipping: result?.shipping != null ? Number(result.shipping) : 0,
            appliedRule: result?.appliedRule ?? null,
          },
        });
      } catch (err: any) {
        try {
          (request as any).log?.error?.({ err: err?.message ?? err, ctx: "shippingCalculate" });
        } catch {}
        return reply.code(500).send({ error: err?.message || "Internal error" });
      }
    });

    // 8) Register application routes (after admin routes)
    app.register(authRoutes, { prefix: "/api/auth" });
    app.register(userRoutes, { prefix: "/api" });
    app.register(productRoutes, { prefix: "/api" });
    app.register(orderRoutes, { prefix: "/api" });
    app.register(blogRoutes, { prefix: "/api" });
    app.register(categoriesRoutes, { prefix: "/api" });
    app.register(cartRoutes, { prefix: "/api" });
    app.register(checkoutRoutes, { prefix: "/api" });

    // health check
    app.get("/health", async () => ({ ok: true }));

    // ready + print routes (dev)
    await app.ready();
    if (!isProd) {
      app.log.info({ FRONTEND_ORIGINS }, "Allowed CORS origins");
      console.log("\n=== ROUTES ===");
      console.log(app.printRoutes());
      console.log("==============\n");
    }

    // listen
    await app.listen({ port: PORT, host: HOST });
    console.log(`🚀 Server running at http://${HOST}:${PORT}`);

    // graceful shutdown
    const close = async () => {
      try {
        await app.close();
        process.exit(0);
      } catch (e) {
        app.log.error(e);
        process.exit(1);
      }
    };
    process.on("SIGTERM", close);
    process.on("SIGINT", close);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
