"use strict";
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
async function ensureUploadDir() {
    if (!(0, fs_1.existsSync)(UPLOAD_DIR))
        (0, fs_1.mkdirSync)(UPLOAD_DIR, { recursive: true });
    await promises_1.default.access(UPLOAD_DIR).catch(() => promises_1.default.mkdir(UPLOAD_DIR, { recursive: true }));
}
async function start() {
    try {
        // 1) Security headers
        await app.register(helmet_1.default, { contentSecurityPolicy: false });
        // 2) Basic rate limiting
        await app.register(rate_limit_1.default, {
            max: 300,
            timeWindow: "1 minute",
            allowList: (req) => req.ip === "127.0.0.1",
        });
        // 3) CORS — allow edit verbs + Authorization header
        await app.register(cors_1.default, {
            origin: (origin, cb) => {
                if (!origin)
                    return cb(null, true); // allow curl/server-to-server
                const allowed = FRONTEND_ORIGINS.length > 0 && FRONTEND_ORIGINS.includes(origin);
                cb(null, allowed);
            },
            methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"],
            exposedHeaders: [],
            credentials: false, // using Bearer tokens, not cookies
            maxAge: 86400, // cache preflight for a day
        });
        // 4) JWT — Bearer tokens
        await app.register(jwt_1.default, {
            secret: process.env.JWT_SECRET || "supersecret",
        });
        // 5) Prisma
        await app.register(prisma_1.default);
        //
        // IMPORTANT: register multipart BEFORE routes that need file uploads.
        //
        await app.register(multipart_1.default, {
            limits: {
                fileSize: Number(process.env.UPLOAD_FILE_SIZE_LIMIT || 50 * 1024 * 1024), // default 50MB
                files: Number(process.env.UPLOAD_MAX_FILES || 10),
            },
            // Attach non-file fields into request.body so existing controllers that
            // read request.body.name / slug / description continue to work.
            attachFieldsToBody: true,
        });
        // 6) Static files (important for serving product images)
        await app.register(static_1.default, {
            root: path_1.default.join(process.cwd(), "uploads", "products"),
            prefix: "/uploads/products/",
            decorateReply: false,
        });
        // Optional debug route to help diagnose uploads (safe + writes files)
        app.post("/debug-upload", async (req, reply) => {
            req.log.info({ headers: req.headers }, "debug-upload headers");
            try {
                await ensureUploadDir();
                const bodyAny = req.body || {};
                // small preview of body fields without dumping Buffers
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
                // Prefer callback-style multipart if available (fastify/multipart supports request.multipart)
                if (typeof anyReq.multipart === "function") {
                    // request.multipart((field, stream, filename, encoding, mimetype) => { ... }, onFinish)
                    await new Promise((resolve, reject) => {
                        try {
                            anyReq.multipart(
                            // file handler
                            async (field, stream, filename, _encoding, mimetype) => {
                                // reference _encoding to satisfy TS lint (no unused param)
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
                            }, 
                            // onFinish callback - receives (err, fields)
                            (err, fields) => {
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
                    // fallback: async iterator parts()
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
                    // last fallback: attachFieldsToBody may have file metadata in body.images (multer-like)
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
        // 7) Register application routes (after debug route)
        app.register(auth_1.default, { prefix: "/api/auth" });
        app.register(users_1.default, { prefix: "/api" });
        app.register(products_1.default, { prefix: "/api" });
        app.register(orders_1.default, { prefix: "/api" });
        app.register(blogs_1.default, { prefix: "/api" });
        app.register(categories_1.default, { prefix: "/api" });
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