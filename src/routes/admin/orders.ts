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
) {
  fastify.get(
    "/orders",
    { preHandler: adminGuard, schema: { tags: ["admin", "orders"] } },
    listOrders
  );

  fastify.get(
    "/orders/:id",
    { preHandler: adminGuard, schema: { tags: ["admin", "orders"], params: idParamSchema } },
    getOrder
  );

  fastify.patch(
    "/orders/:id/status",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["admin", "orders"],
        params: idParamSchema,
        body: {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", enum: ["pending","processing","shipped","delivered","cancelled","returned"] } },
        },
      },
    },
    updateOrderStatus
  );

  fastify.patch(
    "/orders/:id/payment",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["admin", "orders"],
        params: idParamSchema,
        body: {
          type: "object",
          required: ["paymentStatus"],
          properties: { paymentStatus: { type: "string", enum: ["pending","paid","failed","refunded"] } },
        },
      },
    },
    updatePaymentStatus
  );

  fastify.patch(
    "/orders/:id/ship",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["admin", "orders"],
        params: idParamSchema,
        body: {
          type: "object",
          properties: {
            trackingNumber: { type: ["string", "null"] },
          },
        },
      },
    },
    shipOrder
  );

  fastify.post(
    "/orders/:id/cancel",
    {
      preHandler: adminGuard,
      schema: {
        tags: ["admin", "orders"],
        params: idParamSchema,
        body: {
          type: "object",
          properties: { restock: { type: "boolean", default: true } },
        },
      },
    },
    cancelOrder
  );
}
