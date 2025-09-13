import { FastifyRequest, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client"; // for Prisma.Decimal

type PlaceOrderBody = {
  userId?: number; // if you read from JWT instead, this can be omitted
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
  paymentMethod?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerName?: string;
};

// helper: parse pincode
function parseAndValidatePincode(value: any): number | null {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\D/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n)) return null;
  if (n < 10000 || n > 999999) return null;
  return n;
}

// =========================
// 🛒 Place Order (User)
// =========================
export const placeOrder = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const body = (req.body ?? {}) as PlaceOrderBody;
    const { userId: userIdFromBody, items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return reply.status(400).send({ error: "Items array is required" });
    }

    // Prefer user id from JWT if available; fallback to body
    const userId =
      (req as any).user?.id ??
      userIdFromBody;

    if (!userId) {
      return reply.status(401).send({ error: "Unauthorized: missing user" });
    }

    // Validate quantities & collect ids
    for (const it of items) {
      if (!it?.variantId || typeof it.variantId !== "number") {
        return reply.status(400).send({ error: "Each item must have a numeric variantId" });
      }
      if (!it?.quantity || typeof it.quantity !== "number" || it.quantity <= 0) {
        return reply.status(400).send({ error: `Invalid quantity for variant ${it.variantId}` });
      }
    }

    const variantIds = items.map((i) => i.variantId);

    // Fetch all variants + product basics (for snapshot)
    const variants = await req.server.prisma.variant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });

    // Ensure all exist
    const foundIds = new Set(variants.map((v) => v.id));
    const missing = variantIds.filter((id) => !foundIds.has(id));
    if (missing.length) {
      return reply.status(400).send({ error: `Variant(s) not found: ${missing.join(", ")}` });
    }

    // Map for quick lookup
    const byId = new Map(variants.map((v) => [v.id, v]));

    // Compute subtotal using Decimal
    let subtotal = new Prisma.Decimal(0);
    for (const item of items) {
      const v = byId.get(item.variantId)!;
      const line = v.price.mul(item.quantity); // Decimal * number
      subtotal = subtotal.add(line);
    }

    // Determine shipping address:
    // Prefer shippingAddress from body; fallback to user's default address from DB
    let shippingAddr = body.shippingAddress ?? null;
    if (!shippingAddr) {
      const addr = await req.server.prisma.address.findFirst({
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

    // parse postal code -> numeric pincode
    const pincode = parseAndValidatePincode(shippingAddr.postalCode);
    if (pincode === null) {
      return reply.status(400).send({ error: "Invalid postalCode in shipping address" });
    }

    // Lookup active shipping rule covering this pincode, highest priority first
    const matchingRule = await req.server.prisma.shippingRule.findFirst({
      where: {
        isActive: true,
        pincodeFrom: { lte: pincode },
        pincodeTo: { gte: pincode },
      },
      orderBy: [{ priority: "desc" }, { id: "desc" }],
    });

    const shipping = matchingRule ? new Prisma.Decimal(matchingRule.charge) : new Prisma.Decimal(0);

    // tax/discount currently unknown — set to null or zero. Adjust as needed.
    const tax = new Prisma.Decimal(0);
    const discount = new Prisma.Decimal(0);

    const grandTotal = subtotal.add(shipping).add(tax).sub(discount);

    // Prepare order items create payload (snapshots)
    const orderItemsCreate = items.map((it) => {
      const v = byId.get(it.variantId)!;
      const price: Prisma.Decimal = v.price;
      const total = price.mul(it.quantity);
      return {
        variantId: v.id,
        productName: v.product?.name ?? "Unknown",
        sku: v.sku ?? null,
        quantity: it.quantity,
        price: price, // Decimal
        total: total, // Decimal
      };
    });

    // Fetch user for customer snapshot
    const user = await req.server.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, phone: true } });

    // generate an orderNumber (simple)
    const orderNumber = `ORD${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

    // Create order + items within a transaction
    const createdOrder = await req.server.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: userId,
          user: undefined,
          guestAccessToken: null,
          customerName: body.customerName ?? user?.name ?? "Customer",
          customerEmail: body.customerEmail ?? user?.email ?? null,
          customerPhone: body.customerPhone ?? user?.phone ?? null,
          shippingAddress: {
            name: shippingAddr.name ?? null,
            phone: shippingAddr.phone ?? null,
            line1: shippingAddr.line1 ?? null,
            line2: shippingAddr.line2 ?? null,
            city: shippingAddr.city ?? null,
            state: shippingAddr.state ?? null,
            postalCode: String(shippingAddr.postalCode),
            country: shippingAddr.country ?? "IN",
          },
          subtotal: subtotal,
          shipping: shipping,
          tax: tax,
          discount: discount,
          grandTotal: grandTotal,
          paymentMethod: body.paymentMethod ?? "unknown",
          paymentStatus: "pending",
          items: {
            create: orderItemsCreate,
          },
        },
        include: {
          items: true,
        },
      });

      return created;
    });

    return reply.status(201).send({
      message: "Order placed successfully",
      order: createdOrder,
      appliedShippingRule: matchingRule ? {
        id: matchingRule.id,
        name: matchingRule.name,
        pincodeFrom: matchingRule.pincodeFrom,
        pincodeTo: matchingRule.pincodeTo,
        charge: String(matchingRule.charge),
        priority: matchingRule.priority,
      } : null,
    });
  } catch (error: any) {
    req.log?.error?.({ err: error }, "placeOrder failed");
    return reply.status(500).send({
      error: "Failed to place order",
      details: error?.message ?? String(error),
    });
  }
};
