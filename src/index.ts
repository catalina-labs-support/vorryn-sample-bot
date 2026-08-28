// Process entrypoint. Wires env to the Fastify app.
//
// Boot:
//   PORT=3001 BOT_BEARER=<secret> pnpm dev

import { createSampleBotApp } from './app.js';

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const BOT_BEARER = process.env['BOT_BEARER'] ?? '';

if (BOT_BEARER.length === 0) {
  // Refuse to boot without a secret — don't silently accept forged requests.
  console.error('BOT_BEARER is required. Set it in .env or your host secrets.');
  process.exit(1);
}

const app = createSampleBotApp(BOT_BEARER);

app.listen({ port: PORT, host: HOST }).then(() => {
  app.log.info({ port: PORT, host: HOST }, 'vorryn-sample-bot listening');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error(error, 'graceful shutdown failed');
        process.exit(1);
      });
  });
}
