import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    // payload you put in jwt.sign()
    payload: {
      id: number;
      email: string;
      isAdmin: boolean;
    };

    // user type after jwtVerify()
    user: {
      id: number;
      email: string;
      isAdmin: boolean;
    };
  }
}
