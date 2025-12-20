"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/server.ts
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const jwt_1 = __importDefault(require("@fastify/jwt"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const static_1 = __importDefault(require("@fastify/static"));
const cookie_1 = __importDefault(require("@fastify/cookie"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const fs_1 = require("fs");
const prisma_1 = __importDefault(require("./config/prisma"));
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const products_1 = __importDefault(require("./routes/products"));
const orders_1 = __importDefault(require("./routes/orders"));
const blogs_1 = __importDefault(require("./routes/blogs"));
const categories_1 = __importDefault(require("./routes/categories"));
const cart_1 = __importDefault(require("./routes/cart"));
const checkout_1 = __importDefault(require("./routes/checkout"));
const shippingRules_1 = __importDefault(require("./routes/admin/shippingRules"));
const shippingCtrl = __importStar(require("./controllers/admin/shippingRulesController"));
const orders_2 = __importDefault(require("./routes/admin/orders"));
const auth_2 = __importDefault(require("./plugins/auth"));
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 1200);
const HOST = process.env.HOST || "0.0.0.0";
// Comma-separated list of allowed frontend origins in prod
const FRONTEND_ORIGINS = isProd
    ? (process.env.FRONTEND_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])
    : ["http://localhost:3000"];
const app = (0, fastify_1.default)({
    logger: true,
    trustProxy: true,
});
const UPLOAD_DIR = process.env.UPLOAD_DIR || path_1.default.join(process.cwd(), "uploads", "products");
const INVOICES_DIR = process.env.INVOICE_UPLOAD_DIR || path_1.default.join(process.cwd(), "uploads", "invoices");
async function ensureDir(dirPath) {
    if (!(0, fs_1.existsSync)(dirPath))
        (0, fs_1.mkdirSync)(dirPath, { recursive: true });
    await promises_1.default.access(dirPath).catch(() => promises_1.default.mkdir(dirPath, { recursive: true }));
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
        await app.register(helmet_1.default, {
            contentSecurityPolicy: false,
            crossOriginResourcePolicy: { policy: "cross-origin" },
        });
        // Rate limiting
        await app.register(rate_limit_1.default, {
            max: 300,
            timeWindow: "1 minute",
            allowList: (req) => {
                const ip = String(req.ip || "");
                return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
            },
        });
        // Log allowed origins
        app.log.info({ FRONTEND_ORIGINS, isProd }, "Allowed CORS origins");
        // CORS
        await app.register(cors_1.default, {
            origin: (origin, cb) => {
                if (!origin)
                    return cb(null, true); // server-to-server or curl
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
        await app.register(jwt_1.default, {
            secret: process.env.JWT_SECRET || "supersecret",
        });
        await app.register(auth_2.default);
        await app.register(prisma_1.default);
        // Multipart
        await app.register(multipart_1.default, {
            limits: {
                fileSize: Number(process.env.UPLOAD_FILE_SIZE_LIMIT || 50 * 1024 * 1024),
                files: Number(process.env.UPLOAD_MAX_FILES || 10),
            },
            attachFieldsToBody: true,
        });
        // Cookies
        const cookieOptions = {};
        if (process.env.COOKIE_SECRET && process.env.COOKIE_SECRET !== "") {
            cookieOptions.secret = process.env.COOKIE_SECRET;
        }
        await app.register(cookie_1.default, cookieOptions);
        // Upload dirs
        await ensureDir(UPLOAD_DIR);
        await ensureDir(INVOICES_DIR);
        // Static files
        await app.register(static_1.default, {
            root: path_1.default.join(process.cwd(), "uploads", "products"),
            prefix: "/uploads/products/",
            decorateReply: false,
        });
        await app.register(static_1.default, {
            root: path_1.default.join(process.cwd(), "uploads", "invoices"),
            prefix: "/uploads/invoices/",
            decorateReply: false,
        });
        // Routes
        app.register(shippingRules_1.default, { prefix: "/api/admin" });
        app.register(orders_2.default, { prefix: "/api/admin" });
        app.get("/api/shipping/calculate", async (request, reply) => {
            try {
                const q = request.query || {};
                const pincodeRaw = q.pincode;
                const subtotalRaw = q.subtotal;
                if (!pincodeRaw || String(pincodeRaw).trim() === "") {
                    return reply.code(400).send({ error: "pincode required" });
                }
                const pincodeDigits = String(pincodeRaw).replace(/\D/g, "");
                if (!pincodeDigits)
                    return reply.code(400).send({ error: "invalid pincode" });
                const pincode = Number(pincodeDigits);
                if (!Number.isInteger(pincode) || pincode < 10000 || pincode > 999999) {
                    return reply.code(400).send({ error: "invalid pincode" });
                }
                let subtotal = 0;
                if (subtotalRaw !== undefined && subtotalRaw !== null && String(subtotalRaw).trim() !== "") {
                    const s = Number(String(subtotalRaw));
                    if (Number.isFinite(s))
                        subtotal = s;
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
            }
            catch (err) {
                app.log.error({ err }, "shippingCalculate error");
                return reply.code(500).send({ error: err?.message || "Internal error" });
            }
        });
        app.register(auth_1.default, { prefix: "/api/auth" });
        app.register(users_1.default, { prefix: "/api" });
        app.register(products_1.default, { prefix: "/api" });
        app.register(orders_1.default, { prefix: "/api" });
        app.register(blogs_1.default, { prefix: "/api" });
        app.register(categories_1.default, { prefix: "/api" });
        app.register(cart_1.default, { prefix: "/api" });
        app.register(checkout_1.default, { prefix: "/api" });
        // health check
        app.get("/health", async () => ({ ok: true }));
        await app.ready();
        await app.listen({ port: PORT, host: HOST });
        app.log.info(`🚀 Server running at http://${HOST}:${PORT}`);
        const close = async () => {
            try {
                await app.close();
                process.exit(0);
            }
            catch (e) {
                app.log.error(e);
                process.exit(1);
            }
        };
        process.on("SIGTERM", close);
        process.on("SIGINT", close);
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
start();
// Root route
app.get("/", async () => {
    return { ok: true, message: "Welcome to GaganAyurveda API" };
});
//# sourceMappingURL=server.js.map