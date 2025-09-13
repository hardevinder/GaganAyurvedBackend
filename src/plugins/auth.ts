// src/plugins/auth.ts
import { FastifyPluginAsync } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (request: any, reply: any) => Promise<void>;
    optionalAuthOrGuestToken: (request: any, reply: any) => Promise<void>;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    userId?: number | null;
    guestToken?: string | null;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // ensure request properties exist as nullable so handlers can read them
  fastify.decorateRequest("userId", null);
  fastify.decorateRequest("guestToken", null);

  /**
   * requireAuth - preHandler that enforces valid JWT and sets request.userId
   */
  fastify.decorate("requireAuth", async (request: any, reply: any) => {
    try {
      // fastify-jwt exposes request.jwtVerify()
      const payload = await request.jwtVerify();
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
  fastify.decorate("optionalAuthOrGuestToken", async (request: any, reply: any) => {
    // try JWT verify silently
    try {
      const payload = await request.jwtVerify();
      const uid = payload?.userId ?? (payload?.sub ? Number(payload.sub) : undefined);
      if (uid) request.userId = Number(uid);
    } catch (err) {
      // ignore: no valid JWT
      request.log?.debug?.({ err }, "optionalAuthOrGuestToken: jwt not present/invalid (ignored)");
    }

    // guest token may be in ?token=... or header x-guest-token or Authorization: Guest <token>
    const qtoken = (request.query && (request.query as any).token) || null;
    const hdrToken =
      (request.headers && (request.headers["x-guest-token"] || request.headers["x-guest-token".toLowerCase()])) || null;
    const authHeader = request.headers?.authorization || request.headers?.Authorization || null;

    if (qtoken && typeof qtoken === "string") {
      request.guestToken = qtoken;
      return;
    }
    if (hdrToken && typeof hdrToken === "string") {
      request.guestToken = hdrToken;
      return;
    }
    if (typeof authHeader === "string") {
      const parts = authHeader.split(/\s+/);
      if (parts.length === 2 && parts[0].toLowerCase() === "guest") {
        request.guestToken = parts[1];
      }
    }
    // nothing else to do; this function intentionally does not reply/throw
  });
};

export default authPlugin;
