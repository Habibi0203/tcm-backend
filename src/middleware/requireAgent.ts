import type { FastifyRequest, FastifyReply } from 'fastify';
import { sendError, ErrorCodes } from '../utils/response';
import { config } from '../config';

export async function requireAgent(request: FastifyRequest, reply: FastifyReply) {
  const headerKey = request.headers['x-agent-key'];
  const key = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  if (!key || key !== config.AGENT_API_KEY) {
    return sendError(reply, ErrorCodes.UNAUTHORIZED, 'Agent key tidak valid', 401);
  }
  request.isAgent = true;
}
