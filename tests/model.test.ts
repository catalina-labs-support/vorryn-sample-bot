import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpponentBeliefs } from '../src/opponent-beliefs.js';
import { buildPublicStateModel, playerProduction } from '../src/public-state.js';
import { BotRequestSchema } from '../src/schemas.js';
import { deepStrictEqual } from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const request = BotRequestSchema.parse(
  JSON.parse(readFileSync(join(here, '..', 'fixtures', 'play-request-full.json'), 'utf8'))
);
const model = buildPublicStateModel(request);
if (model.players.size !== 3)
  throw new Error(`expected 3 public players, got ${model.players.size}`);
if (model.ownPlayer.id !== request.playerId) throw new Error('model selected the wrong own player');
if (playerProduction(model, request.playerId) <= 0)
  throw new Error('own production was not derived');

const opponentId = [...model.players.keys()].find((id) => id !== request.playerId);
if (opponentId === undefined) throw new Error('fixture needs an opponent');
const withHumans = BotRequestSchema.parse({ ...request, humanPlayerIds: [opponentId] });
const belief = buildOpponentBeliefs(withHumans).get(opponentId);
if (belief === undefined || belief.materialTypes.size === 0)
  throw new Error('public material evidence was not represented');
deepStrictEqual(
  buildOpponentBeliefs(withHumans),
  buildOpponentBeliefs(request),
  'opponent beliefs must ignore human/bot labels'
);

console.log('PASS - typed public model and opponent beliefs derive from redacted state');
