import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { BotRequestSchema } from '../src/schemas.js';

const CorpusSchema = z.array(
  z.object({
    family: z.enum(['action', 'discard', 'proposer', 'responder']),
    source: z.object({
      file: z.literal('corpus/self-play.ndjson.gz'),
      gameId: z.string(),
      sequence: z.number().int().positive(),
      revision: z.literal('4331c3a3f291341771927a9cab0b45da745019a6'),
      sha256: z.literal('783007622f2b1792eddb7b3ba795dcc484e2cced890307919a105c1856e0f447'),
    }),
    request: BotRequestSchema,
  })
);

// Independent expectations for these four captured requests. A missing family,
// shortened candidate list, accidental hidden hand, or changed ID fails loudly.
const EXPECTED = {
  action: {
    count: 71,
    actor: 'p1',
    turn: 4,
    chosenId: 'action-71',
    chosenType: 'buildRoad',
    bytes: [49_000, 51_000],
  },
  discard: {
    count: 30,
    actor: 'p3',
    turn: 6,
    chosenId: 'action-17',
    chosenType: 'discardHalf',
    bytes: [42_000, 44_000],
  },
  proposer: {
    count: 3,
    actor: 'p1',
    turn: 5,
    chosenId: 'action-1',
    chosenType: 'domesticTradeAward',
    bytes: [41_000, 43_000],
  },
  responder: {
    count: 14,
    actor: 'p1',
    turn: 5,
    chosenId: 'action-9',
    chosenType: 'domesticTradeBid',
    bytes: [42_000, 44_000],
  },
} as const;

export function loadHttpCorpus() {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/http-corpus.json', import.meta.url), 'utf8')
  );
  const cases = CorpusSchema.parse(raw);
  assert.deepEqual(
    cases.map(({ family }) => family),
    ['action', 'discard', 'proposer', 'responder']
  );
  for (const item of cases) {
    const { family, request } = item;
    const expected = EXPECTED[family];
    assert.equal(request.playerId, expected.actor, `${family}: actor`);
    assert.equal(request.state['turnNumber'], expected.turn, `${family}: turn`);
    assert.equal(request.validActions.length, expected.count, `${family}: candidate floor`);
    assert.equal(request.validActions[0]?.id, 'action-1');
    assert.equal(request.validActions.at(-1)?.id, `action-${expected.count}`);
    const bytes = Buffer.byteLength(JSON.stringify(request));
    assert.ok(
      bytes >= expected.bytes[0] && bytes <= expected.bytes[1],
      `${family}: request size band (${bytes})`
    );
    for (const secret of ['seed', 'effects', 'temporaryStorage', 'progressDecks', 'eventDeck']) {
      assert.equal(Object.hasOwn(request.state, secret), false, `${family}: private ${secret}`);
    }
    const players = z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .parse(request.state['players']);
    assert.deepEqual(Object.keys(players).sort(), ['p1', 'p2', 'p3']);
    let opponents = 0;
    for (const [playerId, player] of Object.entries(players)) {
      if (playerId === request.playerId) continue;
      opponents += 1;
      for (const secret of ['resources', 'commodities', 'progressHand']) {
        assert.equal(Object.hasOwn(player, secret), false, `${family}: opponent ${secret}`);
      }
      assert.equal(typeof player['resourceCount'], 'number');
      assert.equal(typeof player['commodityCount'], 'number');
    }
    assert.equal(opponents, 2);
    const pending = z
      .object({ type: z.string(), actingPlayerId: z.string().nullable() })
      .nullable()
      .parse(request.state['pendingDecision']);
    if (family === 'action') assert.equal(pending, null);
    else {
      assert.equal(
        pending?.type,
        family === 'discard' ? 'discardResources' : 'domesticTradeResponse'
      );
      if (family === 'proposer') assert.equal(pending?.actingPlayerId, request.playerId);
      if (family === 'responder') assert.notEqual(pending?.actingPlayerId, request.playerId);
    }
  }
  return cases;
}

export type HttpCorpusCase = ReturnType<typeof loadHttpCorpus>[number];

export function assertHttpCorpusResponse(item: HttpCorpusCase, raw: unknown): void {
  const response = z
    .object({
      protocolVersion: z.literal(2),
      kind: z.literal('action'),
      actionId: z.string().min(1),
      decisionTrace: z.object({
        candidateCount: z.number().int(),
        top3: z.array(
          z.object({
            type: z.string(),
            score: z.number(),
            extra: z.object({ candidateId: z.string() }),
          })
        ),
      }),
    })
    .parse(raw);
  const candidate = item.request.validActions.find(({ id }) => id === response.actionId);
  assert.ok(candidate, `${item.family}: actionId must belong to supplied candidates`);
  assert.equal(
    response.actionId,
    EXPECTED[item.family].chosenId,
    `${item.family}: literal captured decision`
  );
  assert.equal(candidate.type, EXPECTED[item.family].chosenType);
  // Main scoring reports its policy-filtered pool; the pending traces report
  // all supplied choices. The captured action request has 25 scored choices.
  assert.equal(
    response.decisionTrace.candidateCount,
    item.family === 'action' ? 25 : EXPECTED[item.family].count
  );
  assert.equal(response.decisionTrace.top3.length, item.family === 'responder' ? 5 : 3);
  assert.ok(
    response.decisionTrace.top3.some(({ extra }) => extra.candidateId === response.actionId)
  );
  for (const entry of response.decisionTrace.top3) {
    assert.ok(
      item.request.validActions.some(
        ({ id, type }) => id === entry.extra.candidateId && type === entry.type
      )
    );
  }
}
