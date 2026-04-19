import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, type User } from '../../db/schema/users';
import { emailVerifications, passwordResetTokens } from '../../db/schema/auth';
import { hashPassword, comparePassword } from '../../utils/hash';
import { generateVerificationToken, generateResetToken, TOKEN_EXPIRY } from '../../utils/token';
import type { RegisterInput } from './auth.schema';

export type PublicUser = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  profession: string;
  role: string;
  membership_tier: string;
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
};

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    bio: u.bio,
    profession: u.profession ?? 'general',
    role: u.role,
    membership_tier: u.membership_tier,
    is_verified: u.is_verified,
    is_active: u.is_active,
    created_at: u.created_at.toISOString(),
  };
}

export async function findUserByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return rows[0] ?? null;
}

export async function findUserByUsername(username: string) {
  const rows = await db.select().from(users).where(eq(users.username, username.toLowerCase())).limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createUser(input: RegisterInput) {
  const password_hash = await hashPassword(input.password);
  const [row] = await db
    .insert(users)
    .values({
      email:        input.email.toLowerCase(),
      username:     input.username.toLowerCase(),
      display_name: input.display_name,
      password_hash,
      profession:   input.profession,
      role:         'member',
      membership_tier: 'free',
      is_verified: false,
      is_active: true,
    })
    .returning();
  return row;
}

export async function createEmailVerification(userId: string) {
  const token = generateVerificationToken();
  const expires_at = new Date(Date.now() + TOKEN_EXPIRY.EMAIL_VERIFICATION);
  await db.insert(emailVerifications).values({ user_id: userId, token, expires_at });
  return { token, expires_at };
}

export async function createPasswordReset(userId: string) {
  const token = generateResetToken();
  const expires_at = new Date(Date.now() + TOKEN_EXPIRY.PASSWORD_RESET);
  await db.insert(passwordResetTokens).values({ user_id: userId, token, expires_at });
  return { token, expires_at };
}

export async function verifyPassword(user: User, plain: string) {
  if (!user.password_hash) return false;
  return comparePassword(plain, user.password_hash);
}

export async function updateLastLogin(userId: string) {
  await db.update(users).set({ last_login_at: new Date() }).where(eq(users.id, userId));
}

export async function setIsVerified(userId: string) {
  await db.update(users).set({ is_verified: true, updated_at: new Date() }).where(eq(users.id, userId));
}

export async function setPasswordHash(userId: string, plain: string) {
  const password_hash = await hashPassword(plain);
  await db.update(users).set({ password_hash, updated_at: new Date() }).where(eq(users.id, userId));
}
