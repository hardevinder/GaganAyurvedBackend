// src/routes/cart.ts (example)
import { FastifyPluginAsync } from "fastify";
import cartController from "../controllers/cartController";

const cartRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/cart", async (req, reply) => cartController.getCart(req, reply));
  fastify.post("/cart/add", async (req, reply) => cartController.addToCart(req, reply));
  fastify.put("/cart/item/:id", async (req, reply) => cartController.updateCartItem(req, reply));
  fastify.delete("/cart/item/:id", async (req, reply) => cartController.removeFromCart(req, reply));
  fastify.delete("/cart/clear", async (req, reply) => cartController.clearCart(req, reply));
};
export default cartRoutes;
