import type { FastifyRequest, FastifyReply } from 'fastify';
import { sendError, ErrorCodes } from '../utils/response';

type Role = 'member' | 'moderator' | 'admin' | 'agent';

export function requireRole(roles: Role[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!request.user || !roles.includes(request.user.role as Role)) {
      return sendError(reply, ErrorCodes.FORBIDDEN, 'Tidak punya akses', 403);
    }
  };
}
