import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotRequestSchema } from '../src/schemas.js';
import { simulateActions } from '../src/simulator.js';

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

console.log(
  'PASS - simulator is deterministic, order-invariant, legal, goal-aware, and prefers development'
);
