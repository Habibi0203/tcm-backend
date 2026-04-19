import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';

import { config } from './config';

// Plugins
import corsPlugin    from './plugins/cors';
import redisPlugin   from './plugins/redis';
import swaggerPlugin from './plugins/swagger';

// Middleware decorators
import { authenticate }   from './middleware/authenticate';
import { requirePremium } from './middleware/requirePremium';
import { requireAgent }   from './middleware/requireAgent';

// Route modules
import healthRoutes   from './modules/health/health.routes';
import authRoutes     from './modules/auth/auth.routes';
import usersRoutes    from './modules/users/users.routes';
import articlesRoutes from './modules/articles/articles.routes';
import forumRoutes    from './modules/forum/forum.routes';
import agentRoutes    from './modules/agent/agent.routes';
import adminRoutes    from './modules/admin/admin.routes';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: config.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
    },
    trustProxy: true,
  });

  // ── Plugins ──────────────────────────────────────────────────────────────
  await fastify.register(corsPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(swaggerPlugin);

  await fastify.register(fastifyCookie, {
    secret: config.JWT_SECRET, // cookie signing
  });

  await fastify.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    cookie: { cookieName: 'refresh_token', signed: false },
  });

  await fastify.register(fastifyMultipart, {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  });

  // Global rate-limit (200 req/min per IP) — uses Redis store
  await fastify.register(fastifyRateLimit, {
    global:    true,
    max:       200,
    timeWindow: '1 minute',
    redis:     fastify.redis,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, context) => ({
      success: false,
      error: {
        code:    'RATE_LIMITED',
        message: `Terlalu banyak permintaan. Coba lagi dalam ${Math.ceil(context.ttl / 1000)} detik.`,
      },
    }),
  });

  // ── Decorators (middleware as instance methods) ───────────────────────────
  fastify.decorate('authenticate',   authenticate);
  fastify.decorate('requirePremium', requirePremium);
  fastify.decorate('requireAgent',   requireAgent);

  // ── Routes ────────────────────────────────────────────────────────────────
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(usersRoutes);
  await fastify.register(articlesRoutes);
  await fastify.register(forumRoutes);
  await fastify.register(agentRoutes);
  await fastify.register(adminRoutes);

  // ── Global error handler ──────────────────────────────────────────────────
  fastify.setErrorHandler((error, _request, reply) => {
    fastify.log.error(error);
    if (error.statusCode) {
      return reply.status(error.statusCode).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message },
      });
    }
    return reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server' },
    });
  });

  fastify.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route tidak ditemukan' },
    });
  });

  return fastify;
}
