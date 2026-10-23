import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { championPickAction } from '../src/champion.js';
import { BotRequestSchema } from '../src/schemas.js';

// Frozen BEFORE retiring the TS champion: expected decisions are never emitted by Rust.
const reference = z
  .object({
    sourceCommit: z.literal('8e94ad8285cb7de0c5f1aadde19bff41c4fb381e'),
    sourcePath: z.literal('examples/sample-bot/src/champion.js'),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    corpusSha256: z.string().regex(/^[a-f0-9]{64}$/),
    cases: z.array(z.object({ index: z.number().int().nonnegative(), actionId: z.string() })),
  })
  .parse(
    JSON.parse(
      readFileSync(new URL('../fixtures/champion-reference.json', import.meta.url), 'utf8')
    )
  );
const corpus = readFileSync(new URL('../fixtures/corpus/self-play.ndjson.gz', import.meta.url));
assert.equal(createHash('sha256').update(corpus).digest('hex'), reference.corpusSha256);
const requests = gunzipSync(corpus)
  .toString()
  .trim()
  .split('\n')
  .map((line) => z.object({ request: BotRequestSchema }).parse(JSON.parse(line)).request);
assert.equal(requests.length, 250);
assert.equal(reference.cases.length, 250);
for (const [index, entry] of reference.cases.entries()) {
  assert.equal(entry.index, index);
  const request = requests[index];
  assert.ok(request);
  const response = championPickAction(request);
  assert.equal(response.actionId, entry.actionId, `independent champion case ${index}`);
  assert.ok(request.validActions.some((action) => action.id === response.actionId));
}
console.log('PASS — Rust champion preserves all 250 frozen TypeScript decisions');
