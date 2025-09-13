"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = categoriesRoutes;
const categoryController_1 = require("../controllers/categoryController");
const auth_1 = require("../middlewares/auth");
async function categoriesRoutes(app) {
    // Public
    app.get("/categories", categoryController_1.listCategories);
    app.get("/categories/:slug", categoryController_1.getCategoryBySlug);
    // Admin
    app.get("/admin/categories", { preHandler: auth_1.adminGuard }, categoryController_1.listCategories); // 👈 add this
    app.post("/admin/categories", { preHandler: auth_1.adminGuard }, categoryController_1.createCategory);
    app.put("/admin/categories/:id", { preHandler: auth_1.adminGuard }, categoryController_1.updateCategory);
    app.delete("/admin/categories/:id", { preHandler: auth_1.adminGuard }, categoryController_1.deleteCategory);
}
//# sourceMappingURL=categories.js.map