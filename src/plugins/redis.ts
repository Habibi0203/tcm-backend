import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { config } from '../config';

export default fp(async (fastify) => {
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

  redis.on('error', (err) => fastify.log.error({ err }, 'Redis error'));

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit().catch(() => redis.disconnect());
  });
});
