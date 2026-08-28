import type { BotRequest, BotResponse } from './schemas.js';
import { championPickAction } from './champion.js';
import { searchActions } from './search.js';

export function pickAction(req: BotRequest): BotResponse {
  try {
    const response = championPickAction(req);
    if (req.validActions.some((action) => action.id === response.actionId)) return response;
  } catch {
    // Keep the service available if a future additive protocol field reaches
    // the bundled policy before the mirror is regenerated. The public-only
    // evaluator below is deterministic and always selects a supplied id.
  }

  const ranked = searchActions(req);
  const best = ranked[0];
  if (best === undefined) throw new Error('BotRequest.validActions must be non-empty');

  return {
    protocolVersion: 2,
    kind: 'action',
    actionId: best.action.id,
    decisionTrace: {
      strategy: 'public-information-monte-carlo-fallback-v1',
      candidateCount: req.validActions.length,
      score: Number(best.meanUtility.toFixed(3)),
      combinedScore: Number(best.combinedUtility.toFixed(3)),
      planValue: Number(best.planValue.toFixed(3)),
      uncertainty: Number(best.uncertainty.toFixed(3)),
      runnerUpGap: Number(
        (best.meanUtility - (ranked[1]?.meanUtility ?? best.meanUtility)).toFixed(3)
      ),
      samplesPerAction: best.samples,
      truncated: req.validActionsTruncated,
    },
  };
}
