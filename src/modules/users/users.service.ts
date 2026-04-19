import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { users } from '../../db/schema/users';
import { bookmarks, notifications } from '../../db/schema/system';
import { articles, categories } from '../../db/schema/content';
import { forumThreads, subforums } from '../../db/schema/forum';
import { hashPassword } from '../../utils/hash';
import type { UpdateMeInput } from './users.schema';

export async function updateMe(userId: string, input: UpdateMeInput) {
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (input.display_name !== undefined) patch.display_name = input.display_name;
  if (input.bio          !== undefined) patch.bio          = input.bio;
  if (input.avatar_url   !== undefined) patch.avatar_url   = input.avatar_url;
  const [row] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  return row;
}

export async function changePassword(userId: string, newPlain: string) {
  const hash = await hashPassword(newPlain);
  await db.update(users).set({ password_hash: hash, updated_at: new Date() }).where(eq(users.id, userId));
}

export async function findPublicUserByUsername(username: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.username, username.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPublicThreadsByUsername(username: string, limit = 20) {
  const rows = await db
    .select({
      id: forumThreads.id,
      title: forumThreads.title,
      created_at: forumThreads.created_at,
      is_pinned: forumThreads.is_pinned,
      is_locked: forumThreads.is_locked,
      reply_count: forumThreads.reply_count,
      author_id: users.id,
      author_username: users.username,
      author_display: users.display_name,
      author_avatar: users.avatar_url,
      author_role: users.role,
      author_tier: users.membership_tier,
      author_verified: users.is_verified,
      subforum_id: subforums.id,
      subforum_name: subforums.name,
      subforum_slug: subforums.slug,
    })
    .from(forumThreads)
    .innerJoin(users, eq(forumThreads.author_id, users.id))
    .innerJoin(subforums, eq(forumThreads.subforum_id, subforums.id))
    .where(and(
      eq(users.username, username.toLowerCase()),
      eq(users.is_active, true),
      eq(forumThreads.is_deleted, false),
    ))
    .orderBy(desc(forumThreads.is_pinned), desc(forumThreads.created_at))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    created_at: r.created_at.toISOString(),
    is_pinned: r.is_pinned,
    is_locked: r.is_locked,
    reply_count: r.reply_count,
    subforum: {
      id: r.subforum_id,
      name: r.subforum_name,
      slug: r.subforum_slug,
    },
    author: r.author_id ? {
      id: r.author_id,
      username: r.author_username!,
      display_name: r.author_display!,
      avatar_url: r.author_avatar,
      role: r.author_role!,
      membership_tier: r.author_tier,
      is_verified: r.author_verified,
    } : null,
  }));
}

// --- Bookmarks ---
export async function listBookmarks(userId: string, limit: number, offset: number) {
  const rows = await db
    .select({
      article_id:   articles.id,
      title:        articles.title,
      slug:         articles.slug,
      excerpt:      articles.excerpt,
      thumbnail_url: articles.thumbnail_url,
      access_tier:  articles.access_tier,
      category_slug: categories.slug,
      category_name: categories.name,
      read_time_minutes: articles.read_time_minutes,
      bookmarked_at: bookmarks.bookmarked_at,
    })
    .from(bookmarks)
    .innerJoin(articles, eq(bookmarks.article_id, articles.id))
    .leftJoin(categories, eq(articles.category_id, categories.id))
    .where(eq(bookmarks.user_id, userId))
    .orderBy(desc(bookmarks.bookmarked_at))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookmarks)
    .where(eq(bookmarks.user_id, userId));

  return { rows, total: count };
}

export async function addBookmark(userId: string, articleId: string) {
  await db
    .insert(bookmarks)
    .values({ user_id: userId, article_id: articleId })
    .onConflictDoNothing();
}

export async function removeBookmark(userId: string, articleId: string) {
  await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.user_id, userId), eq(bookmarks.article_id, articleId)));
}

export async function isBookmarked(userId: string, articleId: string) {
  const rows = await db
    .select({ id: bookmarks.article_id })
    .from(bookmarks)
    .where(and(eq(bookmarks.user_id, userId), eq(bookmarks.article_id, articleId)))
    .limit(1);
  return rows.length > 0;
}

// --- Notifications ---
export async function listNotifications(userId: string, limit: number, offset: number) {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.user_id, userId))
    .orderBy(desc(notifications.created_at))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(eq(notifications.user_id, userId));

  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.user_id, userId), eq(notifications.is_read, false)));

  return { rows, total: count, unread_count: unread };
}

export async function markAllNotificationsRead(userId: string) {
  await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.is_read, false)));
}

export async function markNotificationRead(userId: string, notifId: string) {
  const result = await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.id, notifId), eq(notifications.user_id, userId)))
    .returning({ id: notifications.id });
  return result.length > 0;
}

export async function createNotification(opts: {
  user_id: string;
  type: 'article_approved' | 'article_rejected' | 'new_reply' | 'reply_upvote' | 'system';
  title: string;
  body?: string | null;
  link?: string | null;
}) {
  await db.insert(notifications).values({
    user_id: opts.user_id,
    type: opts.type,
    title: opts.title,
    body: opts.body ?? null,
    link: opts.link ?? null,
  });
}
