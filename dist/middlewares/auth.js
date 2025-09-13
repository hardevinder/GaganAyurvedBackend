"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authGuard = authGuard;
exports.adminGuard = adminGuard;
// =========================
// 🔒 Auth Guard (any logged-in user)
// =========================
async function authGuard(req, reply) {
    try {
        await req.jwtVerify(); // req.user is now AuthUser
    }
    catch {
        return reply.status(401).send({ error: "Unauthorized" });
    }
}
// =========================
// 🔒 Admin Guard (admins only)
// =========================
async function adminGuard(req, reply) {
    try {
        await req.jwtVerify(); // populates req.user
        if (!req.user.isAdmin) {
            return reply.status(403).send({ error: "Forbidden: Admins only" });
        }
    }
    catch {
        return reply.status(401).send({ error: "Unauthorized" });
    }
}
//# sourceMappingURL=auth.js.map