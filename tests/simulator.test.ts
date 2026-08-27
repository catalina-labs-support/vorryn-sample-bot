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

console.log('PASS - simulator is deterministic, legal, and prefers development');
