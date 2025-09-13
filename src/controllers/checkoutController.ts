// src/controllers/checkoutController.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { generateInvoicePdfForOrder } from "../services/invoiceService";
import { sendOrderConfirmationEmail } from "../services/emailService";

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
   Order serializer (client-friendly)
--------------------------- */
function serializeOrderForClient(raw: any) {
  if (!raw) return raw;
  return {
    id: raw.id,
    orderNumber: raw.orderNumber,
    guestAccessToken: raw.guestAccessToken ?? null,
    userId: raw.userId ?? null,
    customerName: raw.customerName,
    customerEmail: raw.customerEmail,
    customerPhone: raw.customerPhone ?? null,
    shippingAddress: raw.shippingAddress ?? null,
    subtotal: raw.subtotal != null ? String(raw.subtotal) : raw.subtotal,
    shipping: raw.shipping != null ? String(raw.shipping) : raw.shipping,
    tax: raw.tax != null ? String(raw.tax) : raw.tax,
    discount: raw.discount != null ? String(raw.discount) : raw.discount,
    grandTotal: raw.grandTotal != null ? String(raw.grandTotal) : raw.grandTotal,
    paymentMethod: raw.paymentMethod,
    paymentStatus: raw.paymentStatus,
    invoicePdfPath: raw.invoicePdfPath ?? null,
    items: Array.isArray(raw.items)
      ? raw.items.map((it: any) => ({
          id: it.id,
          orderId: it.orderId,
          variantId: it.variantId ?? null,
          productName: it.productName,
          sku: it.sku ?? null,
          quantity: it.quantity,
          price: it.price != null ? String(it.price) : it.price,
          total: it.total != null ? String(it.total) : it.total,
        }))
      : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/* ---------------------------
   Helpers
--------------------------- */
function computeTotals(cartItems: any[]) {
  const subtotal = cartItems.reduce((s: number, it: any) => {
    const price = typeof it.price === "string" ? parseFloat(it.price) : Number(it.price || 0);
    const qty = Number(it.quantity || 0);
    return s + (isFinite(price) ? price * qty : 0);
  }, 0);

  // Initial placeholders; shipping will be computed via ShippingRule below
  const shipping = 0;
  const tax = 0;
  const discount = 0;
  const grandTotal = subtotal + shipping + tax - discount;
  return { subtotal, shipping, tax, discount, grandTotal };
}

function formatOrderNumber(orderId: number, date = new Date()) {
  const d = date.toISOString().slice(0, 10).replace(/-/g, "");
  const idPart = String(orderId).padStart(6, "0");
  return `ORD-${d}-${idPart}`;
}

function parsePincode(value: any): number | null {
  try {
    const s = String(value ?? "").replace(/\D/g, "");
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    // allow 5-6 digits typical Indian pincode
    if (n < 10000 || n > 999999) return null;
    return n;
  } catch {
    return null;
  }
}

/* ---------------------------
   CHECKOUT
   POST /api/checkout
   Body:
   {
     cartId?, sessionId?, paymentMethod?,
     customer: { name, email, phone, address: { line1, line2, city, state, postalCode, country } }
   }
--------------------------- */
export const checkout = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const body: any = request.body || {};
    const query: any = request.query || {};
    const params: any = request.params || {};

    // prefer request.server.prisma if attached in your Fastify instance
    const db: PrismaClient = (request as any).server?.prisma ?? prisma;

    // auth: if you attach userId in middleware, use it
    const userId = (request as any).userId ? Number((request as any).userId) : undefined;

    const cartIdParam = body.cartId ?? query.cartId ?? params.cartId ?? undefined;
    const cartId = cartIdParam ? Number(cartIdParam) : undefined;

    let sessionId = body.sessionId ?? query.sessionId ?? undefined;
    if (!sessionId) {
      try {
        // @ts-ignore
        if (request.cookies && request.cookies.sessionId) sessionId = request.cookies.sessionId;
      } catch {}
    }

    const paymentMethod = String(body.paymentMethod ?? "cod");

    const customer = body.customer;
    if (!customer || !customer.name || !customer.email) {
      return reply.code(400).send({ error: "customer.name and customer.email required" });
    }

    // find cart (prefer cartId, then userId, then sessionId)
    let cart: any = null;
    if (cartId) {
      cart = await db.cart.findUnique({
        where: { id: cartId },
        include: { items: { include: { variant: true } } },
      });
    } else {
      cart = await findCartForCheckout({ userId, sessionId });
    }

    if (!cart || !cart.items || cart.items.length === 0) {
      return reply.code(400).send({ error: "Cart is empty" });
    }

    // compute totals (subtotal from cart items)
    const cartItems = cart.items.map((it: any) => ({
      id: it.id,
      variantId: it.variantId,
      quantity: it.quantity,
      price: it.price, // Decimal/string
      variant: it.variant,
    }));
    const totals = computeTotals(cartItems); // shipping/tax/discount will be set below

    // shipping address snapshot: accept customer.address or body.address
    const shippingAddress = customer.address ?? body.address ?? null;
    if (!shippingAddress || !shippingAddress.postalCode) {
      return reply.code(400).send({ error: "Shipping address (with postalCode) required" });
    }

    // parse postal code and find matching shipping rule
    const pincode = parsePincode(shippingAddress.postalCode);
    if (pincode === null) {
      return reply.code(400).send({ error: "Invalid postalCode in shipping address" });
    }

    const matchingRule = await db.shippingRule.findFirst({
      where: {
        isActive: true,
        pincodeFrom: { lte: pincode },
        pincodeTo: { gte: pincode },
      },
      orderBy: [{ priority: "desc" }, { id: "desc" }],
    });

    // compute shipping using rule (+ free-shipping by minOrderValue if applicable)
    let shippingNumeric = 0;
    if (matchingRule) {
      const ruleCharge =
        typeof matchingRule.charge === "string"
          ? parseFloat(matchingRule.charge)
          : Number(matchingRule.charge ?? 0);
      const mov =
        matchingRule.minOrderValue != null
          ? typeof matchingRule.minOrderValue === "string"
            ? parseFloat(matchingRule.minOrderValue)
            : Number(matchingRule.minOrderValue)
          : null;

      if (mov != null && !Number.isNaN(mov) && totals.subtotal >= mov) {
        shippingNumeric = 0;
      } else {
        shippingNumeric = Number.isFinite(ruleCharge) ? ruleCharge : 0;
      }
    } else {
      // fallback when no rule: keep as 0 (or set your default)
      shippingNumeric = 0;
    }

    const taxNumeric = 0;
    const discountNumeric = 0;
    const grandTotalNumeric = totals.subtotal + shippingNumeric + taxNumeric - discountNumeric;

    // guest token if guest
    const guestAccessToken = userId ? null : uuidv4();

    // create order & order items inside a transaction and decrement stock
    const createdOrder = await db.$transaction(async (tx) => {
      // Re-check stock for each cart item and decrement if possible
      for (const ci of cartItems) {
        const v = await tx.variant.findUnique({ where: { id: ci.variantId } });
        if (!v) {
          throw Object.assign(new Error(`VariantNotFound:${ci.variantId}`), {
            code: "VARIANT_NOT_FOUND",
            variantId: ci.variantId,
          });
        }
        if (typeof v.stock === "number" && v.stock !== null) {
          const desired = Number(ci.quantity || 0);
          if (desired > v.stock) {
            throw Object.assign(new Error(`InsufficientStock:${ci.variantId}`), {
              code: "INSUFFICIENT_STOCK",
              variantId: ci.variantId,
              available: v.stock,
            });
          }
          await tx.variant.update({
            where: { id: v.id },
            data: { stock: v.stock - desired },
          });
        }
      }

      // create order row to get ID
      const order = await tx.order.create({
        data: {
          orderNumber: "TEMP", // will set after insert
          guestAccessToken: guestAccessToken,
          userId: userId ?? null,
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: customer.phone ?? null,
          shippingAddress: shippingAddress ?? {},
          subtotal: totals.subtotal,
          shipping: shippingNumeric,
          tax: taxNumeric,
          discount: discountNumeric,
          grandTotal: grandTotalNumeric,
          paymentMethod: paymentMethod,
          paymentStatus: "pending",
          cartId: cart.id ?? null,
        },
      });

      // create order items (snapshot)
      for (const ci of cartItems) {
        const variant = ci.variant;
        const productName = variant?.name ?? "Product";
        const sku = variant?.sku ?? null;
        const price =
          typeof ci.price === "string" ? parseFloat(ci.price) : Number(ci.price || 0);
        const qty = Number(ci.quantity || 0);
        const total = price * qty;

        await tx.orderItem.create({
          data: {
            orderId: order.id,
            variantId: ci.variantId ?? null,
            productName,
            sku,
            quantity: qty,
            price,
            total,
          },
        });
      }

      // clear cart items (we keep the cart row empty)
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      // generate stable orderNumber and update
      const orderNumber = formatOrderNumber(order.id, order.createdAt ?? new Date());
      const updated = await tx.order.update({
        where: { id: order.id },
        data: { orderNumber },
        include: { items: true },
      });

      return updated;
    });

    // Generate invoice PDF (best-effort) using invoiceService
    try {
      const pdfFilename = await generateInvoicePdfForOrder(createdOrder);
      if (pdfFilename) {
        await prisma.order.update({
          where: { id: createdOrder.id },
          data: { invoicePdfPath: pdfFilename },
        });
        createdOrder.invoicePdfPath = pdfFilename;
      }
    } catch (pdfErr) {
      safeLogError(request, pdfErr, "generateInvoicePdf");
    }

    // Send confirmation email (best-effort)
    try {
      const baseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/api\/?$/i, "");
      const link = `${baseUrl}/orders/${createdOrder.orderNumber}${
        guestAccessToken ? `?token=${guestAccessToken}` : ""
      }`;
      await sendOrderConfirmationEmail({
        to: createdOrder.customerEmail,
        name: createdOrder.customerName,
        orderNumber: createdOrder.orderNumber,
        link,
        pdfFilename: createdOrder.invoicePdfPath ?? null,
      }).catch((e) => {
        safeLogError(request, e, "sendOrderConfirmationEmail");
      });
    } catch (e) {
      safeLogError(request, e, "sendOrderConfirmationEmail_outer");
    }

    // reload fresh order with items to return
    const fresh = await prisma.order.findUnique({
      where: { id: createdOrder.id },
      include: { items: true },
    });

    const resp: any = {
      orderNumber: fresh?.orderNumber,
      data: serializeOrderForClient(fresh),
      appliedShippingRule: matchingRule
        ? {
            id: matchingRule.id,
            name: matchingRule.name,
            pincodeFrom: matchingRule.pincodeFrom,
            pincodeTo: matchingRule.pincodeTo,
            charge:
              matchingRule.charge != null ? String(matchingRule.charge) : null,
            minOrderValue:
              matchingRule.minOrderValue != null
                ? String(matchingRule.minOrderValue)
                : null,
            priority: matchingRule.priority,
          }
        : null,
    };
    if (guestAccessToken) resp.guestAccessToken = guestAccessToken;

    return reply.send(resp);
  } catch (err: any) {
    // Handle expected stock/variant errors with friendly messages
    if (err?.code === "INSUFFICIENT_STOCK" || String(err.message).startsWith("InsufficientStock")) {
      const available = err?.available ?? null;
      return reply.code(400).send({ error: "Insufficient stock", available });
    }
    if (err?.code === "VARIANT_NOT_FOUND" || String(err.message).startsWith("VariantNotFound")) {
      return reply.code(400).send({ error: "Variant not found" });
    }

    safeLogError(request, err, "checkout");
    return reply.code(500).send({ error: err?.message || "Internal error" });
  }
};

/* ---------------------------
   Helper: find cart for checkout
   Prefer userId, then sessionId
--------------------------- */
async function findCartForCheckout({
  userId,
  sessionId,
}: {
  userId?: number;
  sessionId?: string;
}) {
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

/* ---------------------------
   Export
--------------------------- */
export default {
  checkout,
};
