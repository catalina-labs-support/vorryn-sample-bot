// Process entrypoint. Wires env to the Fastify app.
//
// Boot:
//   PORT=3001 BOT_BEARER=<secret> pnpm dev

import { createSampleBotApp } from './app.js';

const PORT = Number(process.env['PORT'] ?? 3001);
const BOT_BEARER = process.env['BOT_BEARER'] ?? '';

if (BOT_BEARER.length === 0) {
  // Refuse to boot without a secret — don't silently accept forged requests.
  console.error('BOT_BEARER is required. Set it in .env or your host secrets.');
  process.exit(1);
}

const app = createSampleBotApp(BOT_BEARER);

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  app.log.info({ port: PORT }, 'vorryn-sample-bot listening');
});
