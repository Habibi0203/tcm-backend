import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, practitionerProfiles } from '../../db/schema/users';
import { articles } from '../../db/schema/content';
import { contentReports, forumReplies, forumThreads, subforums } from '../../db/schema/forum';
import { auditLogs } from '../../db/schema/system';
import { sendSuccess, sendError, ErrorCodes } from '../../utils/response';
import { getPaginationParams, buildMeta } from '../../utils/paginate';
import { toPublicUser } from '../auth/auth.service';
import { createNotification } from '../users/users.service';
import { z } from 'zod';
import { alias } from 'drizzle-orm/pg-core';

const reviewerUsers = alias(users, 'reviewer');
const targetThread = alias(forumThreads, 'target_thread');
const targetThreadSubforum = alias(subforums, 'target_thread_sub');
const targetReply = alias(forumReplies, 'target_reply');
const replyThread = alias(forumThreads, 'reply_thread');
const replyThreadSubforum = alias(subforums, 'reply_thread_sub');

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

const updateReportStatusSchema = z.object({
  status: z.enum(['reviewed', 'dismissed', 'actioned']),
  resolution_note: z.string().trim().max(1000).optional(),
  hide_content: z.boolean().optional(),
  lock_thread: z.boolean().optional(),
});


async function writeAdminAuditLog(opts: {
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  request_ip?: string;
  user_agent?: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditLogs).values({
    user_id: opts.user_id,
    action: opts.action,
    entity_type: opts.entity_type,
    entity_id: opts.entity_id,
    ip_address: opts.request_ip ?? null,
    user_agent: opts.user_agent ?? null,
    metadata: opts.metadata ?? {},
  });
}

async function refreshThreadFlag(threadId: string) {
  const [{ open_count }] = await db
    .select({ open_count: sql<number>`count(*)::int` })
    .from(contentReports)
    .leftJoin(forumReplies, and(eq(contentReports.target_type, 'reply'), eq(contentReports.target_id, forumReplies.id)))
    .where(and(
      eq(contentReports.status, 'open'),
      sql`(${contentReports.target_type} = 'thread' AND ${contentReports.target_id} = ${threadId} OR ${contentReports.target_type} = 'reply' AND ${forumReplies.thread_id} = ${threadId})`,
    ));

  await db.update(forumThreads).set({
    is_flagged: open_count > 0,
    updated_at: new Date(),
  }).where(eq(forumThreads.id, threadId));
}

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


  // ----- GET /admin/reports -----
  fastify.get('/admin/reports', {
    schema: { tags: ['admin'], summary: 'List forum content reports' },
  }, async (request, reply) => {
    const q = request.query as { page?: string; per_page?: string; status?: string; target_type?: string; reason?: string };
    const { page, per_page, limit, offset } = getPaginationParams({ page: q.page, per_page: q.per_page, max_per_page: 50 });

    const conds = [];
    if (q.status) conds.push(eq(contentReports.status, q.status as 'open' | 'reviewed' | 'dismissed' | 'actioned'));
    if (q.target_type) conds.push(eq(contentReports.target_type, q.target_type as 'thread' | 'reply'));
    if (q.reason) conds.push(eq(contentReports.reason, q.reason));

    const rows = await db
      .select({
        report: contentReports,
        reporter_username: users.username,
        reporter_display: users.display_name,
        reviewer_username: reviewerUsers.username,
        thread_title: sql<string | null>`COALESCE(${targetThread.title}, ${replyThread.title})`,
        thread_id: sql<string | null>`COALESCE(${targetThread.id}, ${replyThread.id})`,
        subforum_slug: sql<string | null>`COALESCE(${targetThreadSubforum.slug}, ${replyThreadSubforum.slug})`,
        reply_excerpt: sql<string | null>`CASE WHEN ${contentReports.target_type} = 'reply' THEN LEFT(${targetReply.content}, 160) ELSE NULL END`,
      })
      .from(contentReports)
      .leftJoin(users, eq(contentReports.reporter_id, users.id))
      .leftJoin(reviewerUsers, eq(contentReports.reviewed_by, reviewerUsers.id))
      .leftJoin(targetThread, and(eq(contentReports.target_type, 'thread'), eq(contentReports.target_id, targetThread.id)))
      .leftJoin(targetThreadSubforum, eq(targetThread.subforum_id, targetThreadSubforum.id))
      .leftJoin(targetReply, and(eq(contentReports.target_type, 'reply'), eq(contentReports.target_id, targetReply.id)))
      .leftJoin(replyThread, eq(targetReply.thread_id, replyThread.id))
      .leftJoin(replyThreadSubforum, eq(replyThread.subforum_id, replyThreadSubforum.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(contentReports.created_at))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentReports)
      .where(conds.length ? and(...conds) : undefined);

    return sendSuccess(reply, rows.map((r) => ({
      ...r.report,
      created_at:  r.report.created_at.toISOString(),
      updated_at:  r.report.updated_at.toISOString(),
      reviewed_at: r.report.reviewed_at ? r.report.reviewed_at.toISOString() : null,
      reporter: {
        username: r.reporter_username,
        display_name: r.reporter_display,
      },
      reviewer: r.reviewer_username ? { username: r.reviewer_username } : null,
      target: {
        type: r.report.target_type,
        id: r.report.target_id,
        thread_id: r.thread_id,
        thread_title: r.thread_title,
        subforum_slug: r.subforum_slug,
        reply_excerpt: r.reply_excerpt,
        url: r.thread_id && r.subforum_slug ? `/forum/${r.subforum_slug}/${r.thread_id}` : null,
      },
    })), buildMeta(count, page, per_page));
  });

  // ----- PATCH /admin/reports/:id -----
  fastify.patch<{ Params: { id: string } }>('/admin/reports/:id', {
    schema: { tags: ['admin'], summary: 'Review a forum content report' },
  }, async (request, reply) => {
    const parsed = updateReportStatusSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);

    const [row] = await db.select().from(contentReports).where(eq(contentReports.id, request.params.id)).limit(1);
    if (!row) return sendError(reply, ErrorCodes.NOT_FOUND, 'Laporan tidak ditemukan', 404);

    const now = new Date();
    let threadId: string | null = row.target_type === 'thread' ? row.target_id : null;
    if (!threadId) {
      const [replyRow] = await db.select({ thread_id: forumReplies.thread_id }).from(forumReplies).where(eq(forumReplies.id, row.target_id)).limit(1);
      threadId = replyRow?.thread_id ?? null;
    }

    await db.update(contentReports).set({
      status: parsed.data.status,
      resolution_note: parsed.data.resolution_note ?? row.resolution_note,
      reviewed_by: request.user.id,
      reviewed_at: now,
      updated_at: now,
    }).where(eq(contentReports.id, request.params.id));

    if (parsed.data.hide_content) {
      if (row.target_type === 'thread') {
        await db.update(forumThreads).set({ is_deleted: true, updated_at: now }).where(eq(forumThreads.id, row.target_id));
      } else {
        const [replyBefore] = await db
          .select({ thread_id: forumReplies.thread_id, is_deleted: forumReplies.is_deleted })
          .from(forumReplies)
          .where(eq(forumReplies.id, row.target_id))
          .limit(1);
        await db.update(forumReplies).set({ is_deleted: true, updated_at: now }).where(eq(forumReplies.id, row.target_id));
        if (replyBefore && !replyBefore.is_deleted) {
          await db.update(forumThreads).set({
            reply_count: sql`GREATEST(${forumThreads.reply_count} - 1, 0)`,
            updated_at: now,
          }).where(eq(forumThreads.id, replyBefore.thread_id));
        }
      }
    }

    if (parsed.data.lock_thread && threadId) {
      await db.update(forumThreads).set({ is_locked: true, updated_at: now }).where(eq(forumThreads.id, threadId));
    }

    if (threadId) {
      await refreshThreadFlag(threadId);
    }

    await writeAdminAuditLog({
      user_id: request.user.id,
      action: 'moderation_report_update',
      entity_type: 'content_report',
      entity_id: row.id,
      request_ip: request.ip,
      user_agent: request.headers['user-agent'],
      metadata: {
        previous_status: row.status,
        status: parsed.data.status,
        target_type: row.target_type,
        target_id: row.target_id,
        thread_id: threadId,
        hide_content: parsed.data.hide_content ?? false,
        lock_thread: parsed.data.lock_thread ?? false,
        resolution_note: parsed.data.resolution_note ?? null,
      },
    });

    return sendSuccess(reply, { message: 'Laporan diperbarui' });
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
