// src/controllers/cartController.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import cookie from "cookie";

const prisma = new PrismaClient();

/* ---------------------------
   Logging / small utils
   --------------------------- */
function safeLogError(request: any, err: any, ctx?: string) {
  try {
    const shortStack =
      (err && err.stack && String(err.stack).split("\n").slice(0, 2).join("\n")) || undefined;
    const message = String(err && err.message ? err.message : err);
    request.log?.error?.({ message, shortStack, ctx, errCode: err?.code, meta: err?.meta });
  } catch (_) {
    // eslint-disable-next-line no-console
    console.error("safeLogError fallback:", String(err));
  }
}

/* ---------------------------
   Serializer
   --------------------------- */
function serializeCartForClient(raw: any) {
  if (!raw) return raw;
  return {
    id: raw.id,
    userId: raw.userId ?? null,
    sessionId: raw.sessionId ?? null,
    items: Array.isArray(raw.items)
      ? raw.items.map((it: any) => ({
          id: it.id,
          variantId: it.variantId,
          quantity: it.quantity,
          price: it.price != null ? String(it.price) : it.price,
          variant: it.variant
            ? {
                id: it.variant.id,
                name: it.variant.name,
                sku: it.variant.sku,
                price: it.variant.price != null ? String(it.variant.price) : it.variant.price,
                stock: it.variant.stock,
              }
            : null,
        }))
      : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/* ---------------------------
   Cart lookup / create
   --------------------------- */
async function findCart({ userId, sessionId }: { userId?: number; sessionId?: string }) {
  if (userId) {
    const cart = await prisma.cart.findFirst({
      where: { userId },
      include: { items: { include: { variant: true } } },
    });
    if (cart) return cart;
  }
  if (sessionId) {
    const cart = await prisma.cart.findFirst({
      where: { sessionId },
      include: { items: { include: { variant: true } } },
    });
    if (cart) return cart;
  }
  return null;
}

async function createCart({ userId, sessionId }: { userId?: number; sessionId?: string }) {
  const data: any = {};
  if (userId) data.userId = userId;
  if (sessionId) data.sessionId = sessionId;
  const c = await prisma.cart.create({
    data,
    include: { items: { include: { variant: true } } },
  });
  return c;
}

/* ---------------------------
   Merge guest cart into user cart
   --------------------------- */
export async function mergeGuestCartIntoUserCart(sessionId: string, userId: number) {
  if (!sessionId) return;
  const guestCart = await prisma.cart.findUnique({
    where: { sessionId },
    include: { items: true },
  });
  if (!guestCart || !guestCart.items.length) return;

  // find or create user's cart
  let userCart = await prisma.cart.findFirst({ where: { userId }, include: { items: true } });
  if (!userCart) {
    userCart = await prisma.cart.create({ data: { userId }, include: { items: true } });
  }

  await prisma.$transaction(async (tx) => {
    for (const gi of guestCart!.items) {
      const existing = await tx.cartItem.findFirst({
        where: { cartId: userCart!.id, variantId: gi.variantId },
      });
      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + gi.quantity, price: gi.price },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: userCart!.id,
            variantId: gi.variantId,
            quantity: gi.quantity,
            price: gi.price,
          },
        });
      }
    }
    await tx.cartItem.deleteMany({ where: { cartId: guestCart.id } });
    await tx.cart.delete({ where: { id: guestCart.id } });
  });
}

/* ---------------------------
   GET CART
   - returns cart for user or session
--------------------------- */
export const getCart = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // If you attach userId to request via auth middleware, use it:
    const userId = (request as any).userId ? Number((request as any).userId) : undefined;

    // sessionId from query/body/cookies
    let sessionId = (request.query as any).sessionId ?? (request.body as any)?.sessionId;
    if (!sessionId) {
      try {
        // fastify-cookie plugin exposes request.cookies
        // @ts-ignore
        if (request.cookies && request.cookies.sessionId) sessionId = request.cookies.sessionId;
      } catch {}
    }

    let cart = await findCart({ userId, sessionId });
    if (!cart) {
      // return empty skeleton rather than 404
      const empty = { id: null, userId: userId ?? null, sessionId: sessionId ?? null, items: [] };
      return reply.send({ data: empty });
    }

    return reply.send({ data: serializeCartForClient(cart) });
  } catch (err: any) {
    safeLogError(request, err, "getCart");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

/* ---------------------------
   ADD TO CART
   Body: { variantId, quantity?, sessionId? }
   Returns: { data: cart, sessionId? }
--------------------------- */
export const addToCart = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const body: any = request.body || {};
    const rawVariantId = body.variantId ?? (request.query as any).variantId;
    const variantId = rawVariantId ? Number(rawVariantId) : undefined;
    let qty = body.quantity != null ? Number(body.quantity) : 1;
    if (!variantId || Number.isNaN(variantId)) return reply.code(400).send({ error: "variantId required" });
    if (!Number.isFinite(qty) || qty <= 0) qty = 1;

    const userId = (request as any).userId ? Number((request as any).userId) : undefined;

    let sessionId = body.sessionId ?? (request.query as any).sessionId;
    if (!sessionId) {
      try {
        // @ts-ignore
        if (request.cookies && request.cookies.sessionId) sessionId = request.cookies.sessionId;
      } catch {}
    }

    let newSessionIdToReturn: string | undefined = undefined;
    if (!userId && !sessionId) {
      sessionId = uuidv4();
      newSessionIdToReturn = sessionId;
    }

    const variant = await prisma.variant.findUnique({ where: { id: variantId } });
    if (!variant) return reply.code(404).send({ error: "Variant not found" });

    if (variant.stock != null && qty > variant.stock) {
      return reply.code(400).send({ error: "Insufficient stock", available: variant.stock });
    }

    let cart = await findCart({ userId, sessionId });
    if (!cart) {
      cart = await createCart({ userId, sessionId });
    }

    const updatedCart = await prisma.$transaction(async (tx) => {
      const v = await tx.variant.findUnique({ where: { id: variantId } });
      if (!v) throw Object.assign(new Error("VariantNotFound"), { code: "VARIANT_NOT_FOUND" });
      if (v.stock != null) {
        const existing = await tx.cartItem.findFirst({ where: { cartId: cart!.id, variantId } });
        const desired = existing ? existing.quantity + qty : qty;
        if (desired > v.stock) {
          throw Object.assign(new Error("InsufficientStockDuringAdd"), { code: "INSUFFICIENT_STOCK", available: v.stock });
        }
      }

      const existingItem = await tx.cartItem.findFirst({ where: { cartId: cart!.id, variantId } });

      if (existingItem) {
        await tx.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: existingItem.quantity + qty, price: String(variant.price) },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart!.id,
            variantId,
            quantity: qty,
            price: String(variant.price),
          },
        });
      }

      const fresh = await tx.cart.findUnique({
        where: { id: cart!.id },
        include: { items: { include: { variant: true } } },
      });
      if (!fresh) throw new Error("Failed to load cart");
      return fresh;
    });

    const resp: any = { data: serializeCartForClient(updatedCart) };
    if (newSessionIdToReturn) {
      resp.sessionId = newSessionIdToReturn;
      try {
        // set cookie if fastify-cookie plugin is present
        // @ts-ignore
        if (reply.setCookie) {
          reply.setCookie("sessionId", newSessionIdToReturn, {
            path: "/",
            httpOnly: false,
            sameSite: "Lax",
            maxAge: 60 * 60 * 24 * 30,
          });
        }
      } catch {}
    }

    return reply.send(resp);
  } catch (err: any) {
    if (err?.code === "INSUFFICIENT_STOCK" || err?.message === "InsufficientStockDuringAdd") {
      return reply.code(400).send({ error: "Insufficient stock", detail: err?.available });
    }
    safeLogError(request, err, "addToCart");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

/* ---------------------------
   UPDATE CART ITEM (quantity)
   PUT /api/cart/item/:id  Body: { quantity }
--------------------------- */
export const updateCartItem = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const params: any = request.params || {};
    const itemId = Number(params.id);
    if (!itemId || Number.isNaN(itemId)) return reply.code(400).send({ error: "Invalid item id" });

    const body: any = request.body || {};
    let qty = body.quantity != null ? Number(body.quantity) : undefined;
    if (qty == null || !Number.isFinite(qty) || qty < 0) return reply.code(400).send({ error: "Invalid quantity" });

    // load item & variant
    const item = await prisma.cartItem.findUnique({ where: { id: itemId }, include: { variant: true, cart: true } });
    if (!item) return reply.code(404).send({ error: "Cart item not found" });

    // if stock check
    if (item.variant && item.variant.stock != null && qty > item.variant.stock) {
      return reply.code(400).send({ error: "Insufficient stock", available: item.variant.stock });
    }

    if (qty === 0) {
      // delete the item
      await prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      await prisma.cartItem.update({ where: { id: itemId }, data: { quantity: qty } });
    }

    const fresh = await prisma.cart.findUnique({
      where: { id: item.cartId },
      include: { items: { include: { variant: true } } },
    });
    return reply.send({ data: serializeCartForClient(fresh) });
  } catch (err: any) {
    safeLogError(request, err, "updateCartItem");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

/* ---------------------------
   REMOVE FROM CART (single item)
   DELETE /api/cart/item/:id
--------------------------- */
export const removeFromCart = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const params: any = request.params || {};
    const itemId = Number(params.id);
    if (!itemId || Number.isNaN(itemId)) return reply.code(400).send({ error: "Invalid item id" });

    const existing = await prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!existing) return reply.code(404).send({ error: "Cart item not found" });

    await prisma.cartItem.delete({ where: { id: itemId } });

    const fresh = await prisma.cart.findUnique({
      where: { id: existing.cartId },
      include: { items: { include: { variant: true } } },
    });
    return reply.send({ data: serializeCartForClient(fresh) });
  } catch (err: any) {
    safeLogError(request, err, "removeFromCart");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

/* ---------------------------
   CLEAR CART (remove all items)
   DELETE /api/cart/clear   (body: { sessionId? } or user auth)
--------------------------- */
export const clearCart = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const body: any = request.body || {};
    const params: any = request.params || {};
    const query: any = request.query || {};

    const userId = (request as any).userId ? Number((request as any).userId) : undefined;

    // prefer explicit cartId (query or params)
    const cartIdParam = query.cartId ?? params.cartId ?? undefined;
    const cartId = cartIdParam ? Number(cartIdParam) : undefined;

    // sessionId from query/body/cookies
    let sessionId = body.sessionId ?? query.sessionId ?? undefined;
    if (!sessionId) {
      try {
        // @ts-ignore
        if (request.cookies && request.cookies.sessionId) sessionId = request.cookies.sessionId;
      } catch {}
    }

    // log incoming identifiers for debugging
    request.log?.info?.({
      route: "clearCart",
      cartId: cartId ?? null,
      sessionId: sessionId ?? null,
      userId: userId ?? null,
      query,
      params,
      body,
      cookies: (request as any).cookies ?? null,
    });

    // find cart (prefer cartId)
    let cart = null;
    if (cartId) {
      cart = await prisma.cart.findUnique({ where: { id: cartId }, include: { items: { include: { variant: true } } } });
    } else {
      cart = await findCart({ userId, sessionId });
    }

    if (!cart) {
      // nothing to clear — return empty skeleton to client
      const empty = { id: null, userId: userId ?? null, sessionId: sessionId ?? null, items: [] };
      return reply.send({ data: empty });
    }

    // Delete items in transaction (safest)
    await prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      // keep cart row (empty)
    });

    const fresh = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: { items: { include: { variant: true } } },
    });

    return reply.send({ data: serializeCartForClient(fresh) });
  } catch (err: any) {
    safeLogError(request, err, "clearCart");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};


/* ---------------------------
   Export default & named
--------------------------- */
export default {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  mergeGuestCartIntoUserCart,
};
