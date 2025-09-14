// src/plugins/auth.ts
import { FastifyPluginAsync } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (request: any, reply: any) => Promise<void>;
    optionalAuthOrGuestToken: (request: any, reply: any) => Promise<void>;
  }

  interface FastifyRequest {
    userId?: number | null;
    guestToken?: string | null;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // ensure request properties exist as nullable so handlers can read them
  // use decorateRequest to add typed properties at runtime
  // @ts-ignore - decorateRequest added property typings above via module augmentation
  fastify.decorateRequest("userId", null);
  // @ts-ignore
  fastify.decorateRequest("guestToken", null);

  /**
   * requireAuth - preHandler that enforces valid JWT and sets request.userId
   */
  fastify.decorate("requireAuth", async (request: any, reply: any) => {
    try {
      // fastify-jwt exposes request.jwtVerify()
      const payload: any = await request.jwtVerify();
      // try common fields: userId or sub
      const uid = payload?.userId ?? (payload?.sub ? Number(payload.sub) : undefined);
      if (!uid) {
        reply.code(401).send({ error: "Invalid token payload" });
        return;
      }
      request.userId = Number(uid);
    } catch (err: any) {
      // jwtVerify throws on invalid/missing token
      request.log?.info?.({ err }, "requireAuth: jwt verify failed");
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  /**
   * optionalAuthOrGuestToken - preHandler that attempts to extract auth info,
   * but does NOT reject; it simply sets request.userId or request.guestToken if available.
   */
  fastify.decorate("optionalAuthOrGuestToken", async (request: any, _reply: any) => {
    // try JWT verify silently
    try {
      const payload: any = await request.jwtVerify();
      const uid = payload?.userId ?? (payload?.sub ? Number(payload.sub) : undefined);
      if (uid) request.userId = Number(uid);
    } catch (err) {
      // ignore: no valid JWT
      request.log?.debug?.({ err }, "optionalAuthOrGuestToken: jwt not present/invalid (ignored)");
    }

    // guest token may be in ?token=... or header x-guest-token or Authorization: Guest <token>
    const qtoken = (request.query && (request.query as any).token) || null;

    // header keys may be lowercased by the runtime; check both common variants safely
    const hdrToken =
      (request.headers && (request.headers["x-guest-token"] || request.headers["X-Guest-Token"])) || null;

    const authHeaderRaw =
      (request.headers && (request.headers.authorization || (request.headers as any).Authorization)) || null;

    if (qtoken && typeof qtoken === "string") {
      request.guestToken = qtoken;
      return;
    }
    if (hdrToken && typeof hdrToken === "string") {
      request.guestToken = hdrToken;
      return;
    }
    if (typeof authHeaderRaw === "string") {
      // safe split — authHeaderRaw is string so parts will be an array
      const parts = authHeaderRaw.split(/\s+/);
      if (Array.isArray(parts) && parts.length === 2 && parts[0]?.toLowerCase() === "guest") {
        request.guestToken = parts[1];
      }
    }
    // intentionally do not reply/throw; this function is permissive
  });
};

export default authPlugin;
