import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { articles } from '../../db/schema/content';
import { sendSuccess, sendError, ErrorCodes } from '../../utils/response';
import { getPaginationParams, buildMeta } from '../../utils/paginate';
import { findUserById, toPublicUser, verifyPassword } from '../auth/auth.service';
import {
  updateMeSchema, changePasswordSchema,
} from './users.schema';
import {
  updateMe, changePassword, findPublicUserByUsername, listPublicThreadsByUsername,
  listBookmarks, addBookmark, removeBookmark,
  listNotifications, markAllNotificationsRead, markNotificationRead,
} from './users.service';

export default async function usersRoutes(fastify: FastifyInstance) {
  // ----- GET /me -----
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['users'], summary: 'Current user profile' },
  }, async (request, reply) => {
    const user = await findUserById(request.user.id);
    if (!user) return sendError(reply, ErrorCodes.NOT_FOUND, 'User tidak ditemukan', 404);
    return sendSuccess(reply, toPublicUser(user));
  });

  // ----- PATCH /me -----
  fastify.patch('/me', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['users'], summary: 'Update profile' },
  }, async (request, reply) => {
    const parsed = updateMeSchema.safeParse(request.body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join('.') || '_'] = i.message;
      return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422, fields);
    }
    const updated = await updateMe(request.user.id, parsed.data);
    if (!updated) return sendError(reply, ErrorCodes.NOT_FOUND, 'User tidak ditemukan', 404);
    return sendSuccess(reply, toPublicUser(updated));
  });

  // ----- PATCH /me/password -----
  fastify.patch('/me/password', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['users'], summary: 'Change password' },
  }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);
    }
    const user = await findUserById(request.user.id);
    if (!user) return sendError(reply, ErrorCodes.NOT_FOUND, 'User tidak ditemukan', 404);
    const ok = await verifyPassword(user, parsed.data.current_password);
    if (!ok) {
      return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Password saat ini salah', 401, {
        current_password: 'Password saat ini salah',
      });
    }
    await changePassword(request.user.id, parsed.data.new_password);
    return sendSuccess(reply, { message: 'Password berhasil diubah' });
  });

  // ----- GET /users/:username/threads -----
  fastify.get<{ Params: { username: string } }>('/users/:username/threads', {
    schema: { tags: ['users'], summary: 'Public threads by user' },
  }, async (request, reply) => {
    const user = await findPublicUserByUsername(request.params.username);
    if (!user || !user.is_active) {
      return sendError(reply, ErrorCodes.NOT_FOUND, 'User tidak ditemukan', 404);
    }
    const threads = await listPublicThreadsByUsername(request.params.username);
    return sendSuccess(reply, threads);
  });

  // ----- GET /users/:username -----
  fastify.get<{ Params: { username: string } }>('/users/:username', {
    schema: { tags: ['users'], summary: 'Public user profile' },
  }, async (request, reply) => {
    const user = await findPublicUserByUsername(request.params.username);
    if (!user || !user.is_active) {
      return sendError(reply, ErrorCodes.NOT_FOUND, 'User tidak ditemukan', 404);
    }
    // Expose limited public shape
    return sendSuccess(reply, {
      id:           user.id,
      username:     user.username,
      display_name: user.display_name,
      avatar_url:   user.avatar_url,
      bio:          user.bio,
      profession:   user.profession ?? 'general',
      role:         user.role,
      membership_tier: user.membership_tier,
      is_verified:  user.is_verified,
      is_active:    user.is_active,
      created_at:   user.created_at.toISOString(),
    });
  });

  // ----- GET /me/bookmarks -----
  fastify.get('/me/bookmarks', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['users'], summary: 'List my bookmarks' },
  }, async (request, reply) => {
    const q = request.query as { page?: string; per_page?: string };
    const { page, per_page, limit, offset } = getPaginationParams({
      page: q.page, per_page: q.per_page, max_per_page: 50,
    });
    const { rows, total } = await listBookmarks(request.user.id, limit, offset);
    return sendSuccess(reply, rows, buildMeta(total, page, per_page));
  });

  // ----- POST /articles/:id/bookmark -----
  fastify.post<{ Params: { id: string } }>('/articles/:id/bookmark', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['users'], summary: 'Bookmark an article' },
  }, async (request, reply) => {
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.id, request.params.id)).limit(1);
    if (!rows[0]) return sendError(reply, ErrorCodes.NOT_FOUND, 'Artikel tidak ditemukan', 404);
    await addBookmark(request.user.id, request.params.id);
    return sendSuccess(reply, { message: 'Bookmark ditambahkan' }, undefined, 201);
  });

  // ----- DELETE /articles/:id/bookmark -----
  fastify.delete<{ Params: { id: string } }>('/articles/:id/bookmark', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['users'], summary: 'Remove bookmark' },
  }, async (request, reply) => {
    await removeBookmark(request.user.id, request.params.id);
    return sendSuccess(reply, { message: 'Bookmark dihapus' });
  });

  // ----- GET /me/notifications -----
  fastify.get('/me/notifications', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['users'], summary: 'List notifications' },
  }, async (request, reply) => {
    const q = request.query as { page?: string; per_page?: string };
    const { page, per_page, limit, offset } = getPaginationParams({
      page: q.page, per_page: q.per_page, max_per_page: 50,
    });
    const { rows, total, unread_count } = await listNotifications(request.user.id, limit, offset);
    return sendSuccess(reply, rows, { ...buildMeta(total, page, per_page), unread_count });
  });

  // ----- PATCH /me/notifications/read-all -----
  fastify.patch('/me/notifications/read-all', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['users'], summary: 'Mark all notifications read' },
  }, async (request, reply) => {
    await markAllNotificationsRead(request.user.id);
    return sendSuccess(reply, { message: 'Semua notifikasi ditandai sudah dibaca' });
  });

  // ----- PATCH /me/notifications/:id/read -----
  fastify.patch<{ Params: { id: string } }>('/me/notifications/:id/read', {
    preHandler: [fastify.authenticate],
    schema: { tags: ['users'], summary: 'Mark one notification read' },
  }, async (request, reply) => {
    const ok = await markNotificationRead(request.user.id, request.params.id);
    if (!ok) return sendError(reply, ErrorCodes.NOT_FOUND, 'Notifikasi tidak ditemukan', 404);
    return sendSuccess(reply, { message: 'Notifikasi ditandai sudah dibaca' });
  });
}
