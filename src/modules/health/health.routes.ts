import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { sendSuccess } from '../../utils/response';
import { articles } from '../../db/schema/content';
import { subforums } from '../../db/schema/forum';
import { practitionerProfiles, users } from '../../db/schema/users';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', {
    schema: {
      tags: ['health'],
      summary: 'Liveness + DB + Redis check',
    },
  }, async (_request, reply) => {
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

  fastify.get('/stats', {
    schema: {
      tags: ['health'],
      summary: 'Public homepage stats',
    },
  }, async (_request, reply) => {
    const [{ total_articles }] = await db
      .select({ total_articles: sql<number>`count(*)::int` })
      .from(articles)
      .where(and(eq(articles.status, 'published'), isNull(articles.deleted_at)));

    const [{ total_members }] = await db
      .select({ total_members: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.is_active, true));

    const [{ active_subforums }] = await db
      .select({ active_subforums: sql<number>`count(*)::int` })
      .from(subforums)
      .where(eq(subforums.is_active, true));

    const [{ verified_practitioners }] = await db
      .select({ verified_practitioners: sql<number>`count(*)::int` })
      .from(practitionerProfiles)
      .where(eq(practitionerProfiles.is_verified, true));

    return sendSuccess(reply, {
      total_articles,
      total_members,
      active_subforums,
      verified_practitioners,
    });
  });
}
