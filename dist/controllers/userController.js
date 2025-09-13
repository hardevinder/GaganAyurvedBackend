"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsers = void 0;
const getUsers = async (req, reply) => {
    try {
        const users = await req.server.prisma.user.findMany({
            select: { id: true, name: true, email: true, isAdmin: true },
        });
        return reply.status(200).send({
            message: "Users fetched successfully",
            users,
        });
    }
    catch (error) {
        return reply.status(500).send({
            error: "Failed to fetch users",
            details: error,
        });
    }
};
exports.getUsers = getUsers;
//# sourceMappingURL=userController.js.map