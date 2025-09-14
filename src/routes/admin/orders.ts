// src/routes/admin/orders.ts
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  listOrders,
  getOrder,
  updateOrderStatus,
  updatePaymentStatus,
  shipOrder,
  cancelOrder,
} from "../../controllers/adminOrdersController";
import { adminGuard } from "../../middlewares/auth";

const idParamSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer" } },
};

export default async function adminOrdersRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  fastify.get(
    "/orders",
    { preHandler: adminGuard, schema: ({ tags: ["admin", "orders"] } as any) },
    listOrders
  );

  fastify.get(
    "/orders/:id",
    { preHandler: adminGuard, schema: ({ tags: ["admin", "orders"], params: idParamSchema } as any) },
    getOrder
  );

  fastify.patch(
    "/orders/:id/status",
    {
      preHandler: adminGuard,
      schema: ({
        tags: ["admin", "orders"],
        params: idParamSchema,
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              type: "string",
              enum: ["pending", "processing", "shipped", "delivered", "cancelled", "returned"],
            },
          },
        },
      } as any),
    },
    updateOrderStatus
  );

  fastify.patch(
    "/orders/:id/payment",
    {
      preHandler: adminGuard,
      schema: ({
        tags: ["admin", "orders"],
        params: idParamSchema,
        body: {
          type: "object",
          required: ["paymentStatus"],
          properties: {
            paymentStatus: { type: "string", enum: ["pending", "paid", "failed", "refunded"] },
          },
        },
      } as any),
    },
    updatePaymentStatus
  );

  fastify.patch(
    "/orders/:id/ship",
    {
      preHandler: adminGuard,
      schema: ({
        tags: ["admin", "orders"],
        params: idParamSchema,
        body: {
          type: "object",
          properties: {
            trackingNumber: { type: ["string", "null"] },
          },
        },
      } as any),
    },
    shipOrder
  );

  fastify.post(
    "/orders/:id/cancel",
    {
      preHandler: adminGuard,
      schema: ({
        tags: ["admin", "orders"],
        params: idParamSchema,
        body: {
          type: "object",
          properties: { restock: { type: "boolean", default: true } },
        },
      } as any),
    },
    cancelOrder
  );
}
