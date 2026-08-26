import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { BotRequestSchema } from './schemas.js';
import { pickAction } from './strategy.js';

function bearerMatches(header: string | undefined, expectedDigest: Buffer): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false;
  const presented = header.slice(7);
  if (presented.length === 0) return false;
  const presentedDigest = createHash('sha256').update(presented).digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
}

export function createSampleBotApp(botBearer: string, logger = true) {
  const app = Fastify({ logger });
  const bearerDigest = createHash('sha256').update(botBearer).digest();

  app.get('/health', async () => ({ ok: true }));

  app.post('/play', async (req, reply) => {
    if (!bearerMatches(req.headers.authorization, bearerDigest)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    // 422 on a bad envelope lets Vorryn fall back without retrying a malformed request.
    const parsed = BotRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: 'malformed_request', issues: parsed.error.issues });
    }

    return reply.code(200).send(pickAction(parsed.data));
  });

  return app;
}
