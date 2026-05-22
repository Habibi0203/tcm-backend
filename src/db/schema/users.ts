import { pgTable, uuid, varchar, text, boolean, timestamp, pgEnum, integer, primaryKey } from 'drizzle-orm/pg-core';

export const professionEnum     = pgEnum('profession_type', ['general', 'practitioner', 'student']);
export const roleEnum           = pgEnum('user_role',       ['member', 'moderator', 'admin', 'agent']);
export const membershipTierEnum = pgEnum('membership_tier', ['free', 'premium']);

export const users = pgTable('users', {
  id:              uuid('id').primaryKey().defaultRandom(),
  email:           varchar('email',        { length: 255 }).notNull().unique(),
  username:        varchar('username',     { length: 50  }).notNull().unique(),
  display_name:    varchar('display_name', { length: 100 }).notNull(),
  password_hash:   text('password_hash'),
  avatar_url:      text('avatar_url'),
  bio:             text('bio'),
  profession:      professionEnum('profession').default('general'),
  role:            roleEnum('role').default('member').notNull(),
  membership_tier: membershipTierEnum('membership_tier').default('free').notNull(),
  is_verified:     boolean('is_verified').default(false).notNull(),
  is_active:       boolean('is_active').default(true).notNull(),
  last_login_at:   timestamp('last_login_at', { withTimezone: true }),
  created_at:      timestamp('created_at',    { withTimezone: true }).defaultNow().notNull(),
  updated_at:      timestamp('updated_at',    { withTimezone: true }).defaultNow().notNull(),
});

export type User    = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const practitionerProfiles = pgTable('practitioner_profiles', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  user_id:            uuid('user_id').notNull().unique(),
  specialties:        text('specialties').array(),
  years_experience:   integer('years_experience'),
  license_number:     varchar('license_number', { length: 100 }),
  clinic_name:        varchar('clinic_name',    { length: 200 }),
  clinic_address:     text('clinic_address'),
  is_verified:        boolean('is_verified').default(false).notNull(),
  verified_at:        timestamp('verified_at', { withTimezone: true }),
  verification_notes: text('verification_notes'),
  created_at:         timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at:         timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type PractitionerProfile    = typeof practitionerProfiles.$inferSelect;
export type NewPractitionerProfile = typeof practitionerProfiles.$inferInsert;

export const userInterests = pgTable('user_interests', {
  user_id:    uuid('user_id').notNull(),
  interest:   varchar('interest', { length: 64 }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.user_id, t.interest] }),
}));

export type UserInterest = typeof userInterests.$inferSelect;
