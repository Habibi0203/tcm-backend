import { pgTable, uuid, varchar, text, boolean, timestamp, pgEnum, jsonb, primaryKey } from 'drizzle-orm/pg-core';

export const notificationTypeEnum = pgEnum('notification_type', [
  'article_approved', 'article_rejected', 'new_reply', 'reply_upvote', 'system',
]);

export const notifications = pgTable('notifications', {
  id:         uuid('id').primaryKey().defaultRandom(),
  user_id:    uuid('user_id').notNull(),
  type:       notificationTypeEnum('type').notNull(),
  title:      varchar('title', { length: 200 }).notNull(),
  body:       text('body'),
  link:       varchar('link', { length: 500 }),
  is_read:    boolean('is_read').default(false).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Notification    = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export const bookmarks = pgTable('bookmarks', {
  user_id:       uuid('user_id').notNull(),
  article_id:    uuid('article_id').notNull(),
  bookmarked_at: timestamp('bookmarked_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.user_id, t.article_id] }),
}));

export type Bookmark    = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;

export const auditLogs = pgTable('audit_logs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  user_id:     uuid('user_id'),
  action:      varchar('action',      { length: 60 }).notNull(),
  entity_type: varchar('entity_type', { length: 40 }),
  entity_id:   uuid('entity_id'),
  ip_address:  varchar('ip_address',  { length: 45 }),
  user_agent:  text('user_agent'),
  metadata:    jsonb('metadata'),
  created_at:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AuditLog    = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
