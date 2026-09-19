import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotRequestSchema } from '../src/schemas.js';
import { simulateActions } from '../src/simulator.js';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { searchActions } from '../src/search.js';
import { pickAction } from '../src/strategy.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = BotRequestSchema.parse(
  JSON.parse(readFileSync(join(here, '..', 'fixtures', 'play-request.json'), 'utf8'))
);
const first = simulateActions(fixture, { samples: 50, seed: 7 });
const second = simulateActions(fixture, { samples: 50, seed: 7 });

if (JSON.stringify(first) !== JSON.stringify(second))
  throw new Error('seeded simulation must repeat');
const reversedFixture = BotRequestSchema.parse({
  ...fixture,
  validActions: [...fixture.validActions].reverse(),
});
const reversed = simulateActions(reversedFixture, { samples: 50, seed: 7 });
const scoresById = new Map(first.map((result) => [result.action.id, result.meanUtility]));
if (reversed.some((result) => scoresById.get(result.action.id) !== result.meanUtility)) {
  throw new Error('candidate input order changed the sampled evaluation');
}
if (first[0]?.action.type !== 'buildSettlement') {
  throw new Error(
    `expected buildSettlement over endTurn, got ${first[0]?.action.type ?? 'nothing'}`
  );
}
if (first.some((result) => !fixture.validActions.includes(result.action))) {
  throw new Error('simulator returned an action outside validActions');
}

const forced = BotRequestSchema.parse({
  ...fixture,
  validActions: [{ id: 'roll', type: 'rollDice' }],
});
if (simulateActions(forced, { seed: 2 })[0]?.action.id !== 'roll') {
  throw new Error('single forced action was not selected');
}

const goalAwareTrade = BotRequestSchema.parse({
  ...fixture,
  state: {
    ...fixture.state,
    players: {
      [fixture.playerId]: {
        resources: { lumber: 3, brick: 0, wool: 1, grain: 1, ore: 0 },
        commodities: {},
      },
    },
  },
  validActions: [
    {
      id: 'get-brick',
      type: 'maritimeTrade',
      offer: { type: 'lumber', count: 2 },
      want: { type: 'brick', count: 1 },
    },
    {
      id: 'get-lumber',
      type: 'maritimeTrade',
      offer: { type: 'wool', count: 2 },
      want: { type: 'lumber', count: 1 },
    },
  ],
});
if (simulateActions(goalAwareTrade, { samples: 100, seed: 3 })[0]?.action.id !== 'get-brick') {
  throw new Error('simulator did not value the material completing its closest build goal');
}

const favorableBid = BotRequestSchema.parse({
  ...goalAwareTrade,
  validActions: [
    {
      id: 'accept-brick',
      type: 'domesticTradeBid',
      offer: [{ type: 'brick', count: 1 }],
      want: [{ type: 'lumber', count: 1 }],
    },
    { id: 'pass', type: 'domesticTradePass' },
  ],
});
if (simulateActions(favorableBid, { samples: 100, seed: 4 })[0]?.action.id !== 'accept-brick') {
  throw new Error('responder rejected a favorable proposer-perspective trade');
}

const unfavorableBid = BotRequestSchema.parse({
  ...goalAwareTrade,
  state: {
    ...goalAwareTrade.state,
    players: {
      [fixture.playerId]: {
        resources: { lumber: 0, brick: 5, wool: 1, grain: 1, ore: 0 },
        commodities: {},
      },
    },
  },
  validActions: [
    {
      id: 'give-brick',
      type: 'domesticTradeBid',
      offer: [{ type: 'lumber', count: 1 }],
      want: [{ type: 'brick', count: 5 }],
    },
    { id: 'pass', type: 'domesticTradePass' },
  ],
});
if (simulateActions(unfavorableBid, { samples: 100, seed: 5 })[0]?.action.id !== 'pass') {
  throw new Error('responder accepted an unfavorable proposer-perspective trade');
}

const progressDiscard = BotRequestSchema.parse({
  ...fixture,
  state: {
    ...fixture.state,
    players: {
      [fixture.playerId]: {
        progressHand: [
          { instanceId: 'vp', cardId: 'politicsConstitution' },
          { instanceId: 'ordinary', cardId: 'scienceIrrigation' },
        ],
      },
    },
  },
  validActions: [
    { id: 'discard-vp', type: 'discardProgress', instanceIds: ['vp'] },
    { id: 'discard-ordinary', type: 'discardProgress', instanceIds: ['ordinary'] },
  ],
});
if (
  simulateActions(progressDiscard, { samples: 50, seed: 6 })[0]?.action.id !== 'discard-ordinary'
) {
  throw new Error('forced discard failed to preserve the high-value progress card');
}

const pillageLeader = BotRequestSchema.parse({
  ...fixture,
  state: {
    ...fixture.state,
    players: {
      [fixture.playerId]: { victoryPoints: 4 },
      leader: { victoryPoints: 11 },
      trailer: { victoryPoints: 3 },
    },
    board: {
      hexes: { productive: { numberToken: 6, type: 'fields' } },
      edges: {},
      intersections: {
        'leader-city': {
          adjacentHexIds: ['productive'],
          building: { ownerPlayerId: 'leader' },
        },
        'trailer-city': {
          adjacentHexIds: ['productive'],
          building: { ownerPlayerId: 'trailer' },
        },
      },
    },
  },
  validActions: [
    { id: 'pillage-trailer', type: 'choosePillageCity', intersectionId: 'trailer-city' },
    { id: 'pillage-leader', type: 'choosePillageCity', intersectionId: 'leader-city' },
  ],
});
if (simulateActions(pillageLeader, { samples: 50, seed: 7 })[0]?.action.id !== 'pillage-leader') {
  throw new Error('pillage decision failed to target the leading opponent');
}

const immediateWin = BotRequestSchema.parse({
  ...fixture,
  state: {
    ...fixture.state,
    victoryPointsTarget: 6,
    players: {
      [fixture.playerId]: { victoryPoints: 5, resources: {}, commodities: {} },
    },
  },
  validActions: [
    { id: 'stop', type: 'endTurn' },
    { id: 'win', type: 'buildSettlement', intersectionId: 'unknown-but-legal' },
  ],
});
if (simulateActions(immediateWin, { samples: 20, seed: 8 })[0]?.action.id !== 'win') {
  throw new Error('simulator failed to take an immediate public victory');
}

// Equal opponents and identical terms isolate seat labels from public strategy.
// Exercise the fallback itself: ordinary HTTP smoke tests use the champion.
const fairRequest = BotRequestSchema.parse({
  ...fixture,
  playerId: 'actor',
  state: {
    ...fixture.state,
    players: {
      host: { seatIndex: 0, victoryPoints: 4, resourceCount: 3, commodityCount: 0 },
      actor: { seatIndex: 1, victoryPoints: 4, resources: { ore: 3 }, commodities: {} },
      next: { seatIndex: 2, victoryPoints: 4, resourceCount: 3, commodityCount: 0 },
    },
    opponentMaterialTypes: ['grain'],
  },
  recentEvents: [],
  validActions: ['host', 'next'].map((targetPlayerId, index) => ({
    id: `action-${index}`,
    type: 'domesticTradePropose',
    targetPlayerId,
    offer: [{ type: 'ore', count: 1 }],
    want: [{ type: 'grain', count: 1 }],
  })),
});
const fallbackOptions = { samples: 512, seed: 7, deadlineMs: 60_000 };
const { humanPlayerIds: _labels, ...unlabeled } = fairRequest;
const expectedFairScores = simulateActions(BotRequestSchema.parse(unlabeled), fallbackOptions);
strictEqual(expectedFairScores.length, 2);
const expectedFallback = pickAction(BotRequestSchema.parse(unlabeled));
strictEqual(
  expectedFallback.decisionTrace?.strategy,
  'public-information-monte-carlo-fallback-v1',
  'fixture must exercise the served fallback, not the bundled champion'
);
for (const humanPlayerIds of [[], ['host'], ['next'], ['host', 'next'], ['actor']]) {
  const labeled = BotRequestSchema.parse({ ...unlabeled, humanPlayerIds });
  deepStrictEqual(
    simulateActions(labeled, fallbackOptions),
    expectedFairScores,
    `fallback scores changed for human seats ${humanPlayerIds.join(',')}`
  );
  deepStrictEqual(
    searchActions(labeled, fallbackOptions),
    searchActions(BotRequestSchema.parse(unlabeled), fallbackOptions),
    'fallback search depends on human labels'
  );
  deepStrictEqual(pickAction(labeled), expectedFallback, 'served fallback depends on human labels');
}

// Wire IDs follow enumeration order. They must not always break target ties
// toward the host. Rotate seats and rename action IDs as well as their order.
for (const type of ['chooseStealTarget', 'domesticTradePropose']) {
  for (const rotation of [0, 1, 2]) {
    for (const reversed of [false, true]) {
      const targets = reversed ? ['next', 'host'] : ['host', 'next'];
      const request = BotRequestSchema.parse({
        ...unlabeled,
        state: {
          ...fairRequest.state,
          players: Object.fromEntries(
            Object.entries(
              fairRequest.state.players as Record<string, Record<string, unknown>>
            ).map(([id, player]) => [
              id,
              { ...player, seatIndex: (Number(player.seatIndex) + rotation) % 3 },
            ])
          ),
        },
        validActions: targets.map((targetPlayerId, index) => ({
          ...fairRequest.validActions[0],
          id: `action-${index}`,
          type,
          targetPlayerId,
        })),
      });
      strictEqual(
        simulateActions(request, fallbackOptions)[0]?.action.targetPlayerId,
        'next',
        'fallback target tie followed host/order instead of relative turn order'
      );
      strictEqual(
        searchActions(request, fallbackOptions)[0]?.action.targetPlayerId,
        'next',
        'search discarded the seat-neutral fallback tie'
      );
    }
  }
}

console.log(
  'PASS - simulator is deterministic, order-invariant, legal, goal-aware, and prefers development'
);
