import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { sendSuccess } from '../../utils/response';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', {
    schema: {
      tags: ['health'],
      summary: 'Liveness + DB + Redis check',
    },
  }, async (request, reply) => {
    let dbStatus: 'ok' | 'error' = 'ok';
    let redisStatus: 'ok' | 'error' = 'ok';

    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      dbStatus = 'error';
    }
    try {
      const pong = await fastify.redis.ping();
      if (pong !== 'PONG') redisStatus = 'error';
    } catch {
      redisStatus = 'error';
    }

    return sendSuccess(reply, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: { db: dbStatus, redis: redisStatus },
    });
  });
}
