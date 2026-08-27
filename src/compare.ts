import { loadEvaluationCorpus } from './evaluation.js';
import { searchActions } from './search.js';

const corpusPath = process.argv[2] ?? 'fixtures/eval-corpus.json';
const candidateWeight = Number(process.argv[3] ?? 0.32);
const baselineWeight = Number(process.argv[4] ?? 0);
if (!Number.isFinite(candidateWeight) || !Number.isFinite(baselineWeight)) {
  throw new Error('plan weights must be finite numbers');
}
const corpus = loadEvaluationCorpus(corpusPath);
let candidateMatches = 0;
let baselineMatches = 0;
let changed = 0;

for (const [index, item] of corpus.entries()) {
  const common = { seed: index + 1, samples: 250, deadlineMs: 2_000 };
  const candidate = searchActions(item.request, { ...common, planWeight: candidateWeight })[0];
  const baseline = searchActions(item.request, { ...common, planWeight: baselineWeight })[0];
  if (candidate === undefined || baseline === undefined) continue;
  if (candidate.action.id !== baseline.action.id) changed++;
  const expected = item.expectedActionId ?? item.expectedActionType;
  const candidateActual =
    item.expectedActionId === undefined ? candidate.action.type : candidate.action.id;
  const baselineActual =
    item.expectedActionId === undefined ? baseline.action.type : baseline.action.id;
  if (expected === undefined || candidateActual === expected) candidateMatches++;
  if (expected === undefined || baselineActual === expected) baselineMatches++;
}

console.log(
  JSON.stringify(
    {
      cases: corpus.length,
      changed,
      baseline: { planWeight: baselineWeight, matches: baselineMatches },
      candidate: { planWeight: candidateWeight, matches: candidateMatches },
    },
    null,
    2
  )
);
