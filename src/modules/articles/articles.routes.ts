import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { articles, categories } from '../../db/schema/content';
import { sendSuccess, sendError, ErrorCodes } from '../../utils/response';
import { buildMeta } from '../../utils/paginate';
import {
  listArticlesQuerySchema, createArticleSchema, updateArticleSchema, createCommentSchema,
} from './articles.schema';
import {
  listPublishedArticles, getArticleDetail,
  incrementViewCount, createArticle, updateArticle, softDeleteArticle,
  likeArticle, unlikeArticle,
  listComments, createComment, softDeleteComment, likeComment, unlikeComment,
  canEditArticle,
} from './articles.service';

async function tryAuth(request: FastifyRequest): Promise<boolean> {
  try {
    await request.jwtVerify();
    return true;
  } catch {
    return false;
  }
}

export default async function articlesRoutes(fastify: FastifyInstance) {
  // ----- GET /articles (list) -----
  fastify.get('/articles', {
    schema: { tags: ['articles'], summary: 'List published articles' },
  }, async (request, reply) => {
    const parsed = listArticlesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Query tidak valid', 422);
    }
    const q = parsed.data;
    const { rows, total } = await listPublishedArticles(q);
    return sendSuccess(reply, rows, buildMeta(total, q.page, q.per_page));
  });

  // ----- GET /articles/categories -----
  fastify.get('/articles/categories', {
    schema: { tags: ['articles'], summary: 'List active article categories' },
  }, async (_request, reply) => {
    const rows = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        description: categories.description,
        color_hex: categories.color_hex,
        sort_order: categories.sort_order,
        article_count: sql<number>`count(${articles.id})::int`,
      })
      .from(categories)
      .leftJoin(
        articles,
        and(
          eq(articles.category_id, categories.id),
          eq(articles.status, 'published'),
          sql`${articles.deleted_at} IS NULL`,
        ),
      )
      .where(eq(categories.is_active, true))
      .groupBy(categories.id)
      .orderBy(categories.sort_order, categories.name);

    return sendSuccess(reply, rows);
  });

  // ----- GET /articles/:slug -----
  fastify.get<{ Params: { slug: string } }>('/articles/:slug', {
    schema: { tags: ['articles'], summary: 'Article detail (truncated for free on premium)' },
  }, async (request, reply) => {
    const authed = await tryAuth(request);
    const viewer = authed ? request.user : undefined;
    const detail = await getArticleDetail(request.params.slug, viewer);
    if (!detail) return sendError(reply, ErrorCodes.NOT_FOUND, 'Artikel tidak ditemukan', 404);
    if (detail.status !== 'published') {
      // Non-published only visible to author/admin/mod/agent
      const isPrivileged = viewer && (viewer.role === 'admin' || viewer.role === 'moderator' || viewer.role === 'agent' || detail.author?.id === viewer.id);
      if (!isPrivileged) return sendError(reply, ErrorCodes.NOT_FOUND, 'Artikel tidak ditemukan', 404);
    }
    // Fire-and-forget view increment
    incrementViewCount(detail.id).catch(() => undefined);
    return sendSuccess(reply, detail);
  });

  // ----- POST /articles -----
  fastify.post('/articles', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['articles'], summary: 'Create an article' },
  }, async (request, reply) => {
    const parsed = createArticleSchema.safeParse(request.body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join('.') || '_'] = i.message;
      return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422, fields);
    }
    const row = await createArticle({
      ...parsed.data,
      author_id:   request.user.id,
      author_type: 'user',
    });
    return sendSuccess(reply, { id: row.id, slug: row.slug, status: row.status }, undefined, 201);
  });

  // ----- PATCH /articles/:id -----
  fastify.patch<{ Params: { id: string } }>('/articles/:id', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['articles'], summary: 'Update an article' },
  }, async (request, reply) => {
    const rows = await db.select().from(articles).where(eq(articles.id, request.params.id)).limit(1);
    const existing = rows[0];
    if (!existing || existing.deleted_at) return sendError(reply, ErrorCodes.NOT_FOUND, 'Artikel tidak ditemukan', 404);
    if (!canEditArticle(existing, request.user)) return sendError(reply, ErrorCodes.FORBIDDEN, 'Tidak punya akses', 403);
    const parsed = updateArticleSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);
    const updated = await updateArticle(request.params.id, parsed.data);
    return sendSuccess(reply, { id: updated.id, slug: updated.slug, status: updated.status });
  });

  // ----- DELETE /articles/:id -----
  fastify.delete<{ Params: { id: string } }>('/articles/:id', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['articles'], summary: 'Soft-delete article' },
  }, async (request, reply) => {
    const rows = await db.select().from(articles).where(eq(articles.id, request.params.id)).limit(1);
    const existing = rows[0];
    if (!existing || existing.deleted_at) return sendError(reply, ErrorCodes.NOT_FOUND, 'Artikel tidak ditemukan', 404);
    if (!canEditArticle(existing, request.user)) return sendError(reply, ErrorCodes.FORBIDDEN, 'Tidak punya akses', 403);
    await softDeleteArticle(request.params.id);
    return sendSuccess(reply, { message: 'Artikel dihapus' });
  });

  // ----- POST /articles/:id/like -----
  fastify.post<{ Params: { id: string } }>('/articles/:id/like', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['articles'], summary: 'Like an article' },
  }, async (request, reply) => {
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.id, request.params.id)).limit(1);
    if (!rows[0]) return sendError(reply, ErrorCodes.NOT_FOUND, 'Artikel tidak ditemukan', 404);
    await likeArticle(request.params.id, request.user.id);
    return sendSuccess(reply, { message: 'Artikel disukai' });
  });

  // ----- DELETE /articles/:id/like -----
  fastify.delete<{ Params: { id: string } }>('/articles/:id/like', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['articles'], summary: 'Unlike an article' },
  }, async (request, reply) => {
    await unlikeArticle(request.params.id, request.user.id);
    return sendSuccess(reply, { message: 'Unlike berhasil' });
  });

  // ----- GET /articles/:id/comments -----
  fastify.get<{ Params: { id: string } }>('/articles/:id/comments', {
    schema: { tags: ['articles'], summary: 'List article comments' },
  }, async (request, reply) => {
    const comments = await listComments(request.params.id);
    return sendSuccess(reply, comments);
  });

  // ----- POST /articles/:id/comments -----
  fastify.post<{ Params: { id: string } }>('/articles/:id/comments', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['articles'], summary: 'Create comment' },
  }, async (request, reply) => {
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.id, request.params.id)).limit(1);
    if (!rows[0]) return sendError(reply, ErrorCodes.NOT_FOUND, 'Artikel tidak ditemukan', 404);
    const parsed = createCommentSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);
    const row = await createComment(request.params.id, request.user.id, parsed.data);
    return sendSuccess(reply, {
      id: row.id,
      article_id: row.article_id,
      parent_id:  row.parent_id,
      content:    row.content,
      created_at: row.created_at.toISOString(),
    }, undefined, 201);
  });

  // ----- DELETE /articles/comments/:id -----
  fastify.delete<{ Params: { id: string } }>('/articles/comments/:id', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['articles'], summary: 'Delete comment' },
  }, async (request, reply) => {
    const res = await softDeleteComment(request.params.id, request.user);
    if (!res.ok) {
      if (res.code === 'NOT_FOUND') return sendError(reply, ErrorCodes.NOT_FOUND, 'Komentar tidak ditemukan', 404);
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Tidak punya akses', 403);
    }
    return sendSuccess(reply, { message: 'Komentar dihapus' });
  });

  // ----- POST /articles/comments/:id/like -----
  fastify.post<{ Params: { id: string } }>('/articles/comments/:id/like', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['articles'], summary: 'Like comment' },
  }, async (request, reply) => {
    await likeComment(request.params.id, request.user.id);
    return sendSuccess(reply, { message: 'Komentar disukai' });
  });

  // ----- DELETE /articles/comments/:id/like -----
  fastify.delete<{ Params: { id: string } }>('/articles/comments/:id/like', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['articles'], summary: 'Unlike comment' },
  }, async (request, reply) => {
    await unlikeComment(request.params.id, request.user.id);
    return sendSuccess(reply, { message: 'Unlike berhasil' });
  });
}
