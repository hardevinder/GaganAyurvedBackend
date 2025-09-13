// src/middlewares/auth.ts
import { FastifyReply, FastifyRequest } from "fastify";

// What your JWT payload/decoded user should look like
export type AuthUser = { id: number; email: string; isAdmin: boolean };

// ✅ Tell @fastify/jwt what types to use
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser; // type for jwt.sign(...)
    user: AuthUser;    // type for req.user after jwtVerify()
  }
}

// =========================
// 🔒 Auth Guard (any logged-in user)
// =========================
export async function authGuard(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify(); // req.user is now AuthUser
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

// =========================
// 🔒 Admin Guard (admins only)
// =========================
export async function adminGuard(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify(); // populates req.user
    if (!req.user.isAdmin) {
      return reply.status(403).send({ error: "Forbidden: Admins only" });
    }
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}
