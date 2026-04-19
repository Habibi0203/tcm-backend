import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { db } from '../../db/client';
import { users } from '../../db/schema/users';
import { emailVerifications, passwordResetTokens } from '../../db/schema/auth';
import { auditLogs } from '../../db/schema/system';
import { sendSuccess, sendError, ErrorCodes } from '../../utils/response';
import {
  registerSchema, loginSchema, verifyEmailSchema,
  forgotPasswordSchema, resetPasswordSchema,
} from './auth.schema';
import {
  findUserByEmail, findUserByUsername, createUser,
  createEmailVerification, createPasswordReset, verifyPassword,
  updateLastLogin, setIsVerified, setPasswordHash, toPublicUser, findUserById,
} from './auth.service';
import { JWT_EXPIRY, REFRESH_COOKIE_NAME, REFRESH_COOKIE_MAX_AGE } from '../../utils/token';
import { config } from '../../config';
import { sendEmail, buildWelcomeEmail, buildResetPasswordEmail } from '../../lib/brevo';

function signAccess(fastify: FastifyInstance, u: { id: string; email: string; username: string; role: string; membership_tier: string }) {
  return fastify.jwt.sign(
    { id: u.id, email: u.email, username: u.username, role: u.role, membership_tier: u.membership_tier },
    { expiresIn: JWT_EXPIRY.ACCESS },
  );
}

function signRefresh(fastify: FastifyInstance, u: { id: string; email: string; username: string; role: string; membership_tier: string }) {
  return (fastify as FastifyInstance & { jwt: { sign: (p: object, o?: object) => string } })
    .jwt.sign(
      { id: u.id, email: u.email, username: u.username, role: u.role, membership_tier: u.membership_tier, kind: 'refresh' },
      { expiresIn: JWT_EXPIRY.REFRESH, key: config.JWT_REFRESH_SECRET } as unknown as object,
    );
}

function setRefreshCookie(reply: Parameters<FastifyInstance['decorateReply']>[1] extends never ? never : Parameters<FastifyInstance['addSchema']>[0], token: string) {
  // actual typed below via fastify instance helpers
  return token;
}

export default async function authRoutes(fastify: FastifyInstance) {
  // ── Per-endpoint rate limits (override global 200/min) ────────────────────
  const loginRateLimit    = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };
  const registerRateLimit = { config: { rateLimit: { max: 5,  timeWindow: '1 hour'     } } };
  const forgotRateLimit   = { config: { rateLimit: { max: 3,  timeWindow: '1 hour'     } } };

  // ----- REGISTER -----
  fastify.post('/auth/register', {
    schema: { tags: ['auth'], summary: 'Register new user' },
    ...registerRateLimit,
  }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join('.') || '_'] = i.message;
      return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422, fields);
    }
    const input = parsed.data;

    if (await findUserByEmail(input.email)) {
      return sendError(reply, ErrorCodes.CONFLICT, 'Email sudah terdaftar', 409, { email: 'Email sudah terdaftar' });
    }
    if (await findUserByUsername(input.username)) {
      return sendError(reply, ErrorCodes.CONFLICT, 'Username sudah dipakai', 409, { username: 'Username sudah dipakai' });
    }

    const user = await createUser(input);
    const { token } = await createEmailVerification(user.id);
    if (config.NODE_ENV !== 'production') {
      fastify.log.info(`[DEV] Email verification token: ${token}`);
    }

    // Send welcome email (fire-and-forget — don't block registration on email failure)
    const welcome = buildWelcomeEmail(user.display_name);
    sendEmail({ to: [{ email: user.email, name: user.display_name }], ...welcome })
      .then((r) => { if (!r.ok) fastify.log.warn(`[brevo] welcome email failed: ${r.error}`); })
      .catch((e: unknown) => fastify.log.warn(`[brevo] welcome email error: ${String(e)}`));

    const payload = { id: user.id, email: user.email, username: user.username, role: user.role, membership_tier: user.membership_tier };
    const access_token = signAccess(fastify, payload);
    const refresh_token = fastify.jwt.sign(payload as Parameters<typeof fastify.jwt.sign>[0], { expiresIn: JWT_EXPIRY.REFRESH });

    reply.setCookie(REFRESH_COOKIE_NAME, refresh_token, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: REFRESH_COOKIE_MAX_AGE,
      secure: config.NODE_ENV === 'production',
    });

    return sendSuccess(reply, { ...toPublicUser(user), access_token }, undefined, 201);
  });

  // ----- LOGIN -----
  fastify.post('/auth/login', {
    schema: { tags: ['auth'], summary: 'Login dengan email + password' },
    ...loginRateLimit,
  }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);
    }
    const { email, password } = parsed.data;
    const user = await findUserByEmail(email);
    if (!user) {
      return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Email atau password salah', 401);
    }
    if (!user.is_active) {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Akun dinonaktifkan', 403);
    }
    if (!user.is_verified) {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Email belum diverifikasi', 403);
    }
    const ok = await verifyPassword(user, password);
    if (!ok) {
      return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Email atau password salah', 401);
    }

    await updateLastLogin(user.id);
    await db.insert(auditLogs).values({
      user_id: user.id,
      action: 'login',
      ip_address: request.ip,
      user_agent: request.headers['user-agent'] ?? null,
    });

    const payload = { id: user.id, email: user.email, username: user.username, role: user.role, membership_tier: user.membership_tier };
    const access_token = signAccess(fastify, payload);
    const refresh_token = fastify.jwt.sign(payload as Parameters<typeof fastify.jwt.sign>[0], { expiresIn: JWT_EXPIRY.REFRESH });

    reply.setCookie(REFRESH_COOKIE_NAME, refresh_token, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: REFRESH_COOKIE_MAX_AGE,
      secure: config.NODE_ENV === 'production',
    });

    return sendSuccess(reply, { ...toPublicUser(user), access_token });
  });

  // ----- REFRESH -----
  fastify.post('/auth/refresh', {
    schema: { tags: ['auth'], summary: 'Rotate refresh token' },
  }, async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    if (!token) {
      return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Tidak ada refresh token', 401);
    }
    const blacklisted = await fastify.redis.get(`refresh_blacklist:${token}`);
    if (blacklisted) {
      return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Refresh token tidak valid', 401);
    }
    let decoded: { id: string; email: string; username: string; role: string; membership_tier: string };
    try {
      decoded = fastify.jwt.verify(token) as typeof decoded;
    } catch {
      return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Refresh token tidak valid', 401);
    }

    // Blacklist old
    await fastify.redis.set(`refresh_blacklist:${token}`, '1', 'EX', REFRESH_COOKIE_MAX_AGE);

    const user = await findUserById(decoded.id);
    if (!user || !user.is_active) {
      return sendError(reply, ErrorCodes.UNAUTHORIZED, 'User tidak valid', 401);
    }

    const payload = { id: user.id, email: user.email, username: user.username, role: user.role, membership_tier: user.membership_tier };
    const access_token = signAccess(fastify, payload);
    const refresh_token = fastify.jwt.sign(payload as Parameters<typeof fastify.jwt.sign>[0], { expiresIn: JWT_EXPIRY.REFRESH });

    reply.setCookie(REFRESH_COOKIE_NAME, refresh_token, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: REFRESH_COOKIE_MAX_AGE,
      secure: config.NODE_ENV === 'production',
    });

    return sendSuccess(reply, { access_token });
  });

  // ----- LOGOUT -----
  fastify.post('/auth/logout', {
    schema: { tags: ['auth'], summary: 'Logout + blacklist refresh' },
  }, async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE_NAME];
    if (token) {
      await fastify.redis.set(`refresh_blacklist:${token}`, '1', 'EX', REFRESH_COOKIE_MAX_AGE);
    }
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
    return sendSuccess(reply, { message: 'Berhasil logout' });
  });

  // ----- VERIFY EMAIL -----
  fastify.post('/auth/verify-email', {
    schema: { tags: ['auth'], summary: 'Verify email by token' },
  }, async (request, reply) => {
    const parsed = verifyEmailSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);
    const rows = await db
      .select()
      .from(emailVerifications)
      .where(and(
        eq(emailVerifications.token, parsed.data.token),
        isNull(emailVerifications.used_at),
        gt(emailVerifications.expires_at, new Date()),
      ))
      .limit(1);
    const row = rows[0];
    if (!row) return sendError(reply, ErrorCodes.NOT_FOUND, 'Token tidak valid atau kedaluwarsa', 404);

    await setIsVerified(row.user_id);
    await db.update(emailVerifications).set({ used_at: new Date() }).where(eq(emailVerifications.id, row.id));
    return sendSuccess(reply, { message: 'Email berhasil diverifikasi' });
  });

  // ----- FORGOT PASSWORD -----
  fastify.post('/auth/forgot-password', {
    schema: { tags: ['auth'], summary: 'Trigger password-reset token' },
    ...forgotRateLimit,
  }, async (request, reply) => {
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);
    const user = await findUserByEmail(parsed.data.email);
    if (user) {
      const { token } = await createPasswordReset(user.id);
      if (config.NODE_ENV !== 'production') {
        fastify.log.info(`[DEV] Password reset token: ${token}`);
      }

      // Send reset-password email (fire-and-forget)
      const frontendUrl = config.FRONTEND_URL ?? 'https://tcm.my.id';
      const resetUrl    = `${frontendUrl}/reset-password?token=${token}`;
      const resetEmail  = buildResetPasswordEmail(user.display_name, resetUrl);
      sendEmail({ to: [{ email: user.email, name: user.display_name }], ...resetEmail })
        .then((r) => { if (!r.ok) fastify.log.warn(`[brevo] reset email failed: ${r.error}`); })
        .catch((e: unknown) => fastify.log.warn(`[brevo] reset email error: ${String(e)}`));
    }
    return sendSuccess(reply, { message: 'Jika email terdaftar, instruksi reset telah dikirim' });
  });

  // ----- RESET PASSWORD -----
  fastify.post('/auth/reset-password', {
    schema: { tags: ['auth'], summary: 'Reset password via token' },
  }, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, ErrorCodes.VALIDATION_ERROR, 'Input tidak valid', 422);
    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.token, parsed.data.token),
        isNull(passwordResetTokens.used_at),
        gt(passwordResetTokens.expires_at, new Date()),
      ))
      .limit(1);
    const row = rows[0];
    if (!row) return sendError(reply, ErrorCodes.NOT_FOUND, 'Token reset tidak valid atau kedaluwarsa', 404);

    await setPasswordHash(row.user_id, parsed.data.new_password);
    await db.update(passwordResetTokens).set({ used_at: new Date() }).where(eq(passwordResetTokens.id, row.id));
    return sendSuccess(reply, { message: 'Password berhasil direset' });
  });

  // ----- GOOGLE OAUTH (placeholder redirect — real flow configured via @fastify/oauth2 plugin when creds ready) -----
  fastify.get('/auth/google', {
    schema: { tags: ['auth'], summary: 'Redirect ke Google OAuth' },
  }, async (_request, reply) => {
    if (!config.GOOGLE_CLIENT_ID) {
      return sendError(reply, ErrorCodes.INTERNAL_ERROR, 'Google OAuth belum dikonfigurasi', 501);
    }
    // Redirect to Google consent screen (minimal shape — @fastify/oauth2 would handle this).
    const params = new URLSearchParams({
      client_id:     config.GOOGLE_CLIENT_ID,
      redirect_uri:  config.GOOGLE_CALLBACK_URL,
      response_type: 'code',
      scope:         'openid email profile',
      prompt:        'select_account',
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  fastify.get('/auth/google/callback', {
    schema: { tags: ['auth'], summary: 'Google OAuth callback' },
  }, async (request, reply) => {
    // Full token-exchange + upsert flow belongs here. For Phase 2A scaffolding,
    // we only wire the redirect pattern. Once creds exist, exchange `code` for
    // profile, upsert user (is_verified=true), then:
    //   reply.setCookie(refresh_token...); return reply.redirect(FRONTEND_URL + '/auth/callback?token=' + access)
    return sendError(reply, ErrorCodes.INTERNAL_ERROR, 'Google OAuth callback belum terkonfigurasi di lingkungan ini', 501);
  });
}

// Swallow the dummy helper so TS doesn't warn
export { setRefreshCookie };
