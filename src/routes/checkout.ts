// src/routes/checkout.ts
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import checkoutController from "../controllers/checkoutController";

const checkoutRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/checkout",
    {
      preHandler: [
        async (req: FastifyRequest, reply: FastifyReply) => {
          // ✅ optionalAuthOrGuestToken was added in src/plugins/auth.ts
          if (typeof fastify.optionalAuthOrGuestToken === "function") {
            try {
              await fastify.optionalAuthOrGuestToken(req, reply);
            } catch (err) {
              req.log.error({ err }, "Error in optionalAuthOrGuestToken");
              return reply.code(401).send({ error: "Unauthorized" });
            }
          } else {
            // Fallback: warn but don't block
            req.log?.warn?.(
              "auth plugin not available: optionalAuthOrGuestToken missing"
            );
          }
        },
      ],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      return checkoutController.checkout(req, reply);
    }
  );
};

export default checkoutRoutes;
