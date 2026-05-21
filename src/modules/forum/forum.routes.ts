import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sendSuccess, sendError, ErrorCodes } from '../../utils/response';
import { buildMeta } from '../../utils/paginate';
import {
  listThreadsQuerySchema, createThreadSchema, createReplySchema, createReportSchema,
} from './forum.schema';
import {
  listSubforums, getSubforumBySlug, listThreads, getThreadById, incrementThreadView,
  listReplies, checkAndTickRateLimit, createThread, createReply, upvoteReply, removeUpvote,
  getThreadAuthor, getReplyById, createContentReport,
} from './forum.service';
import { createNotification } from '../users/users.service';

async function tryAuth(request: FastifyRequest): Promise<boolean> {
  try { await request.jwtVerify(); return true; } catch { return false; }
}

const THREAD_LIMIT_PER_HOUR = 5;
const REPLY_LIMIT_PER_HOUR  = 10;
const REPORT_LIMIT_PER_HOUR = 8;

export default async function forumRoutes(fastify: FastifyInstance) {
  // ----- GET /subforums -----
  fastify.get('/subforums', {
    schema: { tags: ['forum'], summary: 'List all active subforums' },
  }, async (_request, reply) => {
    const rows = await listSubforums();
    return sendSuccess(reply, rows);
  });

  // ----- GET /subforums/:slug -----
  fastify.get<{ Params: { slug: string } }>('/subforums/:slug', {
    schema: { tags: ['forum'], summary: 'Subforum detail' },
  }, async (request, reply) => {
    const sf = await getSubforumBySlug(request.params.slug);
    if (!sf) return sendError(reply, ErrorCodes.NOT_FOUND, 'Subforum tidak ditemukan', 404);
    return sendSuccess(reply, {
      id:               sf.id,
      name:             sf.name,
      slug:             sf.slug,
      description:      sf.description,
      access_tier:      sf.access_tier,
      thread_count:     sf.thread_count,
      last_activity_at: sf.last_activity_at ? sf.last_activity_at.toISOString() : null,
    });
  });

  // ----- GET /subforums/:slug/threads -----
  // 401 if premium subforum and not authed; 403 if authed but free tier
  fastify.get<{ Params: { slug: string } }>('/subforums/:slug/threads', {
    schema: { tags: ['forum'], summary: 'List threads in subforum' },
  }, async (request, reply) => {
    const sf = await getSubforumBySlug(request.params.slug);
    if (!sf) return sendError(reply, ErrorCodes.NOT_FOUND, 'Subforum tidak ditemukan', 404);

    if (sf.access_tier === 'premium') {
      const authed = await tryAuth(request);
      if (!authed) {
        return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Login diperlukan untuk akses subforum premium', 401);
      }
      const u = request.user;
      const isPrivileged = u.role === 'admin' || u.role === 'moderator' || u.role === 'agent';
      if (!isPrivileged && u.membership_tier !== 'premium') {
        return sendError(reply, ErrorCodes.PREMIUM_REQUIRED, 'Butuh membership premium', 403);
      }
    }

    const parsed = listThreadsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Query tidak valid', 422);
    const q = parsed.data;
    const { rows, total } = await listThreads(sf.id, q);
    return sendSuccess(reply, rows, buildMeta(total, q.page, q.per_page));
  });

  // ----- POST /subforums/:slug/threads -----
  fastify.post<{ Params: { slug: string } }>('/subforums/:slug/threads', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['forum'], summary: 'Create thread (5/hr rate limit)' },
  }, async (request, reply) => {
    const sf = await getSubforumBySlug(request.params.slug);
    if (!sf) return sendError(reply, ErrorCodes.NOT_FOUND, 'Subforum tidak ditemukan', 404);

    const u = request.user;
    if (sf.access_tier === 'premium') {
      const isPrivileged = u.role === 'admin' || u.role === 'moderator' || u.role === 'agent';
      if (!isPrivileged && u.membership_tier !== 'premium') {
        return sendError(reply, ErrorCodes.PREMIUM_REQUIRED, 'Butuh membership premium', 403);
      }
    }

    if (!u.is_active) {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Akun dinonaktifkan', 403);
    }
    if (!u.is_verified && u.role !== 'admin' && u.role !== 'moderator' && u.role !== 'agent') {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Verifikasi email diperlukan sebelum membuat thread', 403);
    }

    const rl = await checkAndTickRateLimit(u.id, 'thread', THREAD_LIMIT_PER_HOUR);
    if (!rl.allowed) {
      return sendError(reply, ErrorCodes.RATE_LIMITED, 'Batas pembuatan thread tercapai (5/jam)', 429);
    }

    const parsed = createThreadSchema.safeParse(request.body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join('.') || '_'] = i.message;
      return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422, fields);
    }

    const row = await createThread({ subforum_id: sf.id, author_id: u.id, input: parsed.data });
    return sendSuccess(reply, { id: row.id, title: row.title, created_at: row.created_at.toISOString() }, undefined, 201);
  });

  // ----- GET /threads/:id -----
  fastify.get<{ Params: { id: string } }>('/threads/:id', {
    schema: { tags: ['forum'], summary: 'Thread detail' },
  }, async (request, reply) => {
    const t = await getThreadById(request.params.id);
    if (!t) return sendError(reply, ErrorCodes.NOT_FOUND, 'Thread tidak ditemukan', 404);

    // If thread belongs to premium subforum, enforce gate
    const sfRows = await getSubforumBySlugById(t.subforum_id);
    if (sfRows?.access_tier === 'premium') {
      const authed = await tryAuth(request);
      if (!authed) return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Login diperlukan', 401);
      const u = request.user;
      const isPrivileged = u.role === 'admin' || u.role === 'moderator' || u.role === 'agent';
      if (!isPrivileged && u.membership_tier !== 'premium') {
        return sendError(reply, ErrorCodes.PREMIUM_REQUIRED, 'Butuh membership premium', 403);
      }
    }

    incrementThreadView(t.id).catch(() => undefined);
    return sendSuccess(reply, t);
  });

  // ----- GET /threads/:id/replies -----
  fastify.get<{ Params: { id: string } }>('/threads/:id/replies', {
    schema: { tags: ['forum'], summary: 'List thread replies' },
  }, async (request, reply) => {
    const t = await getThreadById(request.params.id);
    if (!t) return sendError(reply, ErrorCodes.NOT_FOUND, 'Thread tidak ditemukan', 404);
    const replies = await listReplies(t.id);
    return sendSuccess(reply, replies);
  });

  // ----- POST /threads/:id/replies -----
  fastify.post<{ Params: { id: string } }>('/threads/:id/replies', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['forum'], summary: 'Create reply (10/hr rate limit)' },
  }, async (request, reply) => {
    const t = await getThreadById(request.params.id);
    if (!t) return sendError(reply, ErrorCodes.NOT_FOUND, 'Thread tidak ditemukan', 404);
    if (t.is_locked) return sendError(reply, ErrorCodes.FORBIDDEN, 'Thread terkunci', 403);

    const sf = await getSubforumBySlugById(t.subforum_id);
    const u = request.user;
    if (sf?.access_tier === 'premium') {
      const isPrivileged = u.role === 'admin' || u.role === 'moderator' || u.role === 'agent';
      if (!isPrivileged && u.membership_tier !== 'premium') {
        return sendError(reply, ErrorCodes.PREMIUM_REQUIRED, 'Butuh membership premium', 403);
      }
    }

    if (!u.is_active) {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Akun dinonaktifkan', 403);
    }
    if (!u.is_verified && u.role !== 'admin' && u.role !== 'moderator' && u.role !== 'agent') {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Verifikasi email diperlukan sebelum membalas thread', 403);
    }

    const rl = await checkAndTickRateLimit(u.id, 'reply', REPLY_LIMIT_PER_HOUR);
    if (!rl.allowed) {
      return sendError(reply, ErrorCodes.RATE_LIMITED, 'Batas balasan tercapai (10/jam)', 429);
    }

    const parsed = createReplySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);

    const res = await createReply({ thread_id: t.id, author_id: u.id, input: parsed.data });
    if (!res.ok) {
      if (res.code === 'NESTING_EXCEEDED') {
        return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Nesting lebih dari 1 level tidak diizinkan', 422, { parent_reply_id: 'max 1 level' });
      }
      return sendError(reply, ErrorCodes.NOT_FOUND, 'Parent reply tidak ditemukan', 404);
    }

    // Notify thread author (fire-and-forget)
    const threadAuthor = await getThreadAuthor(t.id);
    if (threadAuthor && threadAuthor !== u.id) {
      createNotification({
        user_id: threadAuthor,
        type:    'new_reply',
        title:   'Balasan baru di thread Anda',
        body:    `${u.username} membalas "${t.title}"`,
        link:    sf ? `/forum/${sf.slug}/${t.id}` : `/forum/${t.id}`,
      }).catch(() => undefined);
    }

    return sendSuccess(reply, {
      id: res.row.id,
      thread_id: res.row.thread_id,
      parent_reply_id: res.row.parent_reply_id,
      content: res.row.content,
      upvote_count: res.row.upvote_count,
      created_at: res.row.created_at.toISOString(),
      author: {
        id: u.id,
        username: u.username,
        display_name: u.username,
        avatar_url: null,
        role: u.role,
        membership_tier: u.membership_tier,
        is_verified: false,
      },
    }, undefined, 201);
  });


  // ----- POST /threads/:id/report -----
  fastify.post<{ Params: { id: string } }>('/threads/:id/report', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['forum'], summary: 'Report a thread for moderation review' },
  }, async (request, reply) => {
    const t = await getThreadById(request.params.id);
    if (!t) return sendError(reply, ErrorCodes.NOT_FOUND, 'Thread tidak ditemukan', 404);

    const u = request.user;
    if (!u.is_active) return sendError(reply, ErrorCodes.FORBIDDEN, 'Akun dinonaktifkan', 403);

    const parsed = createReportSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input laporan tidak valid', 422);

    const rl = await checkAndTickRateLimit(u.id, 'report', REPORT_LIMIT_PER_HOUR);
    if (!rl.allowed) return sendError(reply, ErrorCodes.RATE_LIMITED, 'Batas laporan tercapai (8/jam)', 429);

    const res = await createContentReport({ reporter_id: u.id, target_type: 'thread', target_id: t.id, input: parsed.data });
    if (!res.ok) return sendError(reply, ErrorCodes.CONFLICT, 'Konten ini sudah Anda laporkan', 409);

    return sendSuccess(reply, { id: res.row.id, message: 'Laporan diterima untuk ditinjau moderator' }, undefined, 201);
  });

  // ----- POST /replies/:id/report -----
  fastify.post<{ Params: { id: string } }>('/replies/:id/report', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['forum'], summary: 'Report a reply for moderation review' },
  }, async (request, reply) => {
    const r = await getReplyById(request.params.id);
    if (!r) return sendError(reply, ErrorCodes.NOT_FOUND, 'Balasan tidak ditemukan', 404);

    const u = request.user;
    if (!u.is_active) return sendError(reply, ErrorCodes.FORBIDDEN, 'Akun dinonaktifkan', 403);

    const parsed = createReportSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input laporan tidak valid', 422);

    const rl = await checkAndTickRateLimit(u.id, 'report', REPORT_LIMIT_PER_HOUR);
    if (!rl.allowed) return sendError(reply, ErrorCodes.RATE_LIMITED, 'Batas laporan tercapai (8/jam)', 429);

    const res = await createContentReport({ reporter_id: u.id, target_type: 'reply', target_id: r.id, input: parsed.data });
    if (!res.ok) return sendError(reply, ErrorCodes.CONFLICT, 'Konten ini sudah Anda laporkan', 409);

    return sendSuccess(reply, { id: res.row.id, message: 'Laporan diterima untuk ditinjau moderator' }, undefined, 201);
  });

  // ----- POST /replies/:id/upvote -----
  fastify.post<{ Params: { id: string } }>('/replies/:id/upvote', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['forum'], summary: 'Upvote reply' },
  }, async (request, reply) => {
    await upvoteReply(request.params.id, request.user.id);
    return sendSuccess(reply, { message: 'Upvote terdaftar' });
  });

  // ----- DELETE /replies/:id/upvote -----
  fastify.delete<{ Params: { id: string } }>('/replies/:id/upvote', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['forum'], summary: 'Remove upvote' },
  }, async (request, reply) => {
    await removeUpvote(request.params.id, request.user.id);
    return sendSuccess(reply, { message: 'Upvote dihapus' });
  });
}

// Helper: subforum lookup by id (not slug) — inline to avoid widening service surface
import { db } from '../../db/client';
import { subforums } from '../../db/schema/forum';
import { eq } from 'drizzle-orm';
async function getSubforumBySlugById(id: string) {
  const rows = await db.select().from(subforums).where(eq(subforums.id, id)).limit(1);
  return rows[0] ?? null;
}
