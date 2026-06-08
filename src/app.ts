import Fastify from 'fastify';
import { BotRequestSchema } from './schemas.js';
import { pickAction } from './strategy.js';

export function createSampleBotApp(botBearer: string, logger = true) {
  const app = Fastify({ logger });

  app.get('/health', async () => ({ ok: true }));

  app.post('/play', async (req, reply) => {
    const authHeader = req.headers['authorization'] ?? '';
    if (authHeader !== `Bearer ${botBearer}`) {
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
