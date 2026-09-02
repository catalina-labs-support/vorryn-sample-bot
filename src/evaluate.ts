// Offline evaluation over a decision corpus.
//
//   pnpm evaluate                                   # 2-case labeled smoke set
//   pnpm evaluate fixtures/corpus/self-play.ndjson.gz   # 250 real decisions
//   pnpm evaluate <corpus> --limit 50 --strict
//
// WHAT THIS MEASURES: how often your strategy picks the same action as the
// reference policy that generated the corpus. That is a regression signal —
// "did my change move decisions, and where?" — NOT a measure of strength.
// Agreement with a policy is maximized by copying it, and Vorryn's own
// research found that imitating a strong player's decisions can make a bot
// WORSE. Read the README's "Measuring whether you're actually strong" before
// tuning on this number.
//
// The one outcome-grounded slice available offline is the won/lost split
// printed below: agreement measured only on decisions from games the acting
// seat went on to win. It is still weak evidence (the seat won for many
// reasons), but unlike raw agreement it is at least correlated with outcome.

import { loadEvaluationCorpus } from './evaluation.js';
import { searchActions } from './search.js';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const corpusPath = positional[0] ?? 'fixtures/eval-corpus.json';
const limitFlag = args.indexOf('--limit');
const limit = limitFlag >= 0 ? Number(args[limitFlag + 1] ?? '0') : 0;
// A hand-labeled JSON corpus is a pinning test: every case is supposed to
// match, so a miss is a failure. A real-play NDJSON corpus never reaches 100%
// agreement, and exiting 1 on that would be a gate that always fires.
const strict = args.includes('--strict') || corpusPath.endsWith('.json');

const corpus = loadEvaluationCorpus(corpusPath);
const cases = limit > 0 ? corpus.slice(0, limit) : corpus;

let matched = 0;
let expectations = 0;
let totalMs = 0;
let wonCases = 0;
let wonMatched = 0;
const missesByType = new Map<string, number>();

for (const [index, item] of cases.entries()) {
  const startedAt = performance.now();
  const best = searchActions(item.request, { seed: index + 1, samples: 250, deadlineMs: 2_000 })[0];
  totalMs += performance.now() - startedAt;
  if (best === undefined) throw new Error(`${item.requestFile}: search returned no action`);

  const expected = item.expectedActionId ?? item.expectedActionType;
  if (expected === undefined) continue;
  const actual = item.expectedActionId === undefined ? best.action.type : best.action.id;
  const pass = expected === actual;
  expectations++;
  if (pass) matched++;
  else missesByType.set(best.action.type, (missesByType.get(best.action.type) ?? 0) + 1);

  // Outcome slice: decisions taken by the seat that ultimately won.
  if (item.playerId !== undefined && item.winnerPlayerId === item.playerId) {
    wonCases++;
    if (pass) wonMatched++;
  }

  if (cases.length <= 20 || !pass) {
    console.log(
      `${pass ? 'PASS' : 'MISS'} ${item.requestFile}: ${best.action.type} (${best.action.id})`
    );
  }
}

const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);

console.log(
  `\nAgreement ${matched}/${expectations} (${pct(matched, expectations)}) over ${String(
    cases.length
  )} decisions; mean ${(totalMs / Math.max(1, cases.length)).toFixed(1)}ms/decision`
);
if (wonCases > 0) {
  console.log(
    `  on decisions by the eventual winner: ${wonMatched}/${wonCases} (${pct(wonMatched, wonCases)})`
  );
}
if (missesByType.size > 0) {
  const top = [...missesByType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(
    `  your picks when you disagreed: ${top.map(([t, n]) => `${t}×${String(n)}`).join(', ')}`
  );
}
console.log(
  'Agreement is a regression signal, not strength. See README § Measuring whether you’re actually strong.'
);

if (strict && matched !== expectations) process.exitCode = 1;
