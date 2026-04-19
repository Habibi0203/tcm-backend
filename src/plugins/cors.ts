import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { config } from '../config';

export default fp(async (fastify) => {
  const origins = config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  await fastify.register(cors, {
    origin: origins.length ? origins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
});
