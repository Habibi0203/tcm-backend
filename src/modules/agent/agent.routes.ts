import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { users } from '../../db/schema/users';
import { articles, categories } from '../../db/schema/content';
import { forumThreads, forumReplies, subforums } from '../../db/schema/forum';
import { sendSuccess, sendError, ErrorCodes } from '../../utils/response';
import {
  agentCreateArticleSchema, agentPatchArticleSchema,
  agentCreateThreadSchema, agentCreateReplySchema, agentModerateSchema,
} from './agent.schema';
import { createArticle, updateArticle } from '../articles/articles.service';
import { createThread, createReply, activeMembersSince } from '../forum/forum.service';
import { createNotification } from '../users/users.service';

async function findAgentUser(username?: string) {
  if (username) {
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.role, 'agent'), eq(users.username, username.toLowerCase())))
      .limit(1);
    return rows[0] ?? null;
  }

  const rows = await db.select().from(users).where(eq(users.role, 'agent')).limit(1);
  return rows[0] ?? null;
}

export default async function agentRoutes(fastify: FastifyInstance) {
  // All routes in this module require X-Agent-Key
  fastify.addHook('preHandler', fastify.requireAgent);

  // ----- POST /agent/articles -----
  fastify.post('/agent/articles', {
    schema: { tags: ['agent'], summary: 'Agent creates an article' },
  }, async (request, reply) => {
    const parsed = agentCreateArticleSchema.safeParse(request.body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join('.') || '_'] = i.message;
      return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422, fields);
    }
    const agent = await findAgentUser(parsed.data.author_username);
    if (!agent) {
      return sendError(reply, ErrorCodes.NOT_FOUND, 'Author agent tidak ditemukan', 404);
    }

    const [cat] = await db.select().from(categories).where(eq(categories.slug, parsed.data.category_slug)).limit(1);
    if (!cat) return sendError(reply, ErrorCodes.NOT_FOUND, 'Kategori tidak ditemukan', 404);

    const { category_slug, author_username, ...rest } = parsed.data;
    void category_slug;
    void author_username;
    const row = await createArticle({
      ...rest,
      category_id: cat.id,
      author_id:   agent.id,
      author_type: 'agent',
    });
    return sendSuccess(reply, { id: row.id, slug: row.slug, status: row.status }, undefined, 201);
  });

  // ----- PATCH /agent/articles/:id -----
  fastify.patch<{ Params: { id: string } }>('/agent/articles/:id', {
    schema: { tags: ['agent'], summary: 'Agent updates an article' },
  }, async (request, reply) => {
    const parsed = agentPatchArticleSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);
    const rows = await db.select().from(articles).where(eq(articles.id, request.params.id)).limit(1);
    if (!rows[0] || rows[0].deleted_at) return sendError(reply, ErrorCodes.NOT_FOUND, 'Artikel tidak ditemukan', 404);

    let category_id: string | undefined;
    if (parsed.data.category_slug) {
      const [cat] = await db.select().from(categories).where(eq(categories.slug, parsed.data.category_slug)).limit(1);
      if (!cat) return sendError(reply, ErrorCodes.NOT_FOUND, 'Kategori tidak ditemukan', 404);
      category_id = cat.id;
    }
    const { category_slug, ...rest } = parsed.data;
    void category_slug;
    const updated = await updateArticle(request.params.id, { ...rest, ...(category_id ? { category_id } : {}) });
    return sendSuccess(reply, { id: updated.id, slug: updated.slug, status: updated.status });
  });

  // ----- POST /agent/threads -----
  fastify.post('/agent/threads', {
    schema: { tags: ['agent'], summary: 'Agent seeds a thread' },
  }, async (request, reply) => {
    const parsed = agentCreateThreadSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);

    const [sf] = await db.select().from(subforums).where(eq(subforums.slug, parsed.data.subforum_slug)).limit(1);
    if (!sf) return sendError(reply, ErrorCodes.NOT_FOUND, 'Subforum tidak ditemukan', 404);

    const agent = await findAgentUser();
    if (!agent) return sendError(reply, ErrorCodes.INTERNAL_ERROR, 'Agent user tidak dikonfigurasi', 500);

    const row = await createThread({
      subforum_id:     sf.id,
      author_id:       agent.id,
      input:           { title: parsed.data.title, content: parsed.data.content },
      is_agent_seeded: true,
    });
    return sendSuccess(reply, { id: row.id, title: row.title }, undefined, 201);
  });

  // ----- POST /agent/replies -----
  fastify.post('/agent/replies', {
    schema: { tags: ['agent'], summary: 'Agent replies to a thread' },
  }, async (request, reply) => {
    const parsed = agentCreateReplySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);

    const agent = await findAgentUser();
    if (!agent) return sendError(reply, ErrorCodes.INTERNAL_ERROR, 'Agent user tidak dikonfigurasi', 500);

    const res = await createReply({
      thread_id: parsed.data.thread_id,
      author_id: agent.id,
      input:     { content: parsed.data.content, parent_reply_id: parsed.data.parent_reply_id ?? null },
      is_agent_reply: true,
    });
    if (!res.ok) {
      if (res.code === 'NESTING_EXCEEDED') {
        return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Max 1 level nesting', 422);
      }
      return sendError(reply, ErrorCodes.NOT_FOUND, 'Parent tidak ditemukan', 404);
    }
    return sendSuccess(reply, { id: res.row.id }, undefined, 201);
  });

  // ----- GET /agent/stats -----
  fastify.get('/agent/stats', {
    schema: { tags: ['agent'], summary: 'Platform stats for agent scheduling' },
  }, async (_request, reply) => {
    const [{ total_users }] = await db.select({ total_users: sql<number>`count(*)::int` }).from(users);
    const [{ total_articles }] = await db
      .select({ total_articles: sql<number>`count(*)::int` })
      .from(articles)
      .where(and(eq(articles.status, 'published'), sql`${articles.deleted_at} IS NULL`));
    const [{ total_threads }] = await db
      .select({ total_threads: sql<number>`count(*)::int` })
      .from(forumThreads)
      .where(eq(forumThreads.is_deleted, false));
    const active_24h = await activeMembersSince(24);
    return sendSuccess(reply, { total_users, total_articles, total_threads, active_members_24h: active_24h });
  });

  // ----- POST /agent/moderate -----
  fastify.post('/agent/moderate', {
    schema: { tags: ['agent'], summary: 'Agent approves or rejects an item' },
  }, async (request, reply) => {
    const parsed = agentModerateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);
    const { entity_type, entity_id, action, reason } = parsed.data;

    if (entity_type === 'article') {
      const [row] = await db.select().from(articles).where(eq(articles.id, entity_id)).limit(1);
      if (!row) return sendError(reply, ErrorCodes.NOT_FOUND, 'Artikel tidak ditemukan', 404);
      await db.update(articles).set({
        status:       action === 'approve' ? 'published' : 'archived',
        published_at: action === 'approve' ? new Date() : row.published_at,
      }).where(eq(articles.id, entity_id));
      createNotification({
        user_id: row.author_id,
        type:    action === 'approve' ? 'article_approved' : 'article_rejected',
        title:   action === 'approve' ? 'Artikel disetujui' : 'Artikel ditolak',
        body:    reason ?? null,
        link:    `/artikel/${row.slug}`,
      }).catch(() => undefined);
    } else if (entity_type === 'thread') {
      const [row] = await db.select().from(forumThreads).where(eq(forumThreads.id, entity_id)).limit(1);
      if (!row) return sendError(reply, ErrorCodes.NOT_FOUND, 'Thread tidak ditemukan', 404);
      await db.update(forumThreads).set({
        is_deleted: action === 'reject',
        is_flagged: false,
      }).where(eq(forumThreads.id, entity_id));
    } else {
      const [row] = await db.select().from(forumReplies).where(eq(forumReplies.id, entity_id)).limit(1);
      if (!row) return sendError(reply, ErrorCodes.NOT_FOUND, 'Reply tidak ditemukan', 404);
      await db.update(forumReplies).set({
        is_deleted: action === 'reject',
      }).where(eq(forumReplies.id, entity_id));
    }

    return sendSuccess(reply, { message: 'Moderasi diterapkan' });
  });
}
