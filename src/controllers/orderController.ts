// src/controllers/orderController.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client"; // Prisma.Decimal

type PlaceOrderBody = {
  userId?: number;
  items: { variantId: number; quantity: number }[];
  shippingAddress?: {
    name?: string;
    phone?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string | number;
    country?: string;
    isDefault?: boolean;
  };
  // paymentMethod?: string; // ❌ ignored (online only)
  customerEmail?: string;
  customerPhone?: string;
  customerName?: string;
};

function parseAndValidatePincode(value: any): number | null {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\D/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n)) return null;
  if (n < 10000 || n > 999999) return null;
  return n;
}

export const placeOrder = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const body = (req.body ?? {}) as PlaceOrderBody;
    const { userId: userIdFromBody, items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return reply.status(400).send({ error: "Items array is required" });
    }

    const userId = (req as any).user?.id ?? userIdFromBody;
    if (!userId) {
      return reply.status(401).send({ error: "Unauthorized: missing user" });
    }

    // Validate items
    for (const it of items) {
      if (!it || typeof it.variantId !== "number") {
        return reply.status(400).send({ error: "Each item must have a numeric variantId" });
      }
      if (!it || typeof it.quantity !== "number" || it.quantity <= 0) {
        return reply.status(400).send({ error: `Invalid quantity for variant ${it.variantId}` });
      }
    }

    const variantIds = items.map((i) => i.variantId);
    const prisma = (req.server as any).prisma as any;

    const variants: any[] = await prisma.variant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });

    const foundIds = new Set(variants.map((v: any) => v.id));
    const missing = variantIds.filter((id) => !foundIds.has(id));
    if (missing.length) {
      return reply.status(400).send({ error: `Variant(s) not found: ${missing.join(", ")}` });
    }

    const byId = new Map<number, any>(variants.map((v: any) => [v.id, v]));

    let subtotal = new Prisma.Decimal(0);
    for (const it of items) {
      const v = byId.get(it.variantId);
      const priceDecimal =
        v && v.price != null ? new Prisma.Decimal(String(v.price)) : new Prisma.Decimal(0);
      subtotal = subtotal.add(priceDecimal.mul(it.quantity));
    }

    let shippingAddr = body.shippingAddress ?? null;
    if (!shippingAddr) {
      const addr = await prisma.address.findFirst({
        where: { userId },
        orderBy: [{ isDefault: "desc" }, { id: "asc" }],
      });
      if (addr) {
        shippingAddr = {
          name: addr.name,
          phone: addr.phone,
          line1: addr.line1,
          line2: addr.line2,
          city: addr.city,
          state: addr.state,
          postalCode: addr.postalCode,
          country: addr.country,
        };
      }
    }

    if (!shippingAddr || !shippingAddr.postalCode) {
      return reply.status(400).send({ error: "Shipping address (with postalCode) required" });
    }

    const pincode = parseAndValidatePincode(shippingAddr.postalCode);
    if (pincode === null) {
      return reply.status(400).send({ error: "Invalid postalCode in shipping address" });
    }

    const matchingRule = await prisma.shippingRule.findFirst({
      where: {
        isActive: true,
        pincodeFrom: { lte: pincode },
        pincodeTo: { gte: pincode },
      },
      orderBy: [{ priority: "desc" }, { id: "desc" }],
    });

    let shippingDecimal = new Prisma.Decimal(0);
    if (matchingRule && matchingRule.charge != null) {
      shippingDecimal = new Prisma.Decimal(String(matchingRule.charge));
    }

    const taxDecimal = new Prisma.Decimal(0);
    const discountDecimal = new Prisma.Decimal(0);

    const grandTotal = subtotal.add(shippingDecimal).add(taxDecimal).sub(discountDecimal);

    const orderItemsCreate = items.map((it) => {
      const v = byId.get(it.variantId);
      const priceDec =
        v && v.price != null ? new Prisma.Decimal(String(v.price)) : new Prisma.Decimal(0);
      const totalDec = priceDec.mul(it.quantity);
      return {
        variantId: v.id,
        productName: v.product?.name ?? "Unknown",
        sku: v.sku ?? undefined,
        quantity: it.quantity,
        price: priceDec,
        total: totalDec,
      };
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true },
    });

    // online-only: razorpay
    const paymentMethod = "razorpay";
    const paymentStatus = "pending"; // will become "paid" after verify
    const orderStatus = "awaiting_payment";

    const guestAccessToken = null;
    const orderNumber = `ORD${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

    const createdOrder = await prisma.$transaction(async (tx: any) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          userId,
          guestAccessToken,
          customerName: body.customerName ?? user?.name ?? "Customer",
          customerEmail: String(body.customerEmail ?? user?.email ?? ""),
          customerPhone: body.customerPhone ?? user?.phone ?? undefined,
          shippingAddress: {
            name: shippingAddr.name ?? undefined,
            phone: shippingAddr.phone ?? undefined,
            line1: shippingAddr.line1 ?? undefined,
            line2: shippingAddr.line2 ?? undefined,
            city: shippingAddr.city ?? undefined,
            state: shippingAddr.state ?? undefined,
            postalCode: String(shippingAddr.postalCode),
            country: shippingAddr.country ?? "IN",
          },
          subtotal,
          shipping: shippingDecimal,
          tax: taxDecimal,
          discount: discountDecimal,
          grandTotal,
          paymentMethod,
          paymentStatus,
          orderStatus,
          items: {
            create: orderItemsCreate,
          },
        },
        include: { items: true },
      });

      return created;
    });

    return reply.status(201).send({
      message: "Order created. Proceed to online payment.",
      order: createdOrder,
      requiresOnlinePayment: true,
      nextPaymentStep: {
        createOrderUrl: "/api/payments/razorpay/create-order",
        verifyUrl: "/api/payments/razorpay/verify",
      },
      appliedShippingRule: matchingRule
        ? {
            id: matchingRule.id,
            name: matchingRule.name,
            pincodeFrom: matchingRule.pincodeFrom,
            pincodeTo: matchingRule.pincodeTo,
            charge: String(matchingRule.charge ?? "0"),
            priority: matchingRule.priority,
          }
        : null,
    });
  } catch (err: any) {
    (req as any).log?.error?.({ err }, "placeOrder failed");
    return reply.status(500).send({
      error: "Failed to create order",
      details: err?.message ?? String(err),
    });
  }
};

export default { placeOrder };
