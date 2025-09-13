// src/middleware/uploadMulter.ts
import type { FastifyRequest, FastifyReply } from "fastify";

function makeNoop(field?: any) {
  return (req: FastifyRequest, _reply: FastifyReply, next?: () => void) => {
    // Loud warning so developer notices if this shim is still used.
    const env = process.env.NODE_ENV ?? "development";
    const msg = `[uploadMulter shim] called for field=${String(field)} (NODE_ENV=${env}). This is a NO-OP shim and does not parse multipart bodies.`;
    // Log to fastify logger if available, else console.warn
    try {
      (req.log?.warn ?? console.warn)(msg);
    } catch {
      console.warn(msg);
    }

    // In production, throw so we don't silently swallow uploads
    if (env === "production") {
      throw new Error("uploadMulter shim used in production — replace with real multipart handler.");
    }

    if (typeof next === "function") next();
    return;
  };
}

const upload: any = {
  single: (field: string) => makeNoop(field),
  array: (field: string, _maxCount?: number) => makeNoop(field),
  fields: (_specs: any[]) => makeNoop(JSON.stringify(_specs)),
  none: () => makeNoop(),
};

export default upload;
export { upload };
