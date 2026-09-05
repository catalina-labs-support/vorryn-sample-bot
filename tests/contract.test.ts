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

  if (body.decisionTrace?.externalStrategy !== 'bundled-fair-ceiling-champion-v2') {
    console.error(`${name}: competitive champion policy did not run`);
    process.exit(1);
  }

  console.log(`PASS — ${name}: bot chose ${body.actionId}`);
}

const baseFixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', FIXTURES[0] ?? ''), 'utf8')
);
const humanFixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', FIXTURES[1] ?? ''), 'utf8')
);
const opponentId = Object.keys(humanFixture.state.players as Record<string, unknown>).find(
  (playerId) => playerId !== humanFixture.playerId
);
if (opponentId === undefined) throw new Error('fixture needs an opponent for the human-table test');
const humanTableResponse = await app.inject({
  method: 'POST',
  url: '/play',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${BOT_BEARER}`,
  },
  payload: { ...humanFixture, humanPlayerIds: [opponentId] },
});
if (humanTableResponse.statusCode !== 200) {
  throw new Error(`human-table champion failed: ${humanTableResponse.body}`);
}
const humanTableBody = humanTableResponse.json();
if (humanTableBody.decisionTrace?.externalStrengthProfile !== 'maximum-strength') {
  throw new Error('human-table request did not activate the maximum-strength policy');
}
// The full priced-handicap set the champion disables, mirroring PRICED_HANDICAPS
// in bot/src/fair-ceiling.ts. This example is standalone by design, so it cannot
// import that constant and must restate it — which means this list going stale is
// a real failure mode, not a nuisance. It already happened: `humanProposalMinQuality`
// was retired from PRICED_HANDICAPS on 2026-08-28 (e35ae12eb) and this assertion
// kept passing, because the committed champion.js bundle was equally stale and
// still emitted the retired knob. Two stale artifacts agreeing with each other,
// under a green CI job. Asserting the WHOLE set rather than a two-item subset is
// what makes the next divergence fail loudly instead of silently agreeing.
// The restored three-proposal cap is a retained product constraint, so it must
// not appear among the handicaps this champion disables.
const EXPECTED_DISABLED_HANDICAPS = [
  'domesticTradeProposeOverheadDefault',
  'tradeBuildPathTwoForOneBonus',
];
const disabledHandicaps = humanTableBody.decisionTrace?.disabledPricedHandicaps;
if (
  !Array.isArray(disabledHandicaps) ||
  disabledHandicaps.length !== EXPECTED_DISABLED_HANDICAPS.length ||
  !EXPECTED_DISABLED_HANDICAPS.every((knob) => disabledHandicaps.includes(knob))
) {
  throw new Error(
    `human-table trace did not identify the disabled product handicaps — expected exactly [${EXPECTED_DISABLED_HANDICAPS.join(', ')}], got [${String(disabledHandicaps)}]`
  );
}
console.log('PASS â€” every request activates the unhandicapped maximum-strength policy');

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
