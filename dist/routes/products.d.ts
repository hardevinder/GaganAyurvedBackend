import { FastifyPluginAsync } from "fastify";
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
declare const productRoutes: FastifyPluginAsync;
export default productRoutes;
//# sourceMappingURL=products.d.ts.map