import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  articles, articleComments, articleLikes, articleCommentLikes,
  articleTags, categories, tags,
  type Article,
} from '../../db/schema/content';
import { users } from '../../db/schema/users';
import { uniqueSlug, estimateReadMinutes, firstNWords, toSlug } from '../../utils/slug';
import type { CreateArticleInput, ListArticlesQuery, UpdateArticleInput } from './articles.schema';

export type ListArticleRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  thumbnail_url: string | null;
  access_tier: 'free' | 'premium';
  read_time_minutes: number | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  created_at: string;
  category: { slug: string; name: string; color_hex: string | null } | null;
  author: { id: string; username: string; display_name: string; avatar_url: string | null };
};

type RawListRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  thumbnail_url: string | null;
  access_tier: 'free' | 'premium';
  read_time_minutes: number | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: Date | null;
  created_at: Date;
  category_id: string;
  category_slug: string | null;
  category_name: string | null;
  category_color: string | null;
  author_id: string | null;
  author_username: string | null;
  author_display: string | null;
  author_avatar: string | null;
};

function shapeListRow(r: RawListRow): ListArticleRow {
  return {
    id:              r.id,
    title:           r.title,
    slug:            r.slug,
    excerpt:         r.excerpt,
    thumbnail_url:   r.thumbnail_url,
    access_tier:     r.access_tier,
    read_time_minutes: r.read_time_minutes,
    view_count:      r.view_count,
    like_count:      r.like_count,
    comment_count:   r.comment_count,
    published_at:    r.published_at ? r.published_at.toISOString() : null,
    created_at:      r.created_at.toISOString(),
    category: r.category_slug ? {
      slug:      r.category_slug,
      name:      r.category_name!,
      color_hex: r.category_color,
    } : null,
    author: {
      id:           r.author_id!,
      username:     r.author_username!,
      display_name: r.author_display!,
      avatar_url:   r.author_avatar,
    },
  };
}

export async function listPublishedArticles(q: ListArticlesQuery) {
  const conds = [
    eq(articles.status, 'published' as const),
    sql`${articles.deleted_at} IS NULL`,
  ];
  if (q.access_tier) conds.push(eq(articles.access_tier, q.access_tier));
  if (q.slug) conds.push(eq(articles.slug, q.slug));
  if (q.author) conds.push(eq(articles.author_id, q.author));
  if (q.category_slug) {
    conds.push(eq(categories.slug, q.category_slug));
  }
  if (q.q) {
    const like = `%${q.q}%`;
    conds.push(or(ilike(articles.title, like), ilike(articles.excerpt, like))!);
  }

  const orderBy =
    q.sort === 'popular'  ? desc(articles.like_count) :
    q.sort === 'trending' ? desc(articles.view_count) :
                            desc(articles.published_at);

  const offset = (q.page - 1) * q.per_page;

  const rows = await db
    .select({
      id:                articles.id,
      title:             articles.title,
      slug:              articles.slug,
      excerpt:           articles.excerpt,
      thumbnail_url:     articles.thumbnail_url,
      access_tier:       articles.access_tier,
      read_time_minutes: articles.read_time_minutes,
      view_count:        articles.view_count,
      like_count:        articles.like_count,
      comment_count:     articles.comment_count,
      published_at:      articles.published_at,
      created_at:        articles.created_at,
      category_id:       articles.category_id,
      category_slug:     categories.slug,
      category_name:     categories.name,
      category_color:    categories.color_hex,
      author_id:         users.id,
      author_username:   users.username,
      author_display:    users.display_name,
      author_avatar:     users.avatar_url,
    })
    .from(articles)
    .leftJoin(categories, eq(articles.category_id, categories.id))
    .leftJoin(users,      eq(articles.author_id,   users.id))
    .where(and(...conds))
    .orderBy(orderBy)
    .limit(q.per_page)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articles)
    .leftJoin(categories, eq(articles.category_id, categories.id))
    .where(and(...conds));

  return { rows: rows.map(shapeListRow), total: count };
}

export async function getArticleBySlug(slug: string) {
  const rows = await db
    .select()
    .from(articles)
    .where(and(eq(articles.slug, slug), sql`${articles.deleted_at} IS NULL`))
    .limit(1);
  return rows[0] ?? null;
}

export async function getArticleDetail(slug: string, viewer?: { id: string; role: string; membership_tier: string }) {
  const a = await getArticleBySlug(slug);
  if (!a) return null;

  // Author + category
  const [authorRow] = await db.select().from(users).where(eq(users.id, a.author_id)).limit(1);
  const [catRow]    = await db.select().from(categories).where(eq(categories.id, a.category_id)).limit(1);

  // Tags
  const tagRows = await db
    .select({ id: tags.id, name: tags.name, slug: tags.slug })
    .from(articleTags)
    .innerJoin(tags, eq(articleTags.tag_id, tags.id))
    .where(eq(articleTags.article_id, a.id));

  const isPrivileged = viewer && (viewer.role === 'admin' || viewer.role === 'moderator' || viewer.role === 'agent' || a.author_id === viewer.id);
  const isPremium    = viewer?.membership_tier === 'premium';
  const shouldTruncate = a.access_tier === 'premium' && !isPrivileged && !isPremium;

  let content = a.content ?? '';
  let is_truncated = false;
  if (shouldTruncate && content) {
    const full = content;
    const truncated = firstNWords(full, 300);
    if (truncated.length < full.length) {
      content = truncated;
      is_truncated = true;
    }
  }

  // Liked/bookmarked markers (only if viewer)
  let is_liked = false;
  if (viewer) {
    const likeRows = await db
      .select({ u: articleLikes.user_id })
      .from(articleLikes)
      .where(and(eq(articleLikes.article_id, a.id), eq(articleLikes.user_id, viewer.id)))
      .limit(1);
    is_liked = likeRows.length > 0;
  }

  return {
    id:                a.id,
    title:             a.title,
    slug:              a.slug,
    excerpt:           a.excerpt,
    content,
    content_en:        a.content_en,
    is_truncated,
    access_tier:       a.access_tier,
    status:            a.status,
    thumbnail_url:     a.thumbnail_url,
    read_time_minutes: a.read_time_minutes,
    has_disclaimer:    a.has_disclaimer,
    seo_title:         a.seo_title,
    seo_description:   a.seo_description,
    view_count:        a.view_count,
    like_count:        a.like_count,
    comment_count:     a.comment_count,
    is_liked,
    published_at:      a.published_at ? a.published_at.toISOString() : null,
    created_at:        a.created_at.toISOString(),
    updated_at:        a.updated_at.toISOString(),
    category: catRow ? {
      id:        catRow.id,
      slug:      catRow.slug,
      name:      catRow.name,
      color_hex: catRow.color_hex,
    } : null,
    author: authorRow ? {
      id:           authorRow.id,
      username:     authorRow.username,
      display_name: authorRow.display_name,
      avatar_url:   authorRow.avatar_url,
      profession:   authorRow.profession,
      role:         authorRow.role,
    } : null,
    tags: tagRows,
  };
}

export async function incrementViewCount(id: string) {
  await db.update(articles).set({ view_count: sql`${articles.view_count} + 1` }).where(eq(articles.id, id));
}

export async function createArticle(input: CreateArticleInput & { author_id: string; author_type: 'user' | 'agent' }) {
  const existingSlugs = new Set((await db.select({ slug: articles.slug }).from(articles)).map(r => r.slug));
  const slug = await uniqueSlug(input.title, async (s) => existingSlugs.has(s));
  const read_time_minutes = input.content ? estimateReadMinutes(input.content) : null;

  const [row] = await db.insert(articles).values({
    title:             input.title,
    slug,
    excerpt:           input.excerpt ?? null,
    content:           input.content,
    category_id:       input.category_id,
    author_id:         input.author_id,
    author_type:       input.author_type,
    status:            input.status ?? 'draft',
    access_tier:       input.access_tier ?? 'free',
    thumbnail_url:     input.thumbnail_url ?? null,
    read_time_minutes,
    has_disclaimer:    input.has_disclaimer ?? false,
    seo_title:         input.seo_title ?? null,
    seo_description:   input.seo_description ?? null,
    published_at:      input.status === 'published' ? new Date() : null,
  }).returning();

  if (input.tag_names?.length) {
    await attachTagsByName(row.id, input.tag_names);
  }
  return row;
}

export async function attachTagsByName(articleId: string, names: string[]) {
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const slug = toSlug(name).slice(0, 80);
    // upsert tag
    const [existing] = await db.select().from(tags).where(eq(tags.slug, slug)).limit(1);
    const tag = existing ?? (await db.insert(tags).values({ name, slug }).returning())[0];
    await db.insert(articleTags).values({ article_id: articleId, tag_id: tag.id }).onConflictDoNothing();
  }
}

export async function updateArticle(id: string, input: UpdateArticleInput) {
  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (input.title         !== undefined) patch.title         = input.title;
  if (input.excerpt       !== undefined) patch.excerpt       = input.excerpt;
  if (input.content       !== undefined) {
    patch.content           = input.content;
    patch.read_time_minutes = estimateReadMinutes(input.content);
  }
  if (input.category_id   !== undefined) patch.category_id   = input.category_id;
  if (input.access_tier   !== undefined) patch.access_tier   = input.access_tier;
  if (input.thumbnail_url !== undefined) patch.thumbnail_url = input.thumbnail_url;
  if (input.has_disclaimer!== undefined) patch.has_disclaimer= input.has_disclaimer;
  if (input.seo_title     !== undefined) patch.seo_title     = input.seo_title;
  if (input.seo_description!== undefined) patch.seo_description = input.seo_description;
  if (input.status        !== undefined) {
    patch.status = input.status;
    if (input.status === 'published') patch.published_at = new Date();
  }
  const [row] = await db.update(articles).set(patch).where(eq(articles.id, id)).returning();

  if (input.tag_names) {
    await db.delete(articleTags).where(eq(articleTags.article_id, id));
    if (input.tag_names.length) await attachTagsByName(id, input.tag_names);
  }

  return row;
}

export async function softDeleteArticle(id: string) {
  await db.update(articles).set({ deleted_at: new Date(), status: 'archived' }).where(eq(articles.id, id));
}

// ---- Likes ----
export async function likeArticle(articleId: string, userId: string) {
  const inserted = await db.insert(articleLikes).values({ article_id: articleId, user_id: userId }).onConflictDoNothing().returning();
  if (inserted.length) {
    await db.update(articles).set({ like_count: sql`${articles.like_count} + 1` }).where(eq(articles.id, articleId));
  }
}

export async function unlikeArticle(articleId: string, userId: string) {
  const deleted = await db
    .delete(articleLikes)
    .where(and(eq(articleLikes.article_id, articleId), eq(articleLikes.user_id, userId)))
    .returning();
  if (deleted.length) {
    await db.update(articles).set({ like_count: sql`GREATEST(${articles.like_count} - 1, 0)` }).where(eq(articles.id, articleId));
  }
}

// ---- Comments ----
export async function listComments(articleId: string) {
  const rows = await db
    .select({
      id:           articleComments.id,
      article_id:   articleComments.article_id,
      parent_id:    articleComments.parent_id,
      content:      articleComments.content,
      like_count:   articleComments.like_count,
      is_deleted:   articleComments.is_deleted,
      created_at:   articleComments.created_at,
      author_id:    users.id,
      author_username: users.username,
      author_display:  users.display_name,
      author_avatar:   users.avatar_url,
    })
    .from(articleComments)
    .leftJoin(users, eq(articleComments.author_id, users.id))
    .where(and(eq(articleComments.article_id, articleId), eq(articleComments.is_deleted, false)))
    .orderBy(desc(articleComments.created_at));

  return rows.map(r => ({
    id:         r.id,
    article_id: r.article_id,
    parent_id:  r.parent_id,
    content:    r.content,
    like_count: r.like_count,
    created_at: r.created_at.toISOString(),
    author: {
      id:           r.author_id!,
      username:     r.author_username!,
      display_name: r.author_display!,
      avatar_url:   r.author_avatar,
    },
  }));
}

export async function createComment(articleId: string, authorId: string, input: { content: string; parent_id?: string | null }) {
  const [row] = await db.insert(articleComments).values({
    article_id: articleId,
    author_id:  authorId,
    parent_id:  input.parent_id ?? null,
    content:    input.content,
  }).returning();
  await db.update(articles).set({ comment_count: sql`${articles.comment_count} + 1` }).where(eq(articles.id, articleId));
  return row;
}

export async function softDeleteComment(commentId: string, actor: { id: string; role: string }) {
  const [row] = await db.select().from(articleComments).where(eq(articleComments.id, commentId)).limit(1);
  if (!row) return { ok: false as const, code: 'NOT_FOUND' as const };
  const isOwner = row.author_id === actor.id;
  const isMod   = actor.role === 'admin' || actor.role === 'moderator';
  if (!isOwner && !isMod) return { ok: false as const, code: 'FORBIDDEN' as const };
  await db.update(articleComments).set({ is_deleted: true, updated_at: new Date() }).where(eq(articleComments.id, commentId));
  await db.update(articles).set({ comment_count: sql`GREATEST(${articles.comment_count} - 1, 0)` }).where(eq(articles.id, row.article_id));
  return { ok: true as const };
}

export async function likeComment(commentId: string, userId: string) {
  const inserted = await db.insert(articleCommentLikes).values({ comment_id: commentId, user_id: userId }).onConflictDoNothing().returning();
  if (inserted.length) {
    await db.update(articleComments).set({ like_count: sql`${articleComments.like_count} + 1` }).where(eq(articleComments.id, commentId));
  }
}

export async function unlikeComment(commentId: string, userId: string) {
  const deleted = await db
    .delete(articleCommentLikes)
    .where(and(eq(articleCommentLikes.comment_id, commentId), eq(articleCommentLikes.user_id, userId)))
    .returning();
  if (deleted.length) {
    await db.update(articleComments).set({ like_count: sql`GREATEST(${articleComments.like_count} - 1, 0)` }).where(eq(articleComments.id, commentId));
  }
}

export function canEditArticle(article: Article, actor: { id: string; role: string }) {
  if (actor.role === 'admin' || actor.role === 'moderator' || actor.role === 'agent') return true;
  return article.author_id === actor.id;
}
