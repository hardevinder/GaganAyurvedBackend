// src/routes/categories.ts
import { FastifyInstance } from "fastify";
import {
  listCategories,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController";
import { adminGuard } from "../middlewares/auth";

export default async function categoriesRoutes(app: FastifyInstance) {
  // Public
  app.get("/categories", listCategories);
  app.get("/categories/:slug", getCategoryBySlug);

  // Admin
  app.get("/admin/categories", { preHandler: adminGuard }, listCategories); // 👈 add this
  app.post("/admin/categories", { preHandler: adminGuard }, createCategory);
  app.put("/admin/categories/:id", { preHandler: adminGuard }, updateCategory);
  app.delete("/admin/categories/:id", { preHandler: adminGuard }, deleteCategory);
}
