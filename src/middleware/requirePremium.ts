import type { FastifyRequest, FastifyReply } from 'fastify';
import { sendError, ErrorCodes } from '../utils/response';

export async function requirePremium(request: FastifyRequest, reply: FastifyReply) {
  const role = request.user?.role;
  if (role === 'admin' || role === 'moderator' || role === 'agent') return;
  if (request.user?.membership_tier !== 'premium') {
    return sendError(reply, ErrorCodes.PREMIUM_REQUIRED, 'Butuh membership premium', 403);
  }
}
