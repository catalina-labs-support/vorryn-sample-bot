// REPLACE THIS FILE with your bot's actual decision logic.
//
// Contract: read the validated BotRequest, return one of the
// candidates' `id` values. Anything else fails the contract and the
// Vorryn server falls back to its first-party bot for the turn.

import type { BotRequest, BotResponse } from './schemas.js';

export function pickAction(req: BotRequest): BotResponse {
  // Trivial strategy: pick the first candidate. Usually `endTurn` (action
  // phase) or `rollDice` (roll phase) — both safe defaults, matching the
  // Vorryn server's own fallback on bot failure.
  const firstAction = req.validActions[0];
  if (firstAction === undefined) {
    throw new Error('BotRequest.validActions must be non-empty');
  }

  return {
    protocolVersion: 1,
    kind: 'action',
    actionId: firstAction.id,
    decisionTrace: {
      strategy: 'first-candidate',
      candidateCount: req.validActions.length,
    },
  };
}
