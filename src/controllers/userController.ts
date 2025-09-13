import { FastifyRequest, FastifyReply } from "fastify";

export const getUsers = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const users = await req.server.prisma.user.findMany({
      select: { id: true, name: true, email: true, isAdmin: true },
    });

    return reply.status(200).send({
      message: "Users fetched successfully",
      users,
    });
  } catch (error) {
    return reply.status(500).send({
      error: "Failed to fetch users",
      details: error,
    });
  }
};
