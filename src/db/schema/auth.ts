import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const oauthAccounts = pgTable('oauth_accounts', {
  id:               uuid('id').primaryKey().defaultRandom(),
  user_id:          uuid('user_id').notNull(),
  provider:         varchar('provider',         { length: 50 }).notNull(),
  provider_user_id: varchar('provider_user_id', { length: 255 }).notNull(),
  access_token:     text('access_token'),
  refresh_token:    text('refresh_token'),
  expires_at:       timestamp('expires_at', { withTimezone: true }),
  created_at:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type OAuthAccount    = typeof oauthAccounts.$inferSelect;
export type NewOAuthAccount = typeof oauthAccounts.$inferInsert;

export const emailVerifications = pgTable('email_verifications', {
  id:         uuid('id').primaryKey().defaultRandom(),
  user_id:    uuid('user_id').notNull(),
  token:      varchar('token', { length: 64 }).notNull().unique(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  used_at:    timestamp('used_at',    { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type EmailVerification    = typeof emailVerifications.$inferSelect;
export type NewEmailVerification = typeof emailVerifications.$inferInsert;

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id:         uuid('id').primaryKey().defaultRandom(),
  user_id:    uuid('user_id').notNull(),
  token:      varchar('token', { length: 64 }).notNull().unique(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  used_at:    timestamp('used_at',    { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type PasswordResetToken    = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
