import { pgTable, uuid, varchar, text, boolean, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { accessTierEnum } from './content';

export const subforums = pgTable('subforums', {
  id:               uuid('id').primaryKey().defaultRandom(),
  name:             varchar('name', { length: 100 }).notNull(),
  slug:             varchar('slug', { length: 120 }).notNull().unique(),
  description:      text('description'),
  access_tier:      accessTierEnum('access_tier').default('free').notNull(),
  sort_order:       integer('sort_order').default(0).notNull(),
  is_active:        boolean('is_active').default(true).notNull(),
  thread_count:     integer('thread_count').default(0).notNull(),
  last_activity_at: timestamp('last_activity_at', { withTimezone: true }),
  created_at:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Subforum    = typeof subforums.$inferSelect;
export type NewSubforum = typeof subforums.$inferInsert;

export const forumThreads = pgTable('forum_threads', {
  id:              uuid('id').primaryKey().defaultRandom(),
  subforum_id:     uuid('subforum_id').notNull(),
  author_id:       uuid('author_id').notNull(),
  title:           varchar('title', { length: 200 }).notNull(),
  content:         text('content').notNull(),
  is_pinned:       boolean('is_pinned').default(false).notNull(),
  is_locked:       boolean('is_locked').default(false).notNull(),
  is_flagged:      boolean('is_flagged').default(false).notNull(),
  is_agent_seeded: boolean('is_agent_seeded').default(false).notNull(),
  is_deleted:      boolean('is_deleted').default(false).notNull(),
  view_count:      integer('view_count').default(0).notNull(),
  reply_count:     integer('reply_count').default(0).notNull(),
  last_reply_at:   timestamp('last_reply_at', { withTimezone: true }),
  created_at:      timestamp('created_at',    { withTimezone: true }).defaultNow().notNull(),
  updated_at:      timestamp('updated_at',    { withTimezone: true }).defaultNow().notNull(),
});

export type ForumThread    = typeof forumThreads.$inferSelect;
export type NewForumThread = typeof forumThreads.$inferInsert;

export const forumReplies = pgTable('forum_replies', {
  id:              uuid('id').primaryKey().defaultRandom(),
  thread_id:       uuid('thread_id').notNull(),
  author_id:       uuid('author_id').notNull(),
  parent_reply_id: uuid('parent_reply_id'),
  content:         text('content').notNull(),
  upvote_count:    integer('upvote_count').default(0).notNull(),
  is_agent_reply:  boolean('is_agent_reply').default(false).notNull(),
  is_deleted:      boolean('is_deleted').default(false).notNull(),
  created_at:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at:      timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ForumReply    = typeof forumReplies.$inferSelect;
export type NewForumReply = typeof forumReplies.$inferInsert;

export const forumReplyUpvotes = pgTable('forum_reply_upvotes', {
  reply_id:   uuid('reply_id').notNull(),
  user_id:    uuid('user_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.reply_id, t.user_id] }),
}));

export const postingRateLimits = pgTable('posting_rate_limits', {
  user_id:      uuid('user_id').notNull(),
  action_type:  varchar('action_type', { length: 40 }).notNull(),
  count:        integer('count').default(0).notNull(),
  window_start: timestamp('window_start', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.user_id, t.action_type] }),
}));
