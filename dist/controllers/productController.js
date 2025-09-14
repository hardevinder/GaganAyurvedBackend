"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProduct = exports.updateProduct = exports.getProduct = exports.listProducts = exports.createProduct = void 0;
const client_1 = require("@prisma/client");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const fs_1 = require("fs");
const client_s3_1 = require("@aws-sdk/client-s3");
const stream_1 = __importDefault(require("stream"));
const util_1 = require("util");
const prisma = new client_1.PrismaClient();
const pipeline = (0, util_1.promisify)(stream_1.default.pipeline);
/**
 * CONFIG (env)
 * STORAGE_DRIVER = "local" | "s3"  (default "local")
 */
const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || "local").toLowerCase();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path_1.default.join(process.cwd(), "uploads", "products");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
let s3Client = null;
const S3_BUCKET = process.env.AWS_S3_BUCKET_NAME || "";
if (STORAGE_DRIVER === "s3") {
    s3Client = new client_s3_1.S3Client({
        region: process.env.AWS_REGION || "",
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
        },
    });
}
/* ---------------------------
   Debug helper: findCycle
   --------------------------- */
function findCycle(root, maxDepth = 12, maxNodes = 20000) {
    const seen = new WeakSet();
    const stack = [];
    let nodesVisited = 0;
    function dfs(node, path, depth) {
        if (nodesVisited++ > maxNodes)
            return `TRUNCATED (visited>${maxNodes})`;
        if (node === null || typeof node !== "object")
            return null;
        if (seen.has(node)) {
            return path || "(root)";
        }
        if (depth > maxDepth)
            return null;
        seen.add(node);
        stack.push({ key: path, node });
        try {
            for (const k of Object.keys(node)) {
                try {
                    const val = node[k];
                    if (val === null || typeof val !== "object")
                        continue;
                    for (let i = stack.length - 1; i >= 0; i--) {
                        const entry = stack[i];
                        if (!entry)
                            continue;
                        if (entry.node === val) {
                            const fromPath = entry.key || "(root)";
                            return `${path ? path + "." : ""}${k} -> (back ref to ${fromPath})`;
                        }
                    }
                    const subPath = path ? `${path}.${k}` : k;
                    const res = dfs(val, subPath, depth + 1);
                    if (res)
                        return res;
                }
                catch (_e) {
                    continue;
                }
            }
        }
        finally {
            stack.pop();
        }
        return null;
    }
    return dfs(root, "", 0);
}
/* ---------------------------
   Safe JSON helpers
   --------------------------- */
function getCircularReplacer() {
    const seen = new WeakSet();
    return function (_, value) {
        if (value === null)
            return value;
        if (typeof value === "object") {
            if (seen.has(value))
                return "[Circular]";
            seen.add(value);
        }
        if (typeof value === "bigint")
            return value.toString();
        return value;
    };
}
function safeClone(obj) {
    try {
        const str = JSON.stringify(obj, getCircularReplacer());
        return JSON.parse(str);
    }
    catch (err) {
        return null;
    }
}
/* ---------------------------
   Helpers: file ops
   --------------------------- */
async function ensureUploadDir() {
    if (STORAGE_DRIVER !== "local")
        return;
    const dirToUse = UPLOAD_DIR;
    // eslint-disable-next-line no-console
    console.log("ensureUploadDir: UPLOAD_DIR=", dirToUse);
    if (!(0, fs_1.existsSync)(dirToUse))
        (0, fs_1.mkdirSync)(dirToUse, { recursive: true });
    await promises_1.default.access(dirToUse).catch(() => promises_1.default.mkdir(dirToUse, { recursive: true }));
}
function buildLocalUrl(relPath) {
    if (!PUBLIC_BASE_URL)
        return relPath;
    const p = relPath.startsWith("/") ? relPath : "/" + relPath;
    return PUBLIC_BASE_URL.replace(/\/$/, "") + p;
}
async function deleteLocalFile(relPath) {
    if (!relPath)
        return;
    try {
        const filename = path_1.default.basename(relPath);
        const filepath = path_1.default.isAbsolute(relPath) ? relPath : path_1.default.join(UPLOAD_DIR, filename);
        if ((0, fs_1.existsSync)(filepath))
            await promises_1.default.unlink(filepath);
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.warn("deleteLocalFile error:", String(err));
    }
}
async function deleteS3Object(key) {
    if (!s3Client)
        return;
    try {
        await s3Client.send(new client_s3_1.DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.warn("deleteS3Object error:", String(err));
    }
}
/* ---------------------------
   Serialization helpers
   --------------------------- */
function serializeVariant(v) {
    if (!v)
        return v;
    return {
        id: v.id,
        name: v.name,
        sku: v.sku,
        price: v.price != null ? String(v.price) : v.price,
        mrp: v.mrp != null ? String(v.mrp) : v.mrp,
        salePrice: v.salePrice != null ? String(v.salePrice) : v.salePrice,
        stock: v.stock,
        weightGrams: v.weightGrams,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
    };
}
function serializeProductSafe(raw) {
    if (!raw)
        return raw;
    const prod = {
        id: raw.id,
        name: raw.name,
        slug: raw.slug,
        description: raw.description,
        summary: raw.summary ?? null,
        brand: raw.brand ?? null,
        metaTitle: raw.metaTitle ?? null,
        metaDesc: raw.metaDesc ?? null,
        isActive: raw.isActive,
        category: raw.category
            ? {
                id: raw.category.id,
                name: raw.category.name,
                slug: raw.category.slug,
            }
            : null,
        variants: Array.isArray(raw.variants) ? raw.variants.map(serializeVariant) : [],
        images: Array.isArray(raw.images)
            ? raw.images.map((img) => ({
                id: img.id,
                url: img.url,
                alt: img.alt ?? null,
                position: img.position ?? 0,
            }))
            : [],
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
    };
    return prod;
}
/* ---------------------------
   Stream -> Buffer helper (for S3)
   --------------------------- */
async function streamToBuffer(readable) {
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}
/* ---------------------------
   Multipart file helper (unified)
   - handles attachFieldsToBody in-memory files by writing them to disk
   --------------------------- */
async function collectFilesFromRequest(request) {
    const anyReq = request;
    const collected = [];
    // Debug logging
    try {
        // eslint-disable-next-line no-console
        console.log(">>> collectFilesFromRequest START");
        // eslint-disable-next-line no-console
        console.log("  has parts fn:", typeof anyReq.parts === "function");
        // eslint-disable-next-line no-console
        console.log("  body keys:", anyReq.body ? Object.keys(anyReq.body) : null);
        // eslint-disable-next-line no-console
        console.log("  content-type:", String(request.headers?.["content-type"] || "").substring(0, 200));
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.warn("collectFilesFromRequest debug log failed:", String(e));
    }
    // Case A: attachFieldsToBody: file fields might be in request.body.images
    if (anyReq.body && anyReq.body.images) {
        const imgs = Array.isArray(anyReq.body.images) ? anyReq.body.images : [anyReq.body.images];
        await ensureUploadDir();
        for (const f of imgs) {
            try {
                // 1) If middleware already saved to disk (filepath/path) - use it
                if (f && (f.filepath || f.path)) {
                    const filepath = f.filepath || f.path;
                    const pushed = {
                        originalname: f.filename || f.originalname || path_1.default.basename(filepath),
                        path: filepath,
                        mimetype: f.mimetype || f.type,
                        location: f.location,
                        key: f.key,
                    };
                    collected.push(pushed);
                    // eslint-disable-next-line no-console
                    console.log("collectFilesFromRequest: body.images contained filepath ->", pushed);
                    continue;
                }
                // 2) In-memory buffer shapes: toBuffer(), buffer, _buf, file (Buffer)
                let buffer = null;
                if (f && typeof f.toBuffer === "function") {
                    try {
                        buffer = await f.toBuffer();
                    }
                    catch (e) {
                        buffer = null;
                    }
                }
                if (!buffer) {
                    if (f && Buffer.isBuffer(f.buffer))
                        buffer = f.buffer;
                    else if (f && Buffer.isBuffer(f.file))
                        buffer = f.file;
                    else if (f && Buffer.isBuffer(f._buf))
                        buffer = f._buf;
                    else if (f && Array.isArray(f._buf) && f._buf.every((n) => typeof n === "number")) {
                        try {
                            buffer = Buffer.from(f._buf);
                        }
                        catch {
                            buffer = null;
                        }
                    }
                }
                if (buffer) {
                    const originalname = f.filename || f.originalname || "file";
                    const ext = path_1.default.extname(originalname) || "";
                    const base = path_1.default.basename(originalname, ext).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
                    const filename = `${base}_${Date.now()}${ext || ""}`;
                    const filepath = path_1.default.join(UPLOAD_DIR, filename);
                    await promises_1.default.writeFile(filepath, buffer);
                    const pushed = {
                        originalname,
                        path: filepath,
                        mimetype: f.mimetype || f.type,
                    };
                    collected.push(pushed);
                    // eslint-disable-next-line no-console
                    console.log("collectFilesFromRequest: wrote body.images in-memory file to disk:", pushed);
                    continue;
                }
                // 3) Fallback: treat as URL/metadata or unknown shape
                const pushedFallback = {
                    originalname: f && (f.filename || f.originalname) ? (f.filename || f.originalname) : path_1.default.basename(String(f?.url || "file")),
                    path: f?.filepath || f?.path,
                    location: f?.location || f?.url,
                    mimetype: f?.mimetype || f?.type,
                    meta: f && typeof f === "object" ? { keys: Object.keys(f) } : undefined,
                };
                collected.push(pushedFallback);
                // eslint-disable-next-line no-console
                console.log("collectFilesFromRequest: body.images fallback push:", pushedFallback);
            }
            catch (err) {
                // eslint-disable-next-line no-console
                console.warn("collectFilesFromRequest: error processing body.images entry:", String(err));
            }
        }
        return collected;
    }
    // Case B: @fastify/multipart stream iterator (request.parts())
    let hasPartsFn = false;
    try {
        hasPartsFn = typeof anyReq.parts === "function";
    }
    catch (e) {
        hasPartsFn = false;
        // eslint-disable-next-line no-console
        console.warn("collectFilesFromRequest: safe-check parts getter threw:", String(e));
    }
    if (hasPartsFn) {
        try {
            // eslint-disable-next-line no-console
            console.log("collectFilesFromRequest: entering parts() iterator");
            for await (const part of anyReq.parts()) {
                if (part.file) {
                    const originalname = part.filename || "file";
                    if (STORAGE_DRIVER === "local") {
                        await ensureUploadDir();
                        const ext = path_1.default.extname(originalname);
                        const base = path_1.default.basename(originalname, ext).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
                        const filename = `${base}_${Date.now()}${ext || ""}`;
                        const filepath = path_1.default.join(UPLOAD_DIR, filename);
                        // eslint-disable-next-line no-console
                        console.log("collectFilesFromRequest: will write uploaded file:", { filename, filepath, mimetype: part.mimetype });
                        const writeStream = (0, fs_1.createWriteStream)(filepath);
                        await pipeline(part.file, writeStream);
                        const pushed = {
                            originalname,
                            path: filepath,
                            mimetype: part.mimetype,
                        };
                        collected.push(pushed);
                    }
                    else {
                        if (!s3Client)
                            throw new Error("S3 client not configured");
                        const buffer = await streamToBuffer(part.file);
                        const keyBase = `${Date.now()}_${originalname.replace(/\s+/g, "_")}`;
                        const key = keyBase;
                        const put = new client_s3_1.PutObjectCommand({
                            Bucket: S3_BUCKET,
                            Key: key,
                            Body: buffer,
                            ContentType: part.mimetype || undefined,
                        });
                        await s3Client.send(put);
                        const location = `https://${S3_BUCKET}.s3.amazonaws.com/${key}`;
                        const pushed = {
                            originalname,
                            location,
                            key,
                            mimetype: part.mimetype,
                        };
                        collected.push(pushed);
                    }
                }
                else {
                    // non-file field - ignored here (fields available in request.body when attachFieldsToBody is used)
                }
            }
            return collected;
        }
        catch (err) {
            try {
                await Promise.all(collected
                    .filter((c) => c.path && STORAGE_DRIVER === "local")
                    .map((c) => deleteLocalFile(c.path)));
            }
            catch (_) { }
            throw err;
        }
    }
    // Case C: multer-style req.files
    if (anyReq.files) {
        const files = Array.isArray(anyReq.files) ? anyReq.files : Object.values(anyReq.files).flat();
        for (const f of files) {
            collected.push({
                originalname: f.originalname || f.filename,
                path: f.path || f.filepath,
                location: f.location,
                key: f.key,
                mimetype: f.mimetype || f.contentType,
            });
        }
        return collected;
    }
    // fallback: no files found
    return collected;
}
/* ---------------------------
   Safe form field extractor
   --------------------------- */
function extractFormValue(raw) {
    if (raw == null)
        return undefined;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        return String(raw);
    }
    if (typeof raw === "object") {
        if (raw.value != null && (typeof raw.value === "string" || typeof raw.value === "number" || typeof raw.value === "boolean")) {
            return String(raw.value);
        }
        if (Array.isArray(raw) && raw.length && (typeof raw[0] === "string" || typeof raw[0] === "number")) {
            return String(raw[0]);
        }
    }
    return undefined;
}
/* ---------------------------
   CRUD helpers
   --------------------------- */
function safeLogError(request, err, ctx) {
    try {
        const shortStack = (err && err.stack && String(err.stack).split("\n").slice(0, 2).join("\n")) || undefined;
        const message = String(err && err.message ? err.message : err);
        request.log?.error?.({ message, shortStack, ctx, errCode: err?.code, meta: err?.meta });
    }
    catch (_) {
        // eslint-disable-next-line no-console
        console.error("safeLogError fallback:", String(err));
    }
}
/* ---------------------------
   Image normalization helper
   --------------------------- */
function normalizeIncomingImage(i, index = 0) {
    const folderPrefix = "/uploads/products/";
    let url = (i?.url ?? "").toString().trim();
    const alt = i?.alt ? String(i.alt).trim() : null;
    if ((!url || url === "/" || url === folderPrefix) && alt) {
        const filenameFromAlt = path_1.default.basename(alt);
        url = `${folderPrefix}${filenameFromAlt}`;
    }
    if (url && (url === folderPrefix || url.endsWith(folderPrefix) || url.endsWith("/uploads/products/")) && alt) {
        const filenameFromAlt = path_1.default.basename(alt);
        url = `${folderPrefix}${filenameFromAlt}`;
    }
    url = url.replace(/\/{2,}/g, "/");
    return {
        url,
        alt: alt ?? null,
        position: typeof i?.position === "number" ? i.position : index,
        id: i?.id ?? undefined,
    };
}
/* ---------------------------
   helper: build and validate variant list
   - ensures name exists and decimal fields are strings
   --------------------------- */
function buildValidatedVariants(arr) {
    const toNumberOrUndefined = (x) => {
        if (x === null || x === undefined || x === "")
            return undefined;
        const n = Number(x);
        return Number.isFinite(n) ? n : undefined;
    };
    return arr.map((v, idx) => {
        const rawPrice = v.price ?? v.salePrice ?? v.mrp;
        const priceNum = toNumberOrUndefined(rawPrice);
        const nameVal = v.name == null ? undefined : String(v.name).trim();
        if (!nameVal) {
            throw Object.assign(new Error(`Variant at index ${idx} missing required field "name"`), { code: "INVALID_VARIANT" });
        }
        if (priceNum === undefined) {
            throw Object.assign(new Error(`Variant at index ${idx} missing numeric price`), { code: "INVALID_VARIANT_PRICE" });
        }
        const priceStr = String(Number(priceNum).toFixed(2));
        const mrpStr = v.mrp != null && v.mrp !== "" ? String(Number(v.mrp).toFixed(2)) : undefined;
        const salePriceStr = v.salePrice != null && v.salePrice !== "" ? String(Number(v.salePrice).toFixed(2)) : undefined;
        return {
            name: nameVal,
            sku: v.sku == null ? null : String(v.sku).trim() || null,
            price: priceStr,
            mrp: mrpStr,
            salePrice: salePriceStr,
            stock: v.stock != null && v.stock !== "" ? Number(v.stock) : undefined,
            weightGrams: v.weightGrams != null && v.weightGrams !== "" ? Number(v.weightGrams) : undefined,
        };
    });
}
/* ---------------------------
   CREATE PRODUCT
--------------------------- */
const createProduct = async (request, reply) => {
    const bodyAny = request.body || {};
    // read variants from body OR (request as any).fields (multipart attachFieldsToBody / fastify multipart)
    const { variants: bodyVariants, summary: bodySummary, brand: bodyBrand, categoryId: bodyCategoryId, isActive: bodyIsActive, metaTitle: bodyMetaTitle, metaDesc: bodyMetaDesc, } = bodyAny;
    // Accept variants field from either request.body or request.fields
    const variantsField = bodyVariants ?? request.fields?.variants;
    // Collect files (uploads) — only when request is multipart
    let files = [];
    try {
        const contentType = String(request.headers?.['content-type'] || '').toLowerCase();
        if (contentType.startsWith('multipart/')) {
            files = await collectFilesFromRequest(request);
            // eslint-disable-next-line no-console
            console.log("📂 Files collected in createProduct:", files);
        }
        else {
            // not multipart — no files to collect
            // eslint-disable-next-line no-console
            console.log("📂 createProduct: non-multipart request, skipping file collection");
            files = [];
        }
    }
    catch (err) {
        safeLogError(request, err, "collectFilesFromRequest");
        const msg = String(err?.message || err || "");
        try {
            await Promise.all(files.map((f) => (f && f.path ? deleteLocalFile(f.path) : Promise.resolve())));
        }
        catch (_) { }
        if (/Unexpected end of form/i.test(msg) || /premature close/i.test(msg) || /unexpected end/i.test(msg)) {
            return reply.code(400).send({
                error: "Malformed multipart request (truncated). Please retry upload.",
                detail: msg,
            });
        }
        return reply.code(500).send({ error: "Error processing upload", detail: msg });
    }
    // --- safe extraction of form fields ---
    const rawName = (bodyAny && bodyAny.name) ?? request.fields?.name;
    const rawSlug = (bodyAny && bodyAny.slug) ?? request.fields?.slug;
    const rawDescription = (bodyAny && bodyAny.description) ?? request.fields?.description;
    const name = extractFormValue(rawName);
    const slug = extractFormValue(rawSlug);
    const description = extractFormValue(rawDescription);
    const summary = extractFormValue(bodySummary) ?? null;
    const brand = extractFormValue(bodyBrand) ?? null;
    const categoryId = bodyCategoryId ? Number(extractFormValue(bodyCategoryId) ?? bodyCategoryId) : undefined;
    const isActive = bodyIsActive === undefined ? true : extractFormValue(bodyIsActive) === "true" || bodyIsActive === true || extractFormValue(bodyIsActive) === "1";
    const metaTitle = extractFormValue(bodyMetaTitle) ?? undefined;
    const metaDesc = extractFormValue(bodyMetaDesc) ?? undefined;
    const variants = variantsField;
    if (!name || !slug || !description) {
        await Promise.all(files.map((f) => (f && f.path ? deleteLocalFile(f.path) : Promise.resolve())));
        return reply.code(400).send({ error: "name, slug and description are required" });
    }
    // Build imagesCreate (sanitize) - robust across multipart shapes
    const imagesCreateRaw = files.map((f, idx) => {
        const filename = f.path ? path_1.default.basename(f.path) : "";
        const url = filename ? `/uploads/products/${filename}` : "/uploads/products/";
        return { url, alt: f.originalname ?? null, position: idx };
    });
    // eslint-disable-next-line no-console
    console.log("🖼 imagesCreateRaw (create):", imagesCreateRaw);
    const imagesCreate = imagesCreateRaw.map((img) => {
        return {
            url: img.url == null ? "" : String(img.url),
            alt: img.alt == null ? null : String(img.alt),
            position: Number(img.position || 0),
        };
    });
    // eslint-disable-next-line no-console
    console.log("🖼 imagesCreate (create):", imagesCreate);
    // parse existingImages from client (if any)
    let existingImagesFromClient;
    try {
        const raw = bodyAny.existingImages ?? request.fields?.existingImages;
        if (raw) {
            const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (Array.isArray(arr))
                existingImagesFromClient = arr.map((it, idx) => normalizeIncomingImage(it, idx));
        }
    }
    catch (err) {
        // ignore parse errors; treat as absent
        existingImagesFromClient = undefined;
    }
    // eslint-disable-next-line no-console
    console.log("📝 existingImagesFromClient (create):", existingImagesFromClient);
    // merge uploaded images and client-provided existing images (for create we can create both)
    const mergedImagesToCreate = [
        ...imagesCreate.map((i) => normalizeIncomingImage(i)),
        ...(existingImagesFromClient || []).filter((i) => i.url && i.url !== "/uploads/products/"),
    ];
    // eslint-disable-next-line no-console
    console.log("🔀 mergedImagesToCreate (create):", mergedImagesToCreate);
    // variants parse + sanitize (derive price from price || salePrice || mrp)
    let variantCreates;
    if (variants) {
        try {
            const arr = typeof variants === "string" ? JSON.parse(variants) : variants;
            if (Array.isArray(arr)) {
                variantCreates = buildValidatedVariants(arr);
            }
        }
        catch (err) {
            await Promise.all(files.map((f) => (f && f.path ? deleteLocalFile(f.path) : Promise.resolve())));
            return reply.code(400).send({ error: "Invalid variants JSON" });
        }
    }
    try {
        // Build the `data` for Prisma and check it for cycles
        const data = {
            name,
            slug,
            description,
            summary,
            brand,
            metaTitle,
            metaDesc,
            isActive,
            category: categoryId ? { connect: { id: Number(categoryId) } } : undefined,
            images: mergedImagesToCreate.length ? { create: mergedImagesToCreate } : undefined,
            variants: variantCreates ? { create: variantCreates } : undefined,
        };
        const cycleInData = findCycle(data);
        if (cycleInData) {
            safeLogError(request, { message: `circular reference detected in prisma data: ${cycleInData}` }, "pre-prisma-check");
            return reply.code(400).send({ error: "Invalid payload (circular reference in data)", detail: cycleInData });
        }
        const created = await prisma.$transaction(async (tx) => {
            return await tx.product.create({
                data,
                include: { images: true, variants: true, category: true },
            });
        });
        // Prepare safe response
        const resp = serializeProductSafe(created);
        if (STORAGE_DRIVER === "local" && PUBLIC_BASE_URL && resp.images) {
            resp.images = resp.images.map((img) => ({ ...img, url: buildLocalUrl(img.url) }));
        }
        const safe = safeClone(resp);
        if (!safe) {
            safeLogError(request, { message: "Failed to safe-clone product response" }, "safeClone");
            return reply.code(500).send({ error: "Internal error (response serialization failed)" });
        }
        const cyclePath = findCycle(safe);
        if (cyclePath) {
            safeLogError(request, { message: `circular reference detected: ${cyclePath}` }, "findCycle");
            return reply.code(500).send({ error: "Circular reference detected in response", detail: cyclePath });
        }
        return reply.code(201).send({ data: safe });
    }
    catch (err) {
        try {
            await Promise.all(files.map((f) => (f && f.path ? deleteLocalFile(f.path) : Promise.resolve())));
        }
        catch (_) { }
        // log more details for debugging
        request.log?.error?.({ err, prismaErrorCode: err?.code, prismaMeta: err?.meta }, "createProduct error");
        safeLogError(request, err, "createProduct");
        if (err?.code === "P2002")
            return reply.code(409).send({ error: "Unique constraint failed", meta: err.meta });
        return reply.code(500).send({ error: err?.message || "Internal error" });
    }
};
exports.createProduct = createProduct;
/* ---------------------------
   LIST PRODUCTS
--------------------------- */
const listProducts = async (request, reply) => {
    try {
        const q = request.query.q;
        const limit = Math.min(parseInt(request.query.limit || "20", 10), 100);
        const page = Math.max(parseInt(request.query.page || "1", 10), 1);
        const where = {
            ...(q
                ? {
                    OR: [
                        { name: { contains: q, mode: "insensitive" } },
                        { description: { contains: q, mode: "insensitive" } },
                    ],
                }
                : {}),
            ...(request.query && request.query.categoryId ? { categoryId: Number(request.query.categoryId) } : {}),
            ...(request.query && request.query.isActive ? { isActive: request.query.isActive === "true" } : {}),
        };
        const products = await prisma.product.findMany({
            where,
            include: { variants: true, images: true, category: true },
            take: limit,
            skip: (page - 1) * limit,
            orderBy: { createdAt: "desc" },
        });
        const mapped = products.map((p) => {
            const prod = serializeProductSafe(p);
            if (STORAGE_DRIVER === "local" && PUBLIC_BASE_URL && prod.images) {
                prod.images = prod.images.map((img) => ({ ...img, url: buildLocalUrl(img.url) }));
            }
            return prod;
        });
        const safe = safeClone(mapped);
        if (!safe) {
            safeLogError(request, { message: "Failed to safe-clone product list response" }, "safeClone(list)");
            return reply.code(500).send({ error: "Internal error (response serialization failed)" });
        }
        const first = safe[0];
        const cyclePath = first ? findCycle(first) : null;
        if (cyclePath) {
            safeLogError(request, { message: `circular reference detected: ${cyclePath}` }, "findCycle(list)");
            return reply.code(500).send({ error: "Circular reference detected in response", detail: cyclePath });
        }
        return reply.send({ data: safe });
    }
    catch (err) {
        safeLogError(request, err, "listProducts");
        return reply.code(500).send({ error: err?.message || "Internal error" });
    }
};
exports.listProducts = listProducts;
/* ---------------------------
   GET PRODUCT
--------------------------- */
const getProduct = async (request, reply) => {
    try {
        const params = request.params || {};
        const idOrSlug = params.id;
        const where = isNaN(Number(idOrSlug)) ? { slug: idOrSlug } : { id: Number(idOrSlug) };
        const product = await prisma.product.findUnique({
            where,
            include: { variants: true, images: true, category: true },
        });
        if (!product)
            return reply.code(404).send({ error: "Product not found" });
        const prod = serializeProductSafe(product);
        if (STORAGE_DRIVER === "local" && PUBLIC_BASE_URL && prod.images)
            prod.images = prod.images.map((img) => ({ ...img, url: buildLocalUrl(img.url) }));
        const safe = safeClone(prod);
        if (!safe) {
            safeLogError(request, { message: "Failed to safe-clone product response" }, "safeClone(get)");
            return reply.code(500).send({ error: "Internal error (response serialization failed)" });
        }
        const cyclePath = findCycle(safe);
        if (cyclePath) {
            safeLogError(request, { message: `circular reference detected: ${cyclePath}` }, "findCycle(get)");
            return reply.code(500).send({ error: "Circular reference detected in response", detail: cyclePath });
        }
        return reply.send({ data: safe });
    }
    catch (err) {
        safeLogError(request, err, "getProduct");
        return reply.code(500).send({ error: err?.message || "Internal error" });
    }
};
exports.getProduct = getProduct;
/* ---------------------------
   UPDATE PRODUCT
   - handles uploaded files, existingImages from client, and variant replace
--------------------------- */
const updateProduct = async (request, reply) => {
    const params = request.params || {};
    const id = Number(params.id);
    if (Number.isNaN(id))
        return reply.code(400).send({ error: "Invalid product id" });
    const bodyAny = request.body || {};
    const { name: bodyName, slug: bodySlug, description: bodyDescription, summary: bodySummary, brand: bodyBrand, categoryId: bodyCategoryId, isActive: bodyIsActive, metaTitle: bodyMetaTitle, metaDesc: bodyMetaDesc, variants: bodyVariants, removeImageIds, } = bodyAny;
    // Accept variants from either request.body or request.fields
    const variantsField = bodyVariants ?? request.fields?.variants;
    // Collect files — only when request is multipart
    let files = [];
    try {
        const contentType = String(request.headers?.['content-type'] || '').toLowerCase();
        if (contentType.startsWith('multipart/')) {
            files = await collectFilesFromRequest(request);
            // eslint-disable-next-line no-console
            console.log("📂 Files collected in updateProduct:", files);
        }
        else {
            // eslint-disable-next-line no-console
            console.log("📂 updateProduct: non-multipart request, skipping file collection");
            files = [];
        }
    }
    catch (err) {
        safeLogError(request, err, "collectFilesFromRequest(update)");
        const msg = String(err?.message || err || "");
        try {
            await Promise.all(files.map((f) => (f && f.path ? deleteLocalFile(f.path) : Promise.resolve())));
        }
        catch (_) { }
        if (/Unexpected end of form/i.test(msg) || /premature close/i.test(msg) || /unexpected end/i.test(msg)) {
            return reply.code(400).send({
                error: "Malformed multipart request (truncated). Please retry upload.",
                detail: msg,
            });
        }
        return reply.code(500).send({ error: "Error processing upload", detail: msg });
    }
    await ensureUploadDir();
    // --- safe extraction of form fields for update ---
    const rawName = bodyName ?? request.fields?.name;
    const rawSlug = bodySlug ?? request.fields?.slug;
    const rawDescription = bodyDescription ?? request.fields?.description;
    const name = extractFormValue(rawName);
    const slug = extractFormValue(rawSlug);
    const description = extractFormValue(rawDescription);
    const summary = extractFormValue(bodySummary) ?? undefined;
    const brand = extractFormValue(bodyBrand) ?? undefined;
    const categoryId = bodyCategoryId ? Number(extractFormValue(bodyCategoryId) ?? bodyCategoryId) : undefined;
    const isActive = bodyIsActive === undefined ? undefined : extractFormValue(bodyIsActive) === "true" || bodyIsActive === true || extractFormValue(bodyIsActive) === "1";
    const metaTitle = extractFormValue(bodyMetaTitle) ?? undefined;
    const metaDesc = extractFormValue(bodyMetaDesc) ?? undefined;
    // Build imagesCreate for newly uploaded files
    const imagesCreateRaw = files.map((f, idx) => {
        const filename = f.path ? path_1.default.basename(f.path) : "";
        const url = filename ? `/uploads/products/${filename}` : "/uploads/products/";
        return { url, alt: f.originalname ?? null, position: idx };
    });
    // eslint-disable-next-line no-console
    console.log("🖼 imagesCreateRaw (update):", imagesCreateRaw);
    const imagesCreate = imagesCreateRaw.map((img) => {
        return {
            url: img.url == null ? "" : String(img.url),
            alt: img.alt == null ? null : String(img.alt),
            position: Number(img.position || 0),
        };
    });
    // eslint-disable-next-line no-console
    console.log("🖼 imagesCreate (update):", imagesCreate);
    // parse existingImages from client (string or object)
    let existingImagesFromClient;
    try {
        const raw = bodyAny.existingImages ?? request.fields?.existingImages;
        if (raw) {
            const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (Array.isArray(arr))
                existingImagesFromClient = arr.map((it, idx) => normalizeIncomingImage(it, idx));
        }
    }
    catch {
        existingImagesFromClient = undefined;
    }
    // eslint-disable-next-line no-console
    console.log("📝 existingImagesFromClient (update):", existingImagesFromClient);
    // variants parse + sanitize (derive price from price || salePrice || mrp)
    let variantReplaceCreates;
    if (variantsField) {
        try {
            const arr = typeof variantsField === "string" ? JSON.parse(variantsField) : variantsField;
            if (Array.isArray(arr)) {
                variantReplaceCreates = buildValidatedVariants(arr);
            }
        }
        catch (err) {
            await Promise.all(files.map((f) => (f && f.path ? deleteLocalFile(f.path) : Promise.resolve())));
            return reply.code(400).send({ error: "Invalid variants JSON" });
        }
    }
    // parse removeImageIds
    let removeIds = [];
    if (removeImageIds) {
        try {
            const arr = typeof removeImageIds === "string" ? JSON.parse(removeImageIds) : removeImageIds;
            if (Array.isArray(arr))
                removeIds = arr.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
        }
        catch {
            // ignore
        }
    }
    try {
        const updated = await prisma.$transaction(async (tx) => {
            const existing = await tx.product.findUnique({ where: { id }, include: { images: true, variants: true } });
            if (!existing)
                throw Object.assign(new Error("NotFound"), { code: "P2025" });
            const imagesToDelete = existing.images.filter((img) => removeIds.includes(img.id));
            if (removeIds.length) {
                await tx.productImage.deleteMany({ where: { id: { in: removeIds }, productId: id } });
            }
            if (variantReplaceCreates) {
                await tx.variant.deleteMany({ where: { productId: id } });
            }
            // Build images part for update:
            // - new uploaded files -> create
            // - existingImagesFromClient: if item has id -> skip (already present),
            //   if no id and has valid url -> create
            const imagesToCreateForUpdate = [
                ...imagesCreate.map((i) => normalizeIncomingImage(i)),
                ...(existingImagesFromClient || []).filter((i) => !i.id && i.url && i.url !== "/uploads/products/"),
            ];
            // eslint-disable-next-line no-console
            console.log("🔀 imagesToCreateForUpdate (update):", imagesToCreateForUpdate);
            const updateData = {
                name: name ?? existing.name,
                slug: slug ?? existing.slug,
                description: description ?? existing.description,
                summary: summary ?? existing.summary,
                brand: brand ?? existing.brand,
                metaTitle: metaTitle ?? existing.metaTitle,
                metaDesc: metaDesc ?? existing.metaDesc,
                isActive: isActive === undefined ? existing.isActive : isActive,
                category: categoryId ? { connect: { id: Number(categoryId) } } : undefined,
                images: imagesToCreateForUpdate.length ? { create: imagesToCreateForUpdate } : undefined,
            };
            // cycle-check updateData before calling prisma update
            const cycleInUpdate = findCycle(updateData);
            if (cycleInUpdate) {
                safeLogError(request, { message: `circular reference detected in update payload: ${cycleInUpdate}` }, "pre-prisma-check(update)");
                throw Object.assign(new Error("CircularInPayload"), { code: "CIRCULAR_PAYLOAD", detail: cycleInUpdate });
            }
            await tx.product.update({
                where: { id },
                data: updateData,
                include: { images: true, variants: true, category: true },
            });
            // Instead of createMany, create each variant individually (safer & clearer error handling)
            if (variantReplaceCreates) {
                for (const v of variantReplaceCreates) {
                    await tx.variant.create({
                        data: {
                            productId: id,
                            name: v.name,
                            sku: v.sku ?? null,
                            price: v.price, // already string
                            mrp: v.mrp ?? undefined,
                            salePrice: v.salePrice ?? undefined,
                            stock: v.stock ?? undefined,
                            weightGrams: v.weightGrams ?? undefined,
                        },
                    });
                }
            }
            const final = await tx.product.findUnique({ where: { id }, include: { images: true, variants: true, category: true } });
            return { product: final, deletedImages: imagesToDelete };
        });
        // delete removed images from storage
        if (updated.deletedImages && updated.deletedImages.length) {
            await Promise.all(updated.deletedImages.map(async (img) => {
                if (!img || !img.url)
                    return;
                if (STORAGE_DRIVER === "s3") {
                    try {
                        const url = img.url;
                        let key = undefined;
                        if (url.includes(`/${S3_BUCKET}/`)) {
                            const parts = url.split(`/${S3_BUCKET}/`);
                            if (parts.length > 1)
                                key = parts[1];
                        }
                        if (!key) {
                            const idx = url.indexOf(".amazonaws.com/");
                            if (idx !== -1)
                                key = url.slice(idx + ".amazonaws.com/".length);
                        }
                        if (key)
                            key = key.replace(/^\/+/, "");
                        if (key)
                            await deleteS3Object(key);
                    }
                    catch (ex) {
                        // ignore deletion errors
                    }
                }
                else {
                    await deleteLocalFile(img.url);
                }
            }));
        }
        const prod = serializeProductSafe(updated.product);
        if (STORAGE_DRIVER === "local" && PUBLIC_BASE_URL && prod.images)
            prod.images = prod.images.map((img) => ({ ...img, url: buildLocalUrl(img.url) }));
        const safe = safeClone(prod);
        if (!safe) {
            safeLogError(request, { message: "Failed to safe-clone updated product response" }, "safeClone(update)");
            return reply.code(500).send({ error: "Internal error (response serialization failed)" });
        }
        const cyclePath = findCycle(safe);
        if (cyclePath) {
            safeLogError(request, { message: `circular reference detected: ${cyclePath}` }, "findCycle(update)");
            return reply.code(500).send({ error: "Circular reference detected in response", detail: cyclePath });
        }
        return reply.send({ data: safe });
    }
    catch (err) {
        try {
            await Promise.all(files.map((f) => (f && f.path ? deleteLocalFile(f.path) : Promise.resolve())));
        }
        catch (_) { }
        // richer logging
        request.log?.error?.({ err, prismaErrorCode: err?.code, prismaMeta: err?.meta }, "updateProduct error");
        safeLogError(request, err, "updateProduct");
        if (err?.code === "P2002")
            return reply.code(409).send({ error: "Unique constraint failed", meta: err.meta });
        if (err?.code === "P2025" || err?.message === "NotFound")
            return reply.code(404).send({ error: "Product not found" });
        if (err?.code === "CIRCULAR_PAYLOAD")
            return reply.code(400).send({ error: "Invalid payload (circular reference in data)", detail: err.detail || null });
        return reply.code(500).send({ error: err?.message || "Internal error" });
    }
};
exports.updateProduct = updateProduct;
/* ---------------------------
   DELETE PRODUCT
--------------------------- */
/* ---------------------------
   DELETE PRODUCT (safe)
--------------------------- */
const deleteProduct = async (request, reply) => {
    const params = request.params || {};
    const id = Number(params.id);
    if (Number.isNaN(id))
        return reply.code(400).send({ error: "Invalid product id" });
    try {
        // Run checks + deletes in a single transaction
        const result = await prisma.$transaction(async (tx) => {
            // fetch product with images and variants
            const product = await tx.product.findUnique({
                where: { id },
                include: { images: true, variants: true },
            });
            if (!product)
                throw Object.assign(new Error("NotFound"), { code: "P2025" });
            // If there are variants, check whether any OrderItem references them.
            const variantIds = (product.variants || []).map((v) => v.id);
            if (variantIds.length) {
                // count order items that reference any of these variants
                const itemsCount = await tx.orderItem.count({ where: { variantId: { in: variantIds } } });
                if (itemsCount > 0) {
                    // Prevent hard delete if there is order history pointing to these variants.
                    // Throw a special error which we will handle below.
                    throw Object.assign(new Error("ProductHasOrders"), { code: "HAS_ORDERS", itemsCount });
                }
            }
            // Delete child images first to avoid FK constraint error
            if (product.images && product.images.length) {
                await tx.productImage.deleteMany({ where: { productId: id } });
            }
            // Safe to delete variants (we already checked order items)
            if (variantIds.length) {
                await tx.variant.deleteMany({ where: { productId: id } });
            }
            // Finally delete the product
            await tx.product.delete({ where: { id } });
            // return product + images info so we can remove files from storage afterwards
            return { images: product.images ?? [] };
        });
        // After DB transaction succeeds: delete files from storage (S3/local)
        if (result.images && result.images.length) {
            await Promise.all(result.images.map(async (img) => {
                if (!img?.url)
                    return;
                if (STORAGE_DRIVER === "s3") {
                    try {
                        const url = img.url;
                        let key = undefined;
                        if (url.includes(`/${S3_BUCKET}/`)) {
                            const parts = url.split(`/${S3_BUCKET}/`);
                            if (parts.length > 1)
                                key = parts[1];
                        }
                        if (!key) {
                            const idx = url.indexOf(".amazonaws.com/");
                            if (idx !== -1)
                                key = url.slice(idx + ".amazonaws.com/".length);
                        }
                        if (key)
                            key = key.replace(/^\/+/, "");
                        if (key)
                            await deleteS3Object(key);
                    }
                    catch (ex) {
                        // ignore storage deletion errors
                    }
                }
                else {
                    // local filesystem
                    await deleteLocalFile(img.url);
                }
            }));
        }
        return reply.code(204).send();
    }
    catch (err) {
        safeLogError(request, err, "deleteProduct");
        // If product not found
        if (err?.code === "P2025" || err?.message === "NotFound") {
            return reply.code(404).send({ error: "Product not found" });
        }
        // If we detected order items referencing variants -> do not delete; suggest soft-delete
        if (err?.code === "HAS_ORDERS" || err?.message === "ProductHasOrders") {
            const itemsCount = err?.itemsCount ?? undefined;
            return reply.code(400).send({
                error: "Cannot delete product: existing order history references this product's variants.",
                detail: itemsCount != null ? { orderItemsReferencingVariants: Number(itemsCount) } : undefined,
                suggestion: "Use soft-delete by setting isActive = false, or manually remove/adjust order data if you are sure.",
            });
        }
        return reply.code(500).send({ error: err?.message || "Internal error" });
    }
};
exports.deleteProduct = deleteProduct;
//# sourceMappingURL=productController.js.map