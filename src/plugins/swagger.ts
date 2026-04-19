import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';

export default fp(async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'tcm.my.id API',
        description: 'REST API untuk platform komunitas TCM Indonesia (Phase 2A).',
        version: '1.0.0',
      },
      servers: [{ url: '/', description: 'Current host' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          agentKey: { type: 'apiKey', in: 'header', name: 'X-Agent-Key' },
        },
      },
      tags: [
        { name: 'health',   description: 'Health checks' },
        { name: 'auth',     description: 'Authentication & sessions' },
        { name: 'users',    description: 'User profile, bookmarks, notifications' },
        { name: 'articles', description: 'Articles (CRUD, likes, komentar)' },
        { name: 'forum',    description: 'Subforum, thread, reply' },
        { name: 'agent',    description: 'Agent-only (Paperclip)' },
        { name: 'admin',    description: 'Moderation & admin' },
      ],
    },
  });

  await fastify.register(swaggerUI, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
});
