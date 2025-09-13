import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";

const prisma = new PrismaClient();

export default fp(async (fastify) => {
  fastify.decorate("prisma", prisma);

  // optional: disconnect on shutdown
  fastify.addHook("onClose", async (app) => {
    await app.prisma.$disconnect();
  });
});
