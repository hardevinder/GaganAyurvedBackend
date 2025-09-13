"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = blogRoutes;
const blogController_1 = require("../controllers/blogController");
const auth_1 = require("../middlewares/auth");
async function blogRoutes(fastify) {
    fastify.get("/blogs", blogController_1.getBlogs);
    fastify.post("/blogs", { preHandler: [auth_1.adminGuard] }, blogController_1.addBlog);
}
//# sourceMappingURL=blogs.js.map