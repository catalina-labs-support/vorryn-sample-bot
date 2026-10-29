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
// Parent fbda2f5a2 reproduced all 250 historical decisions exactly. The
// independent TypeScript chooser at 6a0083b5e (never Rust or this bundle)
// changes exactly these four requests after funded city defense. Preserve the
// historical oracle and assert each old value before applying its correction.
const fundedDefenseCorrections = new Map([
  [74, { before: 'action-2', after: 'action-5' }],
  [137, { before: 'action-22', after: 'action-3' }],
  [138, { before: 'action-22', after: 'action-3' }],
  [213, { before: 'action-90', after: 'action-4' }],
]);
assert.equal(fundedDefenseCorrections.size, 4);
for (const [index, correction] of fundedDefenseCorrections) {
  assert.equal(reference.cases[index]?.actionId, correction.before);
}
for (const [index, entry] of reference.cases.entries()) {
  assert.equal(entry.index, index);
  const request = requests[index];
  assert.ok(request);
  const response = championPickAction(request);
  assert.equal(
    response.actionId,
    fundedDefenseCorrections.get(index)?.after ?? entry.actionId,
    `independent champion case ${index}`
  );
  assert.ok(request.validActions.some((action) => action.id === response.actionId));
}
console.log(
  'PASS — Rust champion matches 250 independent TypeScript decisions with four funded-defense corrections'
);
