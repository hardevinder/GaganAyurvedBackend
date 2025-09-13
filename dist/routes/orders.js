"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = orderRoutes;
const orderController_1 = require("../controllers/orderController");
const auth_1 = require("../middlewares/auth");
async function orderRoutes(fastify) {
    fastify.post("/orders", { preHandler: [auth_1.authGuard] }, orderController_1.placeOrder);
    fastify.get("/orders", { preHandler: [auth_1.adminGuard] }, orderController_1.getOrders);
}
//# sourceMappingURL=orders.js.map