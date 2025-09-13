"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.me = exports.logout = exports.googleLogin = exports.login = exports.signup = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const google_auth_library_1 = require("google-auth-library");
const client = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID);
/* =========================
   👤 Signup (auto-login, header token)
========================= */
const signup = async (req, reply) => {
    try {
        const { name, email, password } = (req.body ?? {});
        if (!name || !email || !password) {
            return reply.status(400).send({ error: "Name, email and password are required" });
        }
        const normalizedEmail = email.trim().toLowerCase();
        const existing = await req.server.prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
            return reply.status(409).send({ error: "Email already registered" });
        }
        const hashed = await bcryptjs_1.default.hash(password, 10);
        const user = await req.server.prisma.user.create({
            data: { name, email: normalizedEmail, password: hashed, provider: "credentials" },
            select: { id: true, name: true, email: true, isAdmin: true },
        });
        const accessToken = req.server.jwt.sign({ id: user.id, email: user.email, isAdmin: user.isAdmin }, { expiresIn: "7d" });
        return reply.status(201).send({
            message: "User registered successfully",
            user,
            accessToken,
        });
    }
    catch (error) {
        return reply.status(500).send({
            error: "Signup failed",
            details: error.message,
        });
    }
};
exports.signup = signup;
/* =========================
   🔐 Login (header token)
========================= */
const login = async (req, reply) => {
    try {
        const { email, password } = (req.body ?? {});
        if (!email || !password) {
            return reply.status(400).send({ error: "Email and password are required" });
        }
        const normalizedEmail = email.trim().toLowerCase();
        const userRecord = await req.server.prisma.user.findUnique({
            where: { email: normalizedEmail },
        });
        if (!userRecord) {
            return reply.status(401).send({ error: "Invalid credentials" });
        }
        // If account is Google-based, block password login (adjust if you want both)
        if (userRecord.provider === "google" || !userRecord.password) {
            return reply.status(400).send({ error: "Use Google login for this account" });
        }
        const valid = await bcryptjs_1.default.compare(password, userRecord.password);
        if (!valid) {
            return reply.status(401).send({ error: "Invalid credentials" });
        }
        const accessToken = req.server.jwt.sign({ id: userRecord.id, email: userRecord.email, isAdmin: userRecord.isAdmin }, { expiresIn: "7d" });
        const user = {
            id: userRecord.id,
            name: userRecord.name,
            email: userRecord.email,
            isAdmin: userRecord.isAdmin,
        };
        return reply.status(200).send({
            message: "Login successful",
            user,
            accessToken,
        });
    }
    catch (error) {
        return reply.status(500).send({
            error: "Login failed",
            details: error.message,
        });
    }
};
exports.login = login;
/* =========================
   🔑 Google Login (header token)
========================= */
const googleLogin = async (req, reply) => {
    try {
        const { token } = (req.body ?? {});
        if (!token)
            return reply.status(400).send({ error: "Missing token" });
        if (!process.env.GOOGLE_CLIENT_ID) {
            throw new Error("GOOGLE_CLIENT_ID is not set in environment variables");
        }
        // Verify Google ID token
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload?.email) {
            return reply.status(401).send({ error: "Invalid Google token: no email" });
        }
        if (payload.email_verified === false) {
            return reply.status(401).send({ error: "Google email not verified" });
        }
        const email = payload.email.trim().toLowerCase();
        const name = payload.name ?? "Google User";
        const avatar = payload.picture ?? null;
        // Upsert to avoid race conditions
        const user = await req.server.prisma.user.upsert({
            where: { email },
            update: { name, avatar, provider: "google" },
            create: {
                name,
                email,
                avatar,
                provider: "google",
                // store random hash to satisfy NOT NULL if your schema still requires it
                password: await bcryptjs_1.default.hash(Math.random().toString(36).slice(-10), 10),
            },
            select: { id: true, name: true, email: true, isAdmin: true },
        });
        const accessToken = req.server.jwt.sign({ id: user.id, email: user.email, isAdmin: user.isAdmin }, { expiresIn: "7d" });
        return reply.status(200).send({
            message: "Google login successful",
            user,
            accessToken,
        });
    }
    catch (error) {
        req.log.error({ err: error }, "Google login failed");
        return reply.status(500).send({
            error: "Google login failed",
            details: error.message,
        });
    }
};
exports.googleLogin = googleLogin;
/* =========================
   🚪 Logout (no cookie to clear)
========================= */
const logout = async (_req, reply) => {
    // With Bearer tokens, logout is client-side: drop token from storage.
    return reply.send({ message: "Logged out" });
};
exports.logout = logout;
/* =========================
   🙋 Me (from Authorization header)
========================= */
const me = async (req, reply) => {
    try {
        // Expects Authorization: Bearer <token>
        await req.jwtVerify();
        const id = req.user.id;
        const user = await req.server.prisma.user.findUnique({
            where: { id },
            select: { id: true, name: true, email: true, isAdmin: true, avatar: true },
        });
        if (!user)
            return reply.code(404).send({ error: "User not found" });
        return reply.send({ user });
    }
    catch {
        return reply.code(401).send({ error: "Unauthorized" });
    }
};
exports.me = me;
//# sourceMappingURL=authController.js.map