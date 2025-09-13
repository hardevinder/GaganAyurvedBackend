// src/controllers/adminOrdersController.ts
import { FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled", "returned"] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"] as const;
type PaymentStatus = typeof PAYMENT_STATUSES[number];

/**
 * Try to update via Prisma client first. If Prisma client complains about
 * Unknown argument (i.e. client and DB/schema are out-of-sync), fallback to
 * a safe, whitelisted raw SQL update where the column name is hard-coded.
 */
async function updateOrderFieldSafe(id: number, field: "orderStatus" | "paymentStatus" | "trackingNumber" | "shippedAt", value: any) {
  try {
    // Preferred typed update (works when prisma client is up-to-date)
    const data: any = {};
    data[field] = value;
    // @ts-expect-error dynamic access; runtime will enforce field existence
    return await prisma.order.update({ where: { id }, data });
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    // if it's a schema/client mismatch error, fallback
    if (msg.includes("Unknown argument") || msg.includes("unknown argument") || msg.includes("does not exist")) {
      // Execute whitelisted raw SQL updates (column name must be literal in SQL)
      if (field === "orderStatus") {
        await prisma.$executeRaw`UPDATE "Order" SET "orderStatus" = ${value} WHERE id = ${id}`;
      } else if (field === "paymentStatus") {
        await prisma.$executeRaw`UPDATE "Order" SET "paymentStatus" = ${value} WHERE id = ${id}`;
      } else if (field === "trackingNumber") {
        await prisma.$executeRaw`UPDATE "Order" SET "trackingNumber" = ${value} WHERE id = ${id}`;
      } else if (field === "shippedAt") {
        await prisma.$executeRaw`UPDATE "Order" SET "shippedAt" = ${value} WHERE id = ${id}`;
      } else {
        throw err;
      }

      // Return refreshed order
      return await prisma.order.findUnique({ where: { id }, include: { items: true, user: true } });
    }
    // not a client mismatch — rethrow
    throw err;
  }
}

/* ---------------------------
   LIST ORDERS (with filters)
--------------------------- */
export const listOrders = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const q = (request.query as any)?.q ?? undefined;
    const page = Math.max(Number((request.query as any)?.page ?? 1), 1);
    const pageSize = Math.min(Math.max(Number((request.query as any)?.pageSize ?? 20), 1), 200);
    const skip = (page - 1) * pageSize;

    const where: any = {};
    const status = (request.query as any)?.status;
    const paymentStatus = (request.query as any)?.paymentStatus;
    const dateFrom = (request.query as any)?.dateFrom;
    const dateTo = (request.query as any)?.dateTo;

    if (status) where.orderStatus = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (dateFrom || dateTo) where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
    if (q) {
      where.OR = [
        { orderNumber: { contains: q, mode: "insensitive" } },
        { customerEmail: { contains: q, mode: "insensitive" } },
        { customerPhone: { contains: q, mode: "insensitive" } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { items: true, user: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.order.count({ where }),
    ]);

    return reply.send({ data: orders, meta: { total, page, pageSize } });
  } catch (err: any) {
    return reply.code(500).send({ error: err.message || "Internal error" });
  }
};

/* ---------------------------
   GET SINGLE ORDER
--------------------------- */
export const getOrder = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const id = Number((request.params as any).id);
    if (!id) return reply.code(400).send({ error: "Invalid order id" });

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: { include: { variant: true } }, user: true },
    });

    if (!order) return reply.code(404).send({ error: "Order not found" });
    return reply.send({ data: order });
  } catch (err: any) {
    return reply.code(500).send({ error: err.message || "Internal error" });
  }
};

/* ---------------------------
   UPDATE ORDER STATUS
--------------------------- */
export const updateOrderStatus = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const id = Number((request.params as any).id);
    const status = (request.body as any)?.status as string | undefined;
    if (!id) return reply.code(400).send({ error: "Invalid order id" });
    if (!status || !ORDER_STATUSES.includes(status as OrderStatus)) {
      return reply.code(400).send({ error: "Invalid status" });
    }

    const updated = await updateOrderFieldSafe(id, "orderStatus", status);
    return reply.send({ data: updated });
  } catch (err: any) {
    return reply.code(500).send({ error: err.message || "Internal error" });
  }
};

/* ---------------------------
   UPDATE PAYMENT STATUS
--------------------------- */
export const updatePaymentStatus = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const id = Number((request.params as any).id);
    const paymentStatus = (request.body as any)?.paymentStatus as string | undefined;
    if (!id) return reply.code(400).send({ error: "Invalid order id" });
    if (!paymentStatus || !PAYMENT_STATUSES.includes(paymentStatus as PaymentStatus)) {
      return reply.code(400).send({ error: "Invalid paymentStatus" });
    }

    const updated = await updateOrderFieldSafe(id, "paymentStatus", paymentStatus);
    return reply.send({ data: updated });
  } catch (err: any) {
    return reply.code(500).send({ error: err.message || "Internal error" });
  }
};

/* ---------------------------
   SHIP ORDER (tracking info)
--------------------------- */
export const shipOrder = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const id = Number((request.params as any).id);
    const { trackingNumber } = (request.body as any) || {};
    if (!id) return reply.code(400).send({ error: "Invalid order id" });

    // set shippedAt to now
    const shippedAt = new Date();

    // Try typed update first; fallback handled inside updateOrderFieldSafe
    try {
      // Preferred: single typed update when client supports fields
      const order = await prisma.order.update({
        where: { id },
        data: {
          // @ts-expect-error may be absent on older client
          orderStatus: "shipped",
          // @ts-expect-error may be absent on older client
          trackingNumber: trackingNumber ?? null,
          // @ts-expect-error may be absent on older client
          shippedAt,
        },
        include: { items: true, user: true },
      });
      return reply.send({ data: order });
    } catch (err: any) {
      // fallback: update fields separately via safe helper
      await updateOrderFieldSafe(id, "orderStatus", "shipped");
      await updateOrderFieldSafe(id, "trackingNumber", trackingNumber ?? null);
      await updateOrderFieldSafe(id, "shippedAt", shippedAt);
      const refreshed = await prisma.order.findUnique({ where: { id }, include: { items: true, user: true } });
      return reply.send({ data: refreshed });
    }
  } catch (err: any) {
    return reply.code(500).send({ error: err.message || "Internal error" });
  }
};

/* ---------------------------
   CANCEL ORDER (restock items)
--------------------------- */
export const cancelOrder = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const id = Number((request.params as any).id);
    const { restock = true } = (request.body as any) || {};
    if (!id) return reply.code(400).send({ error: "Invalid order id" });

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!order) throw new Error("Order not found");

      // Try typed update; on failure fall back to raw updates
      try {
        const updated = await tx.order.update({
          where: { id },
          data: {
            // @ts-expect-error may be absent on older client
            orderStatus: "cancelled",
            // @ts-expect-error may be absent on older client
            paymentStatus: order.paymentStatus === "paid" ? "refunded" : order.paymentStatus,
          },
        });

        if (restock) {
          for (const item of order.items) {
            if (item.variantId) {
              await tx.variant.update({
                where: { id: item.variantId },
                data: { stock: { increment: item.quantity } },
              });
            }
          }
        }

        return updated;
      } catch (err: any) {
        // fallback raw update
        await tx.$executeRaw`UPDATE "Order" SET "orderStatus" = ${"cancelled"}, "paymentStatus" = ${order.paymentStatus === "paid" ? "refunded" : order.paymentStatus} WHERE id = ${id}`;

        if (restock) {
          for (const item of order.items) {
            if (item.variantId) {
              await tx.variant.update({
                where: { id: item.variantId },
                data: { stock: { increment: item.quantity } },
              });
            }
          }
        }

        const refreshed = await tx.order.findUnique({ where: { id } });
        return refreshed;
      }
    });

    return reply.send({ data: result });
  } catch (err: any) {
    return reply.code(500).send({ error: err.message || "Internal error" });
  }
};
