// src/routes/products.ts
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../controllers/productController";

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
const productRoutes: FastifyPluginAsync = async (fastify, _opts): Promise<void> => {
  // GET list (supports query params: q, page, limit, categoryId, isActive)
  fastify.get("/products", async (request: FastifyRequest, reply: FastifyReply) => {
    return listProducts(request, reply);
  });

  // GET single (id or slug)
  fastify.get<{ Params: { id: string } }>(
    "/products/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      return getProduct(request, reply);
    }
  );

  // CREATE: accepts multipart (controllers handle files)
  fastify.post("/products", async (request: FastifyRequest, reply: FastifyReply) => {
    return createProduct(request, reply);
  });

  // UPDATE: accepts multipart (controllers handle files)
  fastify.put<{ Params: { id: string } }>(
    "/products/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      return updateProduct(request, reply);
    }
  );

  // DELETE
  fastify.delete<{ Params: { id: string } }>(
    "/products/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      return deleteProduct(request, reply);
    }
  );
};

export default productRoutes;
