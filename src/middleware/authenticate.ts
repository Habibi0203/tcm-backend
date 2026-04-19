import type { FastifyRequest, FastifyReply } from 'fastify';
import { sendError, ErrorCodes } from '../utils/response';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    if (!request.user) throw new Error('no user on request');
    if (request.user.is_active === false) {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Akun dinonaktifkan', 403);
    }
    request.isAgent = false;
  } catch {
    return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Token tidak valid atau sudah expired', 401);
  }
}
