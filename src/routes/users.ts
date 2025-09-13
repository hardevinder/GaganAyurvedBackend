import { FastifyInstance } from "fastify";
import { getUsers } from "../controllers/userController";
import { adminGuard } from "../middlewares/auth";

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/users", { preHandler: [adminGuard] }, getUsers);
}
