import { pgTable, uuid, varchar, text, boolean, integer, timestamp, pgEnum, primaryKey } from 'drizzle-orm/pg-core';

export const accessTierEnum    = pgEnum('access_tier',    ['free', 'premium']);
export const articleStatusEnum = pgEnum('article_status', ['draft', 'review', 'published', 'archived', 'scheduled']);
export const authorTypeEnum    = pgEnum('author_type',    ['user', 'agent']);

export const categories = pgTable('categories', {
  id:          uuid('id').primaryKey().defaultRandom(),
  name:        varchar('name', { length: 100 }).notNull(),
  slug:        varchar('slug', { length: 120 }).notNull().unique(),
  description: text('description'),
  color_hex:   varchar('color_hex', { length: 7 }),
  sort_order:  integer('sort_order').default(0).notNull(),
  is_active:   boolean('is_active').default(true).notNull(),
  created_at:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Category    = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export const tags = pgTable('tags', {
  id:         uuid('id').primaryKey().defaultRandom(),
  name:       varchar('name', { length: 60 }).notNull().unique(),
  slug:       varchar('slug', { length: 80 }).notNull().unique(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Tag    = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

export const articles = pgTable('articles', {
  id:                uuid('id').primaryKey().defaultRandom(),
  title:             varchar('title', { length: 500 }).notNull(),
  slug:              varchar('slug',  { length: 600 }).notNull().unique(),
  excerpt:           text('excerpt'),
  content:           text('content'),
  content_en:        text('content_en'),
  category_id:       uuid('category_id').notNull(),
  author_id:         uuid('author_id').notNull(),
  author_type:       authorTypeEnum('author_type').default('user').notNull(),
  status:            articleStatusEnum('status').default('draft').notNull(),
  access_tier:       accessTierEnum('access_tier').default('free').notNull(),
  thumbnail_url:     text('thumbnail_url'),
  read_time_minutes: integer('read_time_minutes'),
  has_disclaimer:    boolean('has_disclaimer').default(false),
  seo_title:         varchar('seo_title', { length: 200 }),
  seo_description:   text('seo_description'),
  view_count:        integer('view_count').default(0).notNull(),
  like_count:        integer('like_count').default(0).notNull(),
  comment_count:     integer('comment_count').default(0).notNull(),
  published_at:      timestamp('published_at', { withTimezone: true }),
  deleted_at:        timestamp('deleted_at',   { withTimezone: true }),
  created_at:        timestamp('created_at',   { withTimezone: true }).defaultNow().notNull(),
  updated_at:        timestamp('updated_at',   { withTimezone: true }).defaultNow().notNull(),
});

export type Article    = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;

export const articleTags = pgTable('article_tags', {
  article_id: uuid('article_id').notNull(),
  tag_id:     uuid('tag_id').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.article_id, t.tag_id] }),
}));

export const articleLikes = pgTable('article_likes', {
  article_id: uuid('article_id').notNull(),
  user_id:    uuid('user_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.article_id, t.user_id] }),
}));

export const articleComments = pgTable('article_comments', {
  id:         uuid('id').primaryKey().defaultRandom(),
  article_id: uuid('article_id').notNull(),
  author_id:  uuid('author_id').notNull(),
  parent_id:  uuid('parent_id'),
  content:    text('content').notNull(),
  like_count: integer('like_count').default(0).notNull(),
  is_deleted: boolean('is_deleted').default(false).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ArticleComment    = typeof articleComments.$inferSelect;
export type NewArticleComment = typeof articleComments.$inferInsert;

export const articleCommentLikes = pgTable('article_comment_likes', {
  comment_id: uuid('comment_id').notNull(),
  user_id:    uuid('user_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.comment_id, t.user_id] }),
}));
