// src/routes/admin/shippingRules.ts
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import * as shippingCtrl from "../../controllers/admin/shippingRulesController";
import { adminGuard } from "../../middlewares/auth";

/**
 * Admin routes for ShippingRule management.
 *
 * All routes are protected by `adminGuard`.
 *
 * Additionally this file exposes a **public** endpoint:
 *   GET /api/shipping/calculate?pincode=XXXX&subtotal=NNN
 * which returns computed shipping for the provided pincode & subtotal.
 */
export default async function shippingRulesRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  // List & filter (admin)
  fastify.get(
    "/shipping-rules",
    // cast schema to any so additional keys like `tags` (used by swagger) are allowed
    { preHandler: adminGuard, schema: ({ tags: ["admin", "shipping"] } as any) },
    shippingCtrl.listShippingRules
  );

  // Create (admin)
  fastify.post(
    "/shipping-rules",
    { preHandler: adminGuard, schema: ({ tags: ["admin", "shipping"] } as any) },
    shippingCtrl.createShippingRule
  );

  // Get single (admin)
  fastify.get(
    "/shipping-rules/:id",
    { preHandler: adminGuard, schema: ({ tags: ["admin", "shipping"] } as any) },
    shippingCtrl.getShippingRule
  );

  // Update (admin)
  fastify.put(
    "/shipping-rules/:id",
    { preHandler: adminGuard, schema: ({ tags: ["admin", "shipping"] } as any) },
    shippingCtrl.updateShippingRule
  );

  // Delete (admin)
  fastify.delete(
    "/shipping-rules/:id",
    { preHandler: adminGuard, schema: ({ tags: ["admin", "shipping"] } as any) },
    shippingCtrl.deleteShippingRule
  );

  /**
   * Public shipping calculation endpoint
   *
   * Query params:
   *  - pincode (required)  : numeric pincode (5-6 digits typical)
   *  - subtotal (optional) : numeric subtotal used to evaluate minOrderValue rules (defaults to 0)
   *
   * Response:
   *  {
   *    data: {
   *      pincode: number,
   *      subtotal: number,
   *      shipping: number,
   *      appliedRule: { ...serializedShippingRule } | null
   *    }
   *  }
   */
  fastify.get(
    "/shipping/calculate",
    {
      // cast schema to any to allow `tags` and keep friendly typing for swagger
      schema: ({
        tags: ["shipping"],
        querystring: {
          type: "object",
          properties: {
            pincode: { type: "string" },
            subtotal: { type: "string" },
          },
          required: ["pincode"],
        },
      } as any),
    },
    async (request, reply) => {
      try {
        const q: any = request.query || {};
        const pincodeRaw = q.pincode;
        const subtotalRaw = q.subtotal;

        // basic parse/validation: strip non-digits and require reasonable range (5-6 digits typical)
        if (!pincodeRaw || String(pincodeRaw).trim() === "") {
          return reply.code(400).send({ error: "pincode required" });
        }
        const pincodeDigits = String(pincodeRaw).replace(/\D/g, "");
        if (!pincodeDigits) return reply.code(400).send({ error: "invalid pincode" });
        const pincode = Number(pincodeDigits);
        if (!Number.isInteger(pincode) || pincode < 10000 || pincode > 999999) {
          return reply.code(400).send({ error: "invalid pincode" });
        }

        let subtotal = 0;
        if (subtotalRaw !== undefined && subtotalRaw !== null && String(subtotalRaw).trim() !== "") {
          const s = Number(String(subtotalRaw));
          if (Number.isFinite(s)) subtotal = s;
        }

        // call controller helper
        const result = await shippingCtrl.computeShippingForPincode(pincode, subtotal);

        // normalize numeric shipping to Number
        const shippingNumber = result?.shipping != null ? Number(result.shipping) : 0;

        return reply.send({
          data: {
            pincode,
            subtotal,
            shipping: shippingNumber,
            appliedRule: result?.appliedRule ?? null,
          },
        });
      } catch (err: any) {
        // Use the same safe logging pattern if available, otherwise fallback
        try {
          (request as any).log?.error?.({ err: err?.message ?? err, ctx: "shippingCalculate" });
        } catch {}
        return reply.code(500).send({ error: err?.message ?? "Internal error" });
      }
    }
  );
}
