import { FastifyInstance } from "fastify";
import { signup, login, googleLogin, logout, me } from "../controllers/authController";

export default async function authRoutes(app: FastifyInstance) {
  app.post("/signup", signup);
  app.post("/login", login);
  app.post("/google-login", googleLogin);
  app.post("/logout", logout);
  app.get("/me", me);
}
