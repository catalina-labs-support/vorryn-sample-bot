import { loadEvaluationCorpus } from './evaluation.js';
import { searchActions } from './search.js';

const corpusPath = process.argv[2] ?? 'fixtures/eval-corpus.json';
const corpus = loadEvaluationCorpus(corpusPath);
let matched = 0;
let totalMs = 0;

for (const [index, item] of corpus.entries()) {
  const startedAt = performance.now();
  const best = searchActions(item.request, { seed: index + 1, samples: 250, deadlineMs: 2_000 })[0];
  totalMs += performance.now() - startedAt;
  if (best === undefined) throw new Error(`${item.requestFile}: search returned no action`);
  const expected = item.expectedActionId ?? item.expectedActionType;
  const actual = item.expectedActionId === undefined ? best.action.type : best.action.id;
  const pass = expected === undefined || expected === actual;
  if (pass) matched++;
  console.log(
    `${pass ? 'PASS' : 'MISS'} ${item.requestFile}: ${best.action.type} (${best.action.id})`
  );
}

console.log(
  `Matched ${matched}/${corpus.length}; mean decision ${(totalMs / Math.max(1, corpus.length)).toFixed(2)}ms`
);
if (matched !== corpus.length) process.exitCode = 1;
