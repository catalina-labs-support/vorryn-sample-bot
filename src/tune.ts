import { loadEvaluationCorpus } from './evaluation.js';
import { searchActions } from './search.js';

const corpusPath = process.argv[2] ?? 'fixtures/eval-corpus.json';
const corpus = loadEvaluationCorpus(corpusPath);
if (corpus.length < 20) {
  console.error(
    `Refusing to tune on ${corpus.length} cases; add at least 20 labeled, representative decisions.`
  );
  process.exit(2);
}
const weights = [0, 0.16, 0.32, 0.48, 0.64];
const scored = weights.map((planWeight) => {
  let matches = 0;
  let margin = 0;
  for (const [index, item] of corpus.entries()) {
    const ranked = searchActions(item.request, {
      seed: index + 1,
      samples: 250,
      deadlineMs: 2_000,
      planWeight,
    });
    const best = ranked[0];
    if (best === undefined) continue;
    const expected = item.expectedActionId ?? item.expectedActionType;
    const actual = item.expectedActionId === undefined ? best.action.type : best.action.id;
    if (expected === undefined || expected === actual) matches++;
    margin += best.combinedUtility - (ranked[1]?.combinedUtility ?? best.combinedUtility);
  }
  return { planWeight, matches, meanMargin: margin / Math.max(1, corpus.length) };
});
scored.sort((a, b) => b.matches - a.matches || b.meanMargin - a.meanMargin);
for (const result of scored) console.log(JSON.stringify(result));
console.log(`Recommended planWeight=${scored[0]?.planWeight ?? 0.32}`);
