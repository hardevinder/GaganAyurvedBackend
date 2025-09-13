"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
function makeNoop(field) {
    return (req, _reply, next) => {
        // Loud warning so developer notices if this shim is still used.
        const env = process.env.NODE_ENV ?? "development";
        const msg = `[uploadMulter shim] called for field=${String(field)} (NODE_ENV=${env}). This is a NO-OP shim and does not parse multipart bodies.`;
        // Log to fastify logger if available, else console.warn
        try {
            (req.log?.warn ?? console.warn)(msg);
        }
        catch {
            console.warn(msg);
        }
        // In production, throw so we don't silently swallow uploads
        if (env === "production") {
            throw new Error("uploadMulter shim used in production — replace with real multipart handler.");
        }
        if (typeof next === "function")
            next();
        return;
    };
}
const upload = {
    single: (field) => makeNoop(field),
    array: (field, _maxCount) => makeNoop(field),
    fields: (_specs) => makeNoop(JSON.stringify(_specs)),
    none: () => makeNoop(),
};
exports.upload = upload;
exports.default = upload;
//# sourceMappingURL=uploadMulter.js.map