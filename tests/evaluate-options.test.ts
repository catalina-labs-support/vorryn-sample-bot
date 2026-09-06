import assert from 'node:assert/strict';
import { parseEvaluateOptions } from '../src/evaluate-options.js';

assert.deepEqual(parseEvaluateOptions(['--limit', '40']), {
  corpusPath: 'fixtures/eval-corpus.json',
  limit: 40,
  strict: true,
});
for (const args of [
  ['--limit', '40', 'real.ndjson'],
  ['real.ndjson', '--limit', '40'],
]) {
  assert.deepEqual(parseEvaluateOptions(args), {
    corpusPath: 'real.ndjson',
    limit: 40,
    strict: false,
  });
}
assert.equal(parseEvaluateOptions(['real.ndjson', '--strict']).strict, true);
for (const value of ['', '0', '-1', 'NaN', '1.5', 'Infinity', '9007199254740992']) {
  assert.throws(() => parseEvaluateOptions(['--limit', value]), /positive integer/);
}
assert.throws(() => parseEvaluateOptions(['--limit']), /positive integer/);
assert.throws(() => parseEvaluateOptions(['--unknown']), /Unknown option/);
assert.throws(() => parseEvaluateOptions(['one', 'two']), /one corpus path/);
console.log('evaluate options passed');
