import '@fastify/jwt';

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      username: string;
      role: 'member' | 'moderator' | 'admin' | 'agent';
      membership_tier: 'free' | 'premium';
      is_active?: boolean;
      is_verified?: boolean;
    };
    isAgent: boolean;
  }

  interface FastifyInstance {
    redis: import('ioredis').Redis;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requirePremium: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requireAgent: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      id: string;
      email: string;
      username: string;
      role: string;
      membership_tier: string;
      kind?: 'access' | 'refresh';
    };
    user: {
      id: string;
      email: string;
      username: string;
      role: 'member' | 'moderator' | 'admin' | 'agent';
      membership_tier: 'free' | 'premium';
      is_active?: boolean;
      is_verified?: boolean;
    };
  }
}

export {};
