import type { FastifyReply } from 'fastify';

export function sendSuccess(
  reply: FastifyReply,
  data: unknown,
  meta?: object,
  statusCode = 200,
) {
  return reply.status(statusCode).send({ success: true, data, ...(meta ? { meta } : {}) });
}

export function sendError(
  reply: FastifyReply,
  code: string,
  message: string,
  statusCode: number,
  fields?: Record<string, string>,
) {
  return reply.status(statusCode).send({
    success: false,
    error: { code, message, ...(fields ? { fields } : {}) },
  });
}

export const ErrorCodes = {
  UNAUTHORIZED:     'UNAUTHORIZED',
  FORBIDDEN:        'FORBIDDEN',
  NOT_FOUND:        'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PREMIUM_REQUIRED: 'PREMIUM_REQUIRED',
  RATE_LIMITED:     'RATE_LIMITED',
  INTERNAL_ERROR:   'INTERNAL_ERROR',
  CONFLICT:         'CONFLICT',
} as const;
