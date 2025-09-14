"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = orderRoutes;
const checkoutController_1 = __importDefault(require("../controllers/checkoutController"));
const ordersController_1 = __importDefault(require("../controllers/ordersController"));
const auth_1 = require("../middlewares/auth");
async function orderRoutes(fastify) {
    // Place order (checkout)
    fastify.post("/orders", async (req, reply) => checkoutController_1.default.checkout(req, reply));
    // Admin: list all orders
    fastify.get("/orders", { preHandler: [auth_1.adminGuard] }, async (req, reply) => ordersController_1.default.listOrders(req, reply));
    // View single order (requires auth OR guest token)
    fastify.get("/orders/:orderNumber", {
        preHandler: [
            async (req, reply) => {
                if (typeof fastify.optionalAuthOrGuestToken === "function") {
                    await fastify.optionalAuthOrGuestToken(req, reply);
                }
                else {
                    req.log?.warn?.("auth plugin not available: optionalAuthOrGuestToken missing");
                }
            },
        ],
    }, async (req, reply) => ordersController_1.default.getOrder(req, reply));
    // Download invoice PDF (requires auth OR guest token)
    fastify.get("/orders/:orderNumber/invoice.pdf", {
        preHandler: [
            async (req, reply) => {
                if (typeof fastify.optionalAuthOrGuestToken === "function") {
                    await fastify.optionalAuthOrGuestToken(req, reply);
                }
                else {
                    req.log?.warn?.("auth plugin not available: optionalAuthOrGuestToken missing");
                }
            },
        ],
    }, async (req, reply) => ordersController_1.default.getInvoicePdf(req, reply));
}
//# sourceMappingURL=orders.js.map