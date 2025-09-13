import { FastifyInstance } from "fastify";
import { getBlogs, addBlog } from "../controllers/blogController";
import { adminGuard } from "../middlewares/auth";

export default async function blogRoutes(fastify: FastifyInstance) {
  fastify.get("/blogs", getBlogs);
  fastify.post("/blogs", { preHandler: [adminGuard] }, addBlog);
}
