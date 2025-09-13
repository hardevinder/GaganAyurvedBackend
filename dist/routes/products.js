"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const productController_1 = require("../controllers/productController");
/**
 * Product routes (Fastify)
 *
 * IMPORTANT:
 * - This file does NOT use multer or any express-style multipart middleware.
 * - File handling is performed inside the controllers using @fastify/multipart
 *   (via request.parts() or request.body when attachFieldsToBody is enabled).
 *
 * Register this plugin in server.ts with the desired prefix, for example:
 *   app.register(productRoutes, { prefix: "/api" });
 */
const productRoutes = async (fastify, _opts) => {
    // GET list (supports query params: q, page, limit, categoryId, isActive)
    fastify.get("/products", async (request, reply) => {
        return (0, productController_1.listProducts)(request, reply);
    });
    // GET single (id or slug)
    fastify.get("/products/:id", async (request, reply) => {
        return (0, productController_1.getProduct)(request, reply);
    });
    // CREATE: accepts multipart (controllers handle files)
    fastify.post("/products", async (request, reply) => {
        return (0, productController_1.createProduct)(request, reply);
    });
    // UPDATE: accepts multipart (controllers handle files)
    fastify.put("/products/:id", async (request, reply) => {
        return (0, productController_1.updateProduct)(request, reply);
    });
    // DELETE
    fastify.delete("/products/:id", async (request, reply) => {
        return (0, productController_1.deleteProduct)(request, reply);
    });
};
exports.default = productRoutes;
//# sourceMappingURL=products.js.map