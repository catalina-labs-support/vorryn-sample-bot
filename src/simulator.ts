import type { BotActionCandidate, BotRequest } from './schemas.js';
import {
  adjacentIntersectionIds,
  buildPublicStateModel,
  intersectionProduction,
} from './public-state.js';
import type { PublicStateModel } from './public-state.js';
import { buildOpponentBeliefs } from './opponent-beliefs.js';
import type { OpponentBelief } from './opponent-beliefs.js';

type JsonObject = Record<string, unknown>;
type SampledWorld = { tradeAcceptance: number; futureVariance: number };
export type SimulationResult = {
  action: BotActionCandidate;
  meanUtility: number;
  uncertainty: number;
  samples: number;
};

const BUILD_VALUE: Readonly<Record<string, number>> = {
  buildCity: 52,
  buildSettlement: 42,
  improveCity: 30,
  placeSetupBuilding: 28,
  recruitKnight: 22,
  promoteKnight: 20,
  activateKnight: 14,
  buildCityWall: 13,
  buildRoad: 10,
  placeSetupRoad: 9,
};
const MATERIAL_VALUE: Readonly<Record<string, number>> = {
  ore: 3.2,
  grain: 3,
  coin: 2.9,
  paper: 2.9,
  cloth: 2.9,
  wool: 2.4,
  brick: 2.2,
  lumber: 2.2,
};
const DEVELOPMENT_COSTS: ReadonlyArray<Readonly<Record<string, number>>> = [
  { lumber: 1, brick: 1 },
  { lumber: 1, brick: 1, wool: 1, grain: 1 },
  { ore: 3, grain: 2 },
  { wool: 1, ore: 1 },
  { coin: 1, paper: 1, cloth: 1 },
];
const MODEL_CACHE = new WeakMap<BotRequest, PublicStateModel>();
const BELIEF_CACHE = new WeakMap<BotRequest, ReadonlyMap<string, OpponentBelief>>();

/** Samples public uncertainty while evaluating only server-supplied actions. */
export function simulateActions(
  req: BotRequest,
  options: { samples?: number; seed?: number } = {}
): SimulationResult[] {
  modelFor(req);
  const samples = Math.max(
    1,
    Math.floor(options.samples ?? Math.max(24, Math.min(160, 4_000 / req.validActions.length)))
  );
  const random = mulberry32(
    options.seed ?? hashString(`${req.gameId}:${numberField(req.state, 'version') ?? 0}`)
  );
  const totals = req.validActions.map(() => ({ total: 0, squares: 0 }));
  for (let sample = 0; sample < samples; sample++) {
    const world: SampledWorld = {
      tradeAcceptance: random(),
      futureVariance: (random() - 0.5) * 0.8,
    };
    for (const [index, action] of req.validActions.entries()) {
      const utility = scoreAction(req, action, world);
      const accumulator = totals[index];
      if (accumulator === undefined) continue;
      accumulator.total += utility;
      accumulator.squares += utility * utility;
    }
  }
  return req.validActions
    .map((action, index) => {
      const { total, squares } = totals[index] ?? { total: 0, squares: 0 };
      const meanUtility = total / samples;
      return {
        action,
        meanUtility,
        uncertainty: Math.sqrt(Math.max(0, squares / samples - meanUtility ** 2)),
        samples,
      };
    })
    .sort((a, b) => b.meanUtility - a.meanUtility || a.action.id.localeCompare(b.action.id));
}

function scoreAction(req: BotRequest, action: BotActionCandidate, world: SampledWorld): number {
  const type = action.type;
  let score = BUILD_VALUE[type] ?? 0;
  if (type === 'rollDice') return 100;
  if (type === 'resign') return -10_000;
  if (type === 'endTurn') return -4;
  if (type === 'skipRoadBuilding') return -20;
  if (['placeSetupBuilding', 'buildSettlement', 'buildCity'].includes(type))
    score +=
      intersectionValue(req, stringField(action, 'intersectionId')) +
      immediateVictoryBonus(req, type);
  if (type === 'placeSetupRoad' || type === 'buildRoad')
    score += roadValue(req, stringField(action, 'edgeId'));
  if (type === 'chooseRobberHex' || type === 'chaseRobber')
    score += robberValue(req, stringField(action, 'hexId'));
  if (type === 'chooseStealTarget' || type === 'domesticTradePropose')
    score +=
      opponentPressure(req, stringField(action, 'targetPlayerId')) +
      stealMaterialPotential(req, stringField(action, 'targetPlayerId'));
  if (type === 'maritimeTrade') score += tradeValue(req, action);
  if (type === 'domesticTradeBid') score += responderTradeValue(req, action);
  if (type === 'domesticTradePropose')
    score += simulateTradeProposal(req, action, world.tradeAcceptance);
  if (type === 'domesticTradeAward') score += 26 + tradeValue(req, action);
  if (type === 'domesticTradeCancel') score -= 2;
  if (type === 'playProgressCard') score += progressCardValue(req, action);
  if (type === 'chooseScienceBonusResource')
    score += materialValue(req, stringField(action, 'resource'));
  if (type === 'discardHalf') score -= bundleValue(req, action.cards);
  if (type === 'discardProgress') score -= discardedProgressValue(req, action);
  if (type === 'resolveOptionalCardEffect') {
    if (action.skip === true) score -= 4;
    score += opponentPressure(req, stringField(action, 'targetPlayerId'));
    score += intersectionValue(req, stringField(action, 'intersectionId')) * 0.35;
  }
  if (type === 'choosePillageCity') score += targetBuildingValue(req, action);
  if (type === 'chooseMetropolisCity')
    score += intersectionValue(req, stringField(action, 'intersectionId')) * 0.2;
  if (type === 'chooseProgressDeck') score += deckValue(stringField(action, 'deck'), req);
  if (type === 'improveCity') score += improvementValue(req, stringField(action, 'track'));
  if (type === 'moveKnight' || type === 'displaceKnight')
    score += intersectionValue(req, stringField(action, 'intersectionId')) * 0.45;
  if (type === 'setStandingWant') score += tradeValue(req, action) * 0.45 + 1;
  if (type === 'clearStandingWant') score -= 1;
  if (type === 'executeStandingWant') score += standingWantValue(req, action);
  return score + world.futureVariance;
}

function intersectionValue(req: BotRequest, id: string | undefined): number {
  if (id === undefined) return 0;
  const model = modelFor(req);
  const board = asObject(req.state.board);
  const intersection = recordAt(board, 'intersections', id);
  const hexes = objectField(board, 'hexes');
  const adjacent = stringArray(intersection?.adjacentHexIds);
  let value = intersectionProduction(model, id);
  for (const hexId of adjacent) {
    const hex = asObject(hexes?.[hexId]);
    if (hex?.robberPresent === true) value -= 1;
  }
  const types = adjacent
    .map((hexId) => stringField(asObject(hexes?.[hexId]), 'type'))
    .filter((type): type is string => type !== undefined);
  return value + new Set(types).size * 1.5;
}

function roadValue(req: BotRequest, id: string | undefined): number {
  if (id === undefined) return 0;
  return adjacentIntersectionIds(modelFor(req), id).reduce(
    (sum, endpoint) => sum + intersectionValue(req, endpoint) * 0.18,
    0
  );
}

function robberValue(req: BotRequest, id: string | undefined): number {
  const board = asObject(req.state.board);
  const hex = recordAt(board, 'hexes', id);
  const token = numberField(hex, 'numberToken') ?? 7;
  let score = 7 - Math.abs(7 - token);
  for (const value of Object.values(objectField(board, 'intersections') ?? {})) {
    const intersection = asObject(value);
    if (!stringArray(intersection?.adjacentHexIds).includes(id ?? '')) continue;
    const building = asObject(intersection?.building);
    if (building?.ownerPlayerId === req.playerId) score -= 12;
    else if (building !== undefined) score += 5;
  }
  return score;
}

function opponentPressure(req: BotRequest, id: string | undefined): number {
  return (id === undefined ? 0 : (modelFor(req).players.get(id)?.victoryPoints ?? 0)) * 1.8;
}
function stealMaterialPotential(req: BotRequest, id: string | undefined): number {
  if (id === undefined) return 0;
  const belief = beliefsFor(req).get(id);
  if (belief === undefined) return 0;
  return [...belief.materialTypes].reduce(
    (best, material) => Math.max(best, materialValue(req, material)),
    0
  );
}
function tradeValue(req: BotRequest, action: BotActionCandidate): number {
  return bundleValue(req, action.want) - bundleValue(req, action.offer) * 1.05;
}
function responderTradeValue(req: BotRequest, action: BotActionCandidate): number {
  // All domestic-trade payloads stay in proposer perspective. A responder
  // receives `offer` and gives `want`, which is intentionally the inverse of
  // proposal/award valuation above.
  return bundleValue(req, action.offer) - bundleValue(req, action.want) * 1.05;
}
function simulateTradeProposal(
  req: BotRequest,
  action: BotActionCandidate,
  acceptanceSample: number
): number {
  const strategicSurplus = tradeValue(req, action);
  const tableSurplus = baseBundleValue(action.offer) - baseBundleValue(action.want);
  const targetId = stringField(action, 'targetPlayerId');
  const humanAdjustment =
    targetId === undefined || beliefsFor(req).get(targetId)?.isHuman !== true ? 0 : 0.35;
  const acceptanceProbability = 1 / (1 + Math.exp(-(tableSurplus - 0.4 - humanAdjustment)));
  return acceptanceSample < acceptanceProbability ? strategicSurplus + 4 : -1.25;
}
function bundleValue(req: BotRequest, value: unknown): number {
  const selections = Array.isArray(value) ? value : [value];
  return selections.reduce<number>((sum, selection) => {
    if (typeof selection === 'string') return sum + materialValue(req, selection);
    const item = asObject(selection);
    return sum + materialValue(req, stringField(item, 'type')) * (numberField(item, 'count') ?? 0);
  }, 0);
}
function baseBundleValue(value: unknown): number {
  const selections = Array.isArray(value) ? value : [value];
  return selections.reduce<number>((sum, selection) => {
    if (typeof selection === 'string') return sum + baseMaterialValue(selection);
    const item = asObject(selection);
    return sum + baseMaterialValue(stringField(item, 'type')) * (numberField(item, 'count') ?? 0);
  }, 0);
}
function progressCardValue(req: BotRequest, action: BotActionCandidate): number {
  const name =
    `${stringField(action, 'cardName') ?? ''} ${stringField(action, 'instanceId') ?? ''}`.toLowerCase();
  if (action.skip === true) return -8;
  if (name.includes('victory') || name.includes('constitution') || name.includes('printer'))
    return 55;
  if (name.includes('merchantfleet'))
    return 24 + materialValue(req, stringField(action, 'chosenType'));
  if (name.includes('roadbuilding') || name.includes('engineer')) return 27;
  return 20;
}
function discardedProgressValue(req: BotRequest, action: BotActionCandidate): number {
  const discardedIds = Array.isArray(action.instanceIds)
    ? action.instanceIds.filter((id): id is string => typeof id === 'string')
    : [];
  const hand = modelFor(req).ownPlayer.progressHand;
  return discardedIds.reduce((sum, instanceId) => {
    const card = hand.map(asObject).find((item) => stringField(item, 'instanceId') === instanceId);
    return sum + heldProgressCardValue(stringField(card, 'cardId'));
  }, 0);
}
function heldProgressCardValue(cardId: string | undefined): number {
  const id = cardId?.toLowerCase() ?? '';
  if (id.includes('constitution') || id.includes('printer')) return 100;
  if (id.includes('deserter') || id.includes('intrigue') || id.includes('bishop')) return 24;
  if (id.includes('roadbuilding') || id.includes('engineer') || id.includes('medicine')) return 22;
  if (id.includes('merchant') || id.includes('commercialharbor')) return 18;
  return 12;
}
function targetBuildingValue(req: BotRequest, action: BotActionCandidate): number {
  const intersection = recordAt(
    asObject(req.state.board),
    'intersections',
    stringField(action, 'intersectionId')
  );
  const ownerId = stringField(asObject(intersection?.building), 'ownerPlayerId');
  return (
    opponentPressure(req, ownerId) + intersectionValue(req, stringField(action, 'intersectionId'))
  );
}
function deckValue(deck: string | undefined, req: BotRequest): number {
  return (
    10 -
    (numberField(recordAt(req.state, 'players', req.playerId), `${deck ?? ''}Level`) ?? 0) * 0.4 +
    (deck === 'science' ? 0.6 : 0)
  );
}
function improvementValue(req: BotRequest, track: string | undefined): number {
  if (track === undefined) return 0;
  const player = modelFor(req).ownPlayer;
  const level = numberField(player.raw, `${track}Level`) ?? 0;
  const leaderLevel = [...modelFor(req).players.values()].reduce(
    (highest, opponent) =>
      opponent.id === player.id
        ? highest
        : Math.max(highest, numberField(opponent.raw, `${track}Level`) ?? 0),
    0
  );
  return 7 + Math.max(0, leaderLevel - level) * 2 + (level === 3 ? 12 : 0);
}
function immediateVictoryBonus(req: BotRequest, type: string): number {
  if (type !== 'buildSettlement' && type !== 'buildCity') return 0;
  const model = modelFor(req);
  return model.ownPlayer.victoryPoints + 1 >= model.victoryTarget ? 10_000 : 0;
}
function standingWantValue(req: BotRequest, action: BotActionCandidate): number {
  const targetId = stringField(action, 'targetPlayerId');
  if (targetId === undefined) return 0;
  const standingWant = asObject(modelFor(req).players.get(targetId)?.raw.standingWant);
  if (standingWant === undefined) return 0;
  return bundleValue(req, standingWant.offer) - bundleValue(req, standingWant.want) * 1.05;
}
function materialValue(req: BotRequest, type: string | undefined): number {
  if (type === undefined) return 0;
  const base = baseMaterialValue(type);
  const inventory = modelFor(req).ownPlayer.inventory;
  const held = typeof inventory[type] === 'number' ? inventory[type] : 0;
  const closestGoal = DEVELOPMENT_COSTS.reduce((best, cost) => {
    const totalDeficit = Object.entries(cost).reduce(
      (sum, [material, needed]) =>
        sum +
        Math.max(0, needed - (typeof inventory[material] === 'number' ? inventory[material] : 0)),
      0
    );
    const needsType = Math.max(0, (cost[type] ?? 0) - held);
    return needsType > 0 && totalDeficit < best ? totalDeficit : best;
  }, Number.POSITIVE_INFINITY);
  return base + (Number.isFinite(closestGoal) ? 5 / Math.max(1, closestGoal) : 0) - held * 0.15;
}
function baseMaterialValue(type: string | undefined): number {
  return type === undefined ? 0 : (MATERIAL_VALUE[type] ?? 2.5);
}
function modelFor(req: BotRequest): PublicStateModel {
  const cached = MODEL_CACHE.get(req);
  if (cached !== undefined) return cached;
  const model = buildPublicStateModel(req);
  MODEL_CACHE.set(req, model);
  return model;
}
function beliefsFor(req: BotRequest): ReadonlyMap<string, OpponentBelief> {
  const cached = BELIEF_CACHE.get(req);
  if (cached !== undefined) return cached;
  const beliefs = buildOpponentBeliefs(req);
  BELIEF_CACHE.set(req, beliefs);
  return beliefs;
}
function recordAt(
  parent: JsonObject | undefined,
  field: string,
  key: string | undefined
): JsonObject | undefined {
  return key === undefined ? undefined : asObject(objectField(parent, field)?.[key]);
}
function objectField(value: JsonObject | undefined, field: string): JsonObject | undefined {
  return asObject(value?.[field]);
}
function stringField(value: JsonObject | undefined, field: string): string | undefined {
  const item = value?.[field];
  return typeof item === 'string' ? item : undefined;
}
function numberField(value: JsonObject | undefined, field: string): number | undefined {
  const item = value?.[field];
  return typeof item === 'number' ? item : undefined;
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}
function hashString(value: string): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
