import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotRequestSchema } from '../src/schemas.js';
import { searchActions } from '../src/search.js';

const here = dirname(fileURLToPath(import.meta.url));
const request = BotRequestSchema.parse(
  JSON.parse(readFileSync(join(here, '..', 'fixtures', 'play-request-full.json'), 'utf8'))
);
const startedAt = performance.now();
const ranked = searchActions(request, { deadlineMs: 100, samples: 100, seed: 10 });
const elapsed = performance.now() - startedAt;
if (ranked.length !== request.validActions.length)
  throw new Error('search dropped legal candidates');
if (ranked.some((result) => !request.validActions.includes(result.action))) {
  throw new Error('search invented an action outside validActions');
}
if (elapsed > 1_000) throw new Error(`bounded search took ${elapsed.toFixed(1)}ms`);
console.log(`PASS - bounded search ranked ${ranked.length} actions in ${elapsed.toFixed(1)}ms`);
