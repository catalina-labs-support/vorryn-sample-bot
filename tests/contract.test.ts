// Smoke test: inject each fixture through the Fastify handler and assert a
// well-formed BotResponse. No running Vorryn or dev server is required.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSampleBotApp } from '../src/app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOT_BEARER = 'fixture-bearer';

const FIXTURES = ['play-request.json', 'play-request-full.json'];

const app = createSampleBotApp(BOT_BEARER, false);

for (const name of FIXTURES) {
  const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8'));

  const res = await app.inject({
    method: 'POST',
    url: '/play',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BOT_BEARER}`,
    },
    payload: fixture,
  });

  if (res.statusCode !== 200) {
    console.error(`${name}: expected 200, got ${res.statusCode}: ${res.body}`);
    process.exit(1);
  }

  const body = res.json();
  if (body.protocolVersion !== 2) {
    console.error(`${name}: expected protocolVersion=2, got ${body.protocolVersion}`);
    process.exit(1);
  }

  if (body.kind !== 'action') {
    console.error(`${name}: expected kind=action, got ${body.kind}`);
    process.exit(1);
  }

  const validIds = new Set(fixture.validActions.map((a: { id: string }) => a.id));
  if (!validIds.has(body.actionId)) {
    console.error(`${name}: actionId ${body.actionId} is not in validActions[]`);
    process.exit(1);
  }

  console.log(`PASS — ${name}: bot chose ${body.actionId}`);
}

const baseFixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', FIXTURES[0] ?? ''), 'utf8')
);

for (const malformed of [
  {
    label: 'empty candidate id',
    payload: { ...baseFixture, validActions: [{ id: '', type: 'endTurn' }] },
  },
  {
    label: 'duplicate candidate ids',
    payload: {
      ...baseFixture,
      validActions: [
        { id: 'duplicate', type: 'endTurn' },
        { id: 'duplicate', type: 'rollDice' },
      ],
    },
  },
  {
    label: 'wrong protocol version',
    payload: { ...baseFixture, protocolVersion: 1 },
  },
]) {
  const res = await app.inject({
    method: 'POST',
    url: '/play',
    headers: { Authorization: `Bearer ${BOT_BEARER}` },
    payload: malformed.payload,
  });
  if (res.statusCode !== 422) {
    console.error(`${malformed.label}: expected 422, got ${res.statusCode}: ${res.body}`);
    process.exit(1);
  }
  console.log(`PASS — rejected ${malformed.label}`);
}

for (const authorization of [undefined, 'Bearer wrong-secret', 'Basic fixture-bearer']) {
  const res = await app.inject({
    method: 'POST',
    url: '/play',
    headers: authorization === undefined ? {} : { Authorization: authorization },
    payload: baseFixture,
  });
  if (res.statusCode !== 401) {
    console.error(`bad authorization: expected 401, got ${res.statusCode}: ${res.body}`);
    process.exit(1);
  }
}
console.log('PASS — rejected missing and invalid authorization');

await app.close();
