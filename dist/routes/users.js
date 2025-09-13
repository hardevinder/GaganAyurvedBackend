"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = userRoutes;
const userController_1 = require("../controllers/userController");
const auth_1 = require("../middlewares/auth");
async function userRoutes(fastify) {
    fastify.get("/users", { preHandler: [auth_1.adminGuard] }, userController_1.getUsers);
}
//# sourceMappingURL=users.js.map