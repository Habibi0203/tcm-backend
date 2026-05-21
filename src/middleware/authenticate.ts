import type { FastifyRequest, FastifyReply } from 'fastify';
import { sendError, ErrorCodes } from '../utils/response';
import { findUserById } from '../modules/auth/auth.service';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    if (!request.user) throw new Error('no user on request');

    const user = await findUserById(request.user.id);
    if (!user || !user.is_active) {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Akun dinonaktifkan', 403);
    }

    request.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role as typeof request.user.role,
      membership_tier: user.membership_tier as typeof request.user.membership_tier,
      is_active: user.is_active,
      is_verified: user.is_verified,
    };
    request.isAgent = false;
  } catch {
    return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Token tidak valid atau sudah expired', 401);
  }
}
