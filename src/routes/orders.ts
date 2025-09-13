// src/routes/orders.ts
import { FastifyInstance } from "fastify";
import checkoutController from "../controllers/checkoutController";
import ordersController from "../controllers/ordersController";
import { adminGuard } from "../middlewares/auth";

export default async function orderRoutes(fastify: FastifyInstance) {
  // Place order (checkout)
  fastify.post("/orders", async (req, reply) => checkoutController.checkout(req, reply));

  // Admin: list all orders
  fastify.get("/orders", { preHandler: [adminGuard] }, async (req, reply) =>
    ordersController.listOrders(req, reply)
  );

  // View single order (requires auth OR guest token)
  fastify.get(
    "/orders/:orderNumber",
    {
      preHandler: [
        async (req: any, reply: any) => {
          if (typeof fastify.optionalAuthOrGuestToken === "function") {
            await fastify.optionalAuthOrGuestToken(req, reply);
          } else {
            req.log?.warn?.("auth plugin not available: optionalAuthOrGuestToken missing");
          }
        },
      ],
    },
    async (req, reply) => ordersController.getOrder(req, reply)
  );

  // Download invoice PDF (requires auth OR guest token)
  fastify.get(
    "/orders/:orderNumber/invoice.pdf",
    {
      preHandler: [
        async (req: any, reply: any) => {
          if (typeof fastify.optionalAuthOrGuestToken === "function") {
            await fastify.optionalAuthOrGuestToken(req, reply);
          } else {
            req.log?.warn?.("auth plugin not available: optionalAuthOrGuestToken missing");
          }
        },
      ],
    },
    async (req, reply) => ordersController.getInvoicePdf(req, reply)
  );
}
