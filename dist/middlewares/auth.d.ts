import { FastifyReply, FastifyRequest } from "fastify";
export type AuthUser = {
    id: number;
    email: string;
    isAdmin: boolean;
};
declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: AuthUser;
        user: AuthUser;
    }
}
export declare function authGuard(req: FastifyRequest, reply: FastifyReply): Promise<undefined>;
export declare function adminGuard(req: FastifyRequest, reply: FastifyReply): Promise<undefined>;
//# sourceMappingURL=auth.d.ts.map