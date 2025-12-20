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
import { existsSync, mkdirSync } from "fs";

import prismaPlugin from "./config/prisma";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import productRoutes from "./routes/products";
import orderRoutes from "./routes/orders";
import blogRoutes from "./routes/blogs";
import categoriesRoutes from "./routes/categories";
import cartRoutes from "./routes/cart";
import checkoutRoutes from "./routes/checkout";

import shippingRulesRoutes from "./routes/admin/shippingRules";
import * as shippingCtrl from "./controllers/admin/shippingRulesController";
import adminOrdersRoutes from "./routes/admin/orders";
import authPlugin from "./plugins/auth";

const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 1200);
const HOST = process.env.HOST || "0.0.0.0";

// Comma-separated list of allowed frontend origins in prod
const FRONTEND_ORIGINS = isProd
  ? (process.env.FRONTEND_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])
  : ["http://localhost:3000"];

const app = Fastify({
  logger: true,
  trustProxy: true,
});

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads", "products");
const INVOICES_DIR = process.env.INVOICE_UPLOAD_DIR || path.join(process.cwd(), "uploads", "invoices");

async function ensureDir(dirPath: string) {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  await fs.access(dirPath).catch(() => fs.mkdir(dirPath, { recursive: true }));
}

async function start() {
  try {
    process.on("unhandledRejection", (err) => {
      app.log.error(err, "unhandledRejection");
    });
    process.on("uncaughtException", (err) => {
      app.log.error(err, "uncaughtException");
    });

    // Security headers
    await app.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    });

    // Rate limiting
    await app.register(rateLimit, {
      max: 300,
      timeWindow: "1 minute",
      allowList: (req) => {
        const ip = String((req as any).ip || "");
        return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
      },
    });

    // Log allowed origins
    app.log.info({ FRONTEND_ORIGINS, isProd }, "Allowed CORS origins");

    // CORS
    await app.register(cors, {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // server-to-server or curl

        if (FRONTEND_ORIGINS.length === 0) {
          app.log.warn({ origin }, "CORS: no FRONTEND_ORIGINS set, denying origin");
          return cb(null, false);
        }

        const allowed = FRONTEND_ORIGINS.includes(origin);
        if (!allowed) {
          app.log.warn({ origin }, "CORS blocked origin");
        }
        cb(null, allowed);
      },
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With", "Cookie"],
      exposedHeaders: ["set-cookie"],
      credentials: true,
      maxAge: 86400,
    });

    // JWT
    await app.register(fastifyJwt, {
      secret: process.env.JWT_SECRET || "supersecret",
    });

    await app.register(authPlugin);
    await app.register(prismaPlugin);

    // Multipart
    await app.register(fastifyMultipart, {
      limits: {
        fileSize: Number(process.env.UPLOAD_FILE_SIZE_LIMIT || 50 * 1024 * 1024),
        files: Number(process.env.UPLOAD_MAX_FILES || 10),
      },
      attachFieldsToBody: true,
    });

    // Cookies
    const cookieOptions: Record<string, unknown> = {};
    if (process.env.COOKIE_SECRET && process.env.COOKIE_SECRET !== "") {
      cookieOptions.secret = process.env.COOKIE_SECRET;
    }
    await app.register(fastifyCookie as any, cookieOptions as any);

    // Upload dirs
    await ensureDir(UPLOAD_DIR);
    await ensureDir(INVOICES_DIR);

    // Static files
    await app.register(fastifyStatic, {
      root: path.join(process.cwd(), "uploads", "products"),
      prefix: "/uploads/products/",
      decorateReply: false,
    });
    await app.register(fastifyStatic, {
      root: path.join(process.cwd(), "uploads", "invoices"),
      prefix: "/uploads/invoices/",
      decorateReply: false,
    });

    // Routes
    app.register(shippingRulesRoutes, { prefix: "/api/admin" });
    app.register(adminOrdersRoutes, { prefix: "/api/admin" });

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
        app.log.error({ err }, "shippingCalculate error");
        return reply.code(500).send({ error: err?.message || "Internal error" });
      }
    });

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

    await app.ready();

    await app.listen({ port: PORT, host: HOST });
    app.log.info(`🚀 Server running at http://${HOST}:${PORT}`);

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

// Root route
app.get("/", async () => {
  return { ok: true, message: "Welcome to GaganAyurveda API" };
});
