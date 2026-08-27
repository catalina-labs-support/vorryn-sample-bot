import type { BotRequest, BotResponse } from './schemas.js';
import { simulateActions } from './simulator.js';

export function pickAction(req: BotRequest): BotResponse {
  const ranked = simulateActions(req);
  const best = ranked[0];
  if (best === undefined) throw new Error('BotRequest.validActions must be non-empty');

  return {
    protocolVersion: 2,
    kind: 'action',
    actionId: best.action.id,
    decisionTrace: {
      strategy: 'public-information-monte-carlo-v1',
      candidateCount: req.validActions.length,
      score: Number(best.meanUtility.toFixed(3)),
      uncertainty: Number(best.uncertainty.toFixed(3)),
      runnerUpGap: Number(
        (best.meanUtility - (ranked[1]?.meanUtility ?? best.meanUtility)).toFixed(3)
      ),
      samplesPerAction: best.samples,
      truncated: req.validActionsTruncated,
    },
  };
}
