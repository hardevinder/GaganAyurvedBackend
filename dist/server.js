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
const shippingRules_1 = __importDefault(require("./routes/admin/shippingRules")); // admin shipping rules routes
const shippingCtrl = __importStar(require("./controllers/admin/shippingRulesController")); // for computeShippingForPincode
const orders_2 = __importDefault(require("./routes/admin/orders")); // admin orders routes
const auth_2 = __importDefault(require("./plugins/auth")); // optionalAuthOrGuestToken / requireAuth
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || "0.0.0.0";
// Comma-separated list of allowed frontend origins in prod
const FRONTEND_ORIGINS = isProd
    ? (process.env.FRONTEND_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [])
    : ["http://localhost:3000"]; // dev default
const app = (0, fastify_1.default)({
    logger: true,
    trustProxy: true, // important behind proxies/load balancers
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
        // global safety handlers
        process.on("unhandledRejection", (err) => {
            app.log.error(err, "unhandledRejection");
        });
        process.on("uncaughtException", (err) => {
            app.log.error(err, "uncaughtException");
        });
        // 1) Security headers
        await app.register(helmet_1.default, {
            contentSecurityPolicy: false,
            crossOriginResourcePolicy: { policy: "cross-origin" },
        });
        // 2) Basic rate limiting
        await app.register(rate_limit_1.default, {
            max: 300,
            timeWindow: "1 minute",
            allowList: (req) => {
                const ip = String(req.ip || "");
                return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
            },
        });
        // 3) CORS — allow edit verbs + Authorization header
        await app.register(cors_1.default, {
            origin: (origin, cb) => {
                // allow server-to-server requests (no origin like curl)
                if (!origin)
                    return cb(null, true);
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
        await app.register(jwt_1.default, {
            secret: process.env.JWT_SECRET || "supersecret",
        });
        // register auth helpers plugin (decorate with optionalAuthOrGuestToken / requireAuth)
        await app.register(auth_2.default);
        // 5) Prisma
        await app.register(prisma_1.default);
        //
        // IMPORTANT: register multipart BEFORE routes that need file uploads.
        //
        await app.register(multipart_1.default, {
            limits: {
                fileSize: Number(process.env.UPLOAD_FILE_SIZE_LIMIT || 50 * 1024 * 1024),
                files: Number(process.env.UPLOAD_MAX_FILES || 10),
            },
            attachFieldsToBody: true,
        });
        // Register cookie plugin so handlers can read/set cookies (sessionId)
        // Build options object only with defined properties to satisfy strict typing
        const cookieOptions = {};
        if (process.env.COOKIE_SECRET && process.env.COOKIE_SECRET !== "") {
            cookieOptions.secret = process.env.COOKIE_SECRET;
        }
        // cast to any to avoid exactOptionalPropertyTypes mismatch in some environments
        await app.register(cookie_1.default, cookieOptions);
        // Ensure upload directories exist BEFORE registering static file serving
        await ensureDir(UPLOAD_DIR);
        await ensureDir(INVOICES_DIR);
        // 6) Static files (important for serving product images)
        await app.register(static_1.default, {
            root: path_1.default.join(process.cwd(), "uploads", "products"),
            prefix: "/uploads/products/",
            decorateReply: false,
        });
        // Serve invoices directory statically as well (optional)
        await app.register(static_1.default, {
            root: path_1.default.join(process.cwd(), "uploads", "invoices"),
            prefix: "/uploads/invoices/",
            decorateReply: false,
        });
        // Optional debug route to help diagnose uploads (safe + writes files)
        app.post("/debug-upload", async (req, reply) => {
            req.log.info({ headers: req.headers }, "debug-upload headers");
            try {
                await ensureDir(UPLOAD_DIR);
                const bodyAny = req.body || {};
                const bodyPreview = {};
                for (const k of Object.keys(bodyAny)) {
                    const v = bodyAny[k];
                    if (v instanceof Buffer)
                        bodyPreview[k] = `[Buffer ${v.length} bytes]`;
                    else if (typeof v === "object")
                        bodyPreview[k] = JSON.stringify(Object.keys(v)).slice(0, 200);
                    else
                        bodyPreview[k] = v;
                }
                const seen = [];
                const anyReq = req;
                if (typeof anyReq.multipart === "function") {
                    await new Promise((resolve, reject) => {
                        try {
                            anyReq.multipart(async (field, stream, filename, _encoding, mimetype) => {
                                void _encoding;
                                const ext = path_1.default.extname(filename || "");
                                const base = (path_1.default.basename(filename || "file", ext) || "file").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
                                const outName = `${base}_${Date.now()}${ext}`;
                                const outPath = path_1.default.join(UPLOAD_DIR, outName);
                                const writeStream = (0, fs_1.createWriteStream)(outPath);
                                try {
                                    for await (const chunk of stream) {
                                        writeStream.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
                                    }
                                    writeStream.end();
                                    await new Promise((res) => writeStream.on("close", () => res()));
                                    const stat = await promises_1.default.stat(outPath);
                                    seen.push({ type: "file", field, filename, savedAs: outName, size: stat.size, mimetype });
                                }
                                catch (e) {
                                    try {
                                        writeStream.destroy();
                                    }
                                    catch (_) { }
                                    reject(e);
                                }
                            }, (err, fields) => {
                                if (err)
                                    return reject(err);
                                if (fields) {
                                    for (const fk of Object.keys(fields)) {
                                        seen.push({ type: "field", field: fk, value: String(fields[fk]).slice(0, 400) });
                                    }
                                }
                                resolve();
                            });
                        }
                        catch (ex) {
                            reject(ex);
                        }
                    });
                }
                else if (typeof anyReq.parts === "function") {
                    for await (const p of anyReq.parts()) {
                        if (p.file) {
                            const filename = p.filename || "file";
                            const ext = path_1.default.extname(filename);
                            const base = path_1.default.basename(filename, ext).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
                            const outName = `${base}_${Date.now()}${ext}`;
                            const outPath = path_1.default.join(UPLOAD_DIR, outName);
                            const writeStream = (0, fs_1.createWriteStream)(outPath);
                            let total = 0;
                            for await (const chunk of p.file) {
                                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
                                total += buf.length;
                                writeStream.write(buf);
                            }
                            writeStream.end();
                            await new Promise((r) => writeStream.on("close", () => r()));
                            seen.push({ type: "file", field: p.fieldname, filename, savedAs: outName, size: total, mimetype: p.mimetype });
                        }
                        else {
                            seen.push({ type: "field", field: p.fieldname, value: String(p.value).slice(0, 400) });
                        }
                    }
                }
                else {
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
            }
            catch (err) {
                req.log.error(err, "debug-upload error");
                return reply.code(500).send({ error: err?.message || "err" });
            }
        });
        // 7) Register admin routes (shipping rules & orders) BEFORE other app routes so admin prefix is reserved
        // These routes include a preHandler that checks request.user?.isAdmin (see route files).
        app.register(shippingRules_1.default, { prefix: "/api/admin" });
        app.register(orders_2.default, { prefix: "/api/admin" }); // admin orders routes
        /**
         * Public shipping calculation endpoint
         * GET /api/shipping/calculate?pincode=XXXXX&subtotal=NNN
         * - no auth, lightweight validation, re-uses controller helper computeShippingForPincode
         */
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
            }
            catch (err) {
                try {
                    request.log?.error?.({ err: err?.message ?? err, ctx: "shippingCalculate" });
                }
                catch { }
                return reply.code(500).send({ error: err?.message || "Internal error" });
            }
        });
        // 8) Register application routes (after admin routes)
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
//# sourceMappingURL=server.js.map