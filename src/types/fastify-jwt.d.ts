import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { id: number; email: string; isAdmin: boolean }; // what we put in jwt.sign()
    user: { id: number; email: string; isAdmin: boolean };    // what we get after jwtVerify()
  }
}
