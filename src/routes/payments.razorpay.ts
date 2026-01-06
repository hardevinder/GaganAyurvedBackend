// src/routes/payments.razorpay.ts
import type { FastifyInstance } from "fastify";
import crypto from "crypto";
import Razorpay from "razorpay";

export async function razorpayPaymentsRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma as import("@prisma/client").PrismaClient;

  if (!prisma) {
    app.log.error(
      "Prisma not found on app. Make sure prismaPlugin registers BEFORE this route (app.decorate('prisma', prisma))."
    );
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    app.log.warn("RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET missing in env");
  }

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });

  // POST /api/payments/razorpay/create-order
  app.post("/payments/razorpay/create-order", async (req, reply) => {
    try {
      const body: any = (req as any).body || {};
      const orderNumber = String(body.orderNumber || "").trim();
      if (!orderNumber) return reply.code(400).send({ message: "orderNumber required" });

      const order = await prisma.order.findUnique({ where: { orderNumber } });
      if (!order) return reply.code(404).send({ message: "Order not found" });

      if (String(order.paymentStatus || "").toLowerCase() === "paid") {
        return reply.code(400).send({ message: "Order already paid" });
      }

      const amountPaise = Math.round(Number(order.grandTotal) * 100);
      if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
        return reply.code(400).send({ message: "Invalid amount" });
      }

      const rzOrder = await razorpay.orders.create({
        amount: amountPaise,
        currency: "INR",
        receipt: order.orderNumber,
        notes: { orderId: String(order.id), orderNumber: order.orderNumber },
      });

      await prisma.order.update({
        where: { id: order.id },
        data: {
          razorpayOrderId: rzOrder.id,
          paymentMethod: "razorpay",
          paymentStatus: "pending",
          orderStatus: "awaiting_payment",
        },
      });

      return reply.send({
        keyId: process.env.RAZORPAY_KEY_ID,
        razorpayOrderId: rzOrder.id,
        amount: rzOrder.amount,
        currency: rzOrder.currency,
        orderNumber: order.orderNumber,
      });
    } catch (err: any) {
      req.log.error({ err }, "razorpay create-order error");
      return reply.code(500).send({ message: err?.message || "Internal error" });
    }
  });

  // POST /api/payments/razorpay/verify
  app.post("/payments/razorpay/verify", async (req, reply) => {
    try {
      const body: any = (req as any).body || {};
      const orderNumber = String(body.orderNumber || "").trim();
      const razorpay_order_id = String(body.razorpay_order_id || "").trim();
      const razorpay_payment_id = String(body.razorpay_payment_id || "").trim();
      const razorpay_signature = String(body.razorpay_signature || "").trim();

      if (!orderNumber || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return reply.code(400).send({ message: "Missing fields" });
      }

      const order = await prisma.order.findUnique({ where: { orderNumber } });
      if (!order) return reply.code(404).send({ message: "Order not found" });

      if (!order.razorpayOrderId || order.razorpayOrderId !== razorpay_order_id) {
        return reply.code(400).send({ message: "Order mismatch" });
      }

      const hmacBody = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expected = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
        .update(hmacBody)
        .digest("hex");

      if (expected !== razorpay_signature) {
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: "failed" },
        });
        return reply.code(400).send({ success: false, message: "Bad signature" });
      }

      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: "paid",
          orderStatus: "placed",
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          paidAt: new Date(),
        },
      });

      return reply.send({ success: true });
    } catch (err: any) {
      req.log.error({ err }, "razorpay verify error");
      return reply.code(500).send({ message: err?.message || "Internal error" });
    }
  });
}

// ✅ If your server imports default, also export default:
export default razorpayPaymentsRoutes;
