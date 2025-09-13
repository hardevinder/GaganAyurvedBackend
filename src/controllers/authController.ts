import { FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

type JwtPayload = { id: number; email: string; isAdmin: boolean };

/* =========================
   👤 Signup (auto-login, header token)
========================= */
export const signup = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { name, email, password } = (req.body ?? {}) as {
      name?: string;
      email?: string;
      password?: string;
    };

    if (!name || !email || !password) {
      return reply.status(400).send({ error: "Name, email and password are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await req.server.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return reply.status(409).send({ error: "Email already registered" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await req.server.prisma.user.create({
      data: { name, email: normalizedEmail, password: hashed, provider: "credentials" },
      select: { id: true, name: true, email: true, isAdmin: true },
    });

    const accessToken = req.server.jwt.sign(
      { id: user.id, email: user.email, isAdmin: user.isAdmin } as JwtPayload,
      { expiresIn: "7d" }
    );

    return reply.status(201).send({
      message: "User registered successfully",
      user,
      accessToken,
    });
  } catch (error) {
    return reply.status(500).send({
      error: "Signup failed",
      details: (error as Error).message,
    });
  }
};

/* =========================
   🔐 Login (header token)
========================= */
export const login = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { email, password } = (req.body ?? {}) as {
      email?: string;
      password?: string;
    };

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

    const valid = await bcrypt.compare(password, userRecord.password);
    if (!valid) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const accessToken = req.server.jwt.sign(
      { id: userRecord.id, email: userRecord.email, isAdmin: userRecord.isAdmin } as JwtPayload,
      { expiresIn: "7d" }
    );

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
  } catch (error) {
    return reply.status(500).send({
      error: "Login failed",
      details: (error as Error).message,
    });
  }
};

/* =========================
   🔑 Google Login (header token)
========================= */
export const googleLogin = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { token } = (req.body ?? {}) as { token?: string };
    if (!token) return reply.status(400).send({ error: "Missing token" });
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
        password: await bcrypt.hash(Math.random().toString(36).slice(-10), 10),
      },
      select: { id: true, name: true, email: true, isAdmin: true },
    });

    const accessToken = req.server.jwt.sign(
      { id: user.id, email: user.email, isAdmin: user.isAdmin } as JwtPayload,
      { expiresIn: "7d" }
    );

    return reply.status(200).send({
      message: "Google login successful",
      user,
      accessToken,
    });
  } catch (error) {
    req.log.error({ err: error }, "Google login failed");
    return reply.status(500).send({
      error: "Google login failed",
      details: (error as Error).message,
    });
  }
};

/* =========================
   🚪 Logout (no cookie to clear)
========================= */
export const logout = async (_req: FastifyRequest, reply: FastifyReply) => {
  // With Bearer tokens, logout is client-side: drop token from storage.
  return reply.send({ message: "Logged out" });
};

/* =========================
   🙋 Me (from Authorization header)
========================= */
export const me = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    // Expects Authorization: Bearer <token>
    await req.jwtVerify<JwtPayload>();
    const id = (req.user as any).id as number;

    const user = await req.server.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, isAdmin: true, avatar: true },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });

    return reply.send({ user });
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
};
