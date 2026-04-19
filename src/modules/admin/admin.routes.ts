import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, practitionerProfiles } from '../../db/schema/users';
import { articles } from '../../db/schema/content';
import { forumThreads } from '../../db/schema/forum';
import { sendSuccess, sendError, ErrorCodes } from '../../utils/response';
import { getPaginationParams, buildMeta } from '../../utils/paginate';
import { toPublicUser } from '../auth/auth.service';
import { createNotification } from '../users/users.service';
import { z } from 'zod';

const updateArticleStatusSchema = z.object({
  status: z.enum(['draft', 'review', 'published', 'archived']),
  reason: z.string().max(500).optional(),
});

const updateUserSchema = z.object({
  role:            z.enum(['member', 'moderator', 'admin']).optional(),
  membership_tier: z.enum(['free', 'premium']).optional(),
  is_active:       z.boolean().optional(),
});

const verifyPractitionerSchema = z.object({
  is_verified:        z.boolean(),
  verification_notes: z.string().max(500).optional(),
});

export default async function adminRoutes(fastify: FastifyInstance) {
  // All admin routes require admin or moderator role
  fastify.addHook('preHandler', async (request, reply) => {
    await fastify.authenticate(request, reply);
    const role = request.user?.role;
    if (role !== 'admin' && role !== 'moderator') {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Akses admin diperlukan', 403);
    }
  });

  // ----- GET /admin/stats -----
  fastify.get('/admin/stats', {
    schema: { tags: ['admin'], summary: 'Platform-wide stats' },
  }, async (_request, reply) => {
    const [{ total_users }] = await db
      .select({ total_users: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.is_active, true));

    const [{ premium_users }] = await db
      .select({ premium_users: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.membership_tier, 'premium'), eq(users.is_active, true)));

    const [{ total_articles }] = await db
      .select({ total_articles: sql<number>`count(*)::int` })
      .from(articles)
      .where(isNull(articles.deleted_at));

    const [{ pending_review }] = await db
      .select({ pending_review: sql<number>`count(*)::int` })
      .from(articles)
      .where(and(eq(articles.status, 'review'), isNull(articles.deleted_at)));

    const [{ total_threads }] = await db
      .select({ total_threads: sql<number>`count(*)::int` })
      .from(forumThreads)
      .where(eq(forumThreads.is_deleted, false));

    const [{ flagged_threads }] = await db
      .select({ flagged_threads: sql<number>`count(*)::int` })
      .from(forumThreads)
      .where(and(eq(forumThreads.is_flagged, true), eq(forumThreads.is_deleted, false)));

    return sendSuccess(reply, {
      total_users,
      premium_users,
      total_articles,
      pending_review,
      total_threads,
      flagged_threads,
    });
  });

  // ----- GET /admin/articles -----
  fastify.get('/admin/articles', {
    schema: { tags: ['admin'], summary: 'All articles with any status' },
  }, async (request, reply) => {
    const q = request.query as { page?: string; per_page?: string; status?: string };
    const { page, per_page, limit, offset } = getPaginationParams({ page: q.page, per_page: q.per_page, max_per_page: 50 });

    const conds = [isNull(articles.deleted_at)];
    if (q.status) conds.push(eq(articles.status, q.status as 'draft' | 'review' | 'published' | 'archived' | 'scheduled'));

    const rows = await db
      .select({
        id:          articles.id,
        title:       articles.title,
        slug:        articles.slug,
        status:      articles.status,
        access_tier: articles.access_tier,
        author_id:   articles.author_id,
        created_at:  articles.created_at,
        published_at: articles.published_at,
        view_count:  articles.view_count,
        like_count:  articles.like_count,
      })
      .from(articles)
      .where(and(...conds))
      .orderBy(desc(articles.created_at))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(articles)
      .where(and(...conds));

    return sendSuccess(reply, rows.map(r => ({
      ...r,
      created_at:   r.created_at.toISOString(),
      published_at: r.published_at ? r.published_at.toISOString() : null,
    })), buildMeta(count, page, per_page));
  });

  // ----- PATCH /admin/articles/:id/status -----
  fastify.patch<{ Params: { id: string } }>('/admin/articles/:id/status', {
    schema: { tags: ['admin'], summary: 'Update article status' },
  }, async (request, reply) => {
    const parsed = updateArticleStatusSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);

    const [row] = await db.select().from(articles).where(eq(articles.id, request.params.id)).limit(1);
    if (!row || row.deleted_at) return sendError(reply, ErrorCodes.NOT_FOUND, 'Artikel tidak ditemukan', 404);

    await db.update(articles).set({
      status:       parsed.data.status,
      published_at: parsed.data.status === 'published' ? new Date() : row.published_at,
      updated_at:   new Date(),
    }).where(eq(articles.id, request.params.id));

    const isApproved = parsed.data.status === 'published';
    const isRejected = parsed.data.status === 'archived';
    if (isApproved || isRejected) {
      createNotification({
        user_id: row.author_id,
        type:    isApproved ? 'article_approved' : 'article_rejected',
        title:   isApproved ? 'Artikel disetujui' : 'Artikel ditolak',
        body:    parsed.data.reason ?? null,
        link:    `/artikel/${row.slug}`,
      }).catch(() => undefined);
    }

    return sendSuccess(reply, { message: 'Status artikel diperbarui' });
  });

  // ----- GET /admin/users -----
  fastify.get('/admin/users', {
    schema: { tags: ['admin'], summary: 'List users (admin)' },
  }, async (request, reply) => {
    const q = request.query as { page?: string; per_page?: string; role?: string };
    const { page, per_page, limit, offset } = getPaginationParams({ page: q.page, per_page: q.per_page, max_per_page: 50 });

    const conds = [];
    if (q.role) conds.push(eq(users.role, q.role as 'member' | 'moderator' | 'admin' | 'agent'));

    const rows = await db
      .select()
      .from(users)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(users.created_at))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(conds.length ? and(...conds) : undefined);

    return sendSuccess(reply, rows.map(toPublicUser), buildMeta(count, page, per_page));
  });

  // ----- PATCH /admin/users/:id -----
  fastify.patch<{ Params: { id: string } }>('/admin/users/:id', {
    schema: { tags: ['admin'], summary: 'Update user role/tier/status' },
  }, async (request, reply) => {
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);

    const [row] = await db.select().from(users).where(eq(users.id, request.params.id)).limit(1);
    if (!row) return sendError(reply, ErrorCodes.NOT_FOUND, 'User tidak ditemukan', 404);

    // Prevent self-demotion of admin
    if (parsed.data.role && request.user.id === request.params.id) {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Tidak dapat mengubah role diri sendiri', 403);
    }

    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (parsed.data.role            !== undefined) patch.role            = parsed.data.role;
    if (parsed.data.membership_tier !== undefined) patch.membership_tier = parsed.data.membership_tier;
    if (parsed.data.is_active       !== undefined) patch.is_active       = parsed.data.is_active;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, request.params.id)).returning();
    return sendSuccess(reply, toPublicUser(updated));
  });

  // ----- GET /admin/threads/flagged -----
  fastify.get('/admin/threads/flagged', {
    schema: { tags: ['admin'], summary: 'List flagged threads' },
  }, async (request, reply) => {
    const q = request.query as { page?: string; per_page?: string };
    const { page, per_page, limit, offset } = getPaginationParams({ page: q.page, per_page: q.per_page, max_per_page: 50 });

    const rows = await db
      .select({
        id:          forumThreads.id,
        subforum_id: forumThreads.subforum_id,
        title:       forumThreads.title,
        is_pinned:   forumThreads.is_pinned,
        is_locked:   forumThreads.is_locked,
        reply_count: forumThreads.reply_count,
        created_at:  forumThreads.created_at,
        author_id:   forumThreads.author_id,
      })
      .from(forumThreads)
      .where(and(eq(forumThreads.is_flagged, true), eq(forumThreads.is_deleted, false)))
      .orderBy(desc(forumThreads.created_at))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumThreads)
      .where(and(eq(forumThreads.is_flagged, true), eq(forumThreads.is_deleted, false)));

    return sendSuccess(reply, rows.map(r => ({ ...r, created_at: r.created_at.toISOString() })), buildMeta(count, page, per_page));
  });

  // ----- GET /admin/practitioners/pending -----
  fastify.get('/admin/practitioners/pending', {
    schema: { tags: ['admin'], summary: 'List unverified practitioner profiles' },
  }, async (request, reply) => {
    const q = request.query as { page?: string; per_page?: string };
    const { page, per_page, limit, offset } = getPaginationParams({ page: q.page, per_page: q.per_page, max_per_page: 50 });

    const rows = await db
      .select({
        profile:  practitionerProfiles,
        username: users.username,
        display_name: users.display_name,
        email:    users.email,
      })
      .from(practitionerProfiles)
      .innerJoin(users, eq(practitionerProfiles.user_id, users.id))
      .where(eq(practitionerProfiles.is_verified, false))
      .orderBy(desc(practitionerProfiles.created_at))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(practitionerProfiles)
      .where(eq(practitionerProfiles.is_verified, false));

    return sendSuccess(reply, rows.map(r => ({
      ...r.profile,
      created_at:  r.profile.created_at.toISOString(),
      updated_at:  r.profile.updated_at.toISOString(),
      verified_at: r.profile.verified_at ? r.profile.verified_at.toISOString() : null,
      user: { username: r.username, display_name: r.display_name, email: r.email },
    })), buildMeta(count, page, per_page));
  });

  // ----- PATCH /admin/practitioners/:id/verify -----
  fastify.patch<{ Params: { id: string } }>('/admin/practitioners/:id/verify', {
    schema: { tags: ['admin'], summary: 'Approve or reject practitioner profile' },
  }, async (request, reply) => {
    const parsed = verifyPractitionerSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);

    const [profile] = await db.select().from(practitionerProfiles).where(eq(practitionerProfiles.id, request.params.id)).limit(1);
    if (!profile) return sendError(reply, ErrorCodes.NOT_FOUND, 'Profil praktisi tidak ditemukan', 404);

    await db.update(practitionerProfiles).set({
      is_verified:        parsed.data.is_verified,
      verified_at:        parsed.data.is_verified ? new Date() : null,
      verification_notes: parsed.data.verification_notes ?? null,
      updated_at:         new Date(),
    }).where(eq(practitionerProfiles.id, request.params.id));

    createNotification({
      user_id: profile.user_id,
      type:    'system',
      title:   parsed.data.is_verified ? 'Profil praktisi diverifikasi' : 'Verifikasi praktisi ditolak',
      body:    parsed.data.verification_notes ?? null,
    }).catch(() => undefined);

    return sendSuccess(reply, { message: parsed.data.is_verified ? 'Praktisi diverifikasi' : 'Verifikasi ditolak' });
  });
}
