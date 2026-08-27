import type { BotActionCandidate, BotRequest } from './schemas.js';

type JsonObject = Record<string, unknown>;
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

/** Samples public uncertainty while evaluating only server-supplied actions. */
export function simulateActions(
  req: BotRequest,
  options: { samples?: number; seed?: number } = {}
): SimulationResult[] {
  const samples = Math.max(
    1,
    Math.floor(options.samples ?? Math.max(24, Math.min(160, 4_000 / req.validActions.length)))
  );
  const random = mulberry32(
    options.seed ?? hashString(`${req.gameId}:${numberField(req.state, 'version') ?? 0}`)
  );
  return req.validActions
    .map((action) => {
      let total = 0;
      let squares = 0;
      for (let sample = 0; sample < samples; sample++) {
        const utility = scoreAction(req, action, random);
        total += utility;
        squares += utility * utility;
      }
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

function scoreAction(req: BotRequest, action: BotActionCandidate, random: () => number): number {
  const type = action.type;
  let score = BUILD_VALUE[type] ?? 0;
  if (type === 'rollDice') return 100;
  if (type === 'resign') return -10_000;
  if (type === 'endTurn') return -4;
  if (type === 'skipRoadBuilding') return -20;
  if (['placeSetupBuilding', 'buildSettlement', 'buildCity'].includes(type))
    score += intersectionValue(req, stringField(action, 'intersectionId'));
  if (type === 'placeSetupRoad' || type === 'buildRoad')
    score += roadValue(req, stringField(action, 'edgeId'));
  if (type === 'chooseRobberHex' || type === 'chaseRobber')
    score += robberValue(req, stringField(action, 'hexId'));
  if (type === 'chooseStealTarget' || type === 'domesticTradePropose')
    score += opponentPressure(req, stringField(action, 'targetPlayerId'));
  if (['maritimeTrade', 'domesticTradePropose', 'domesticTradeBid'].includes(type))
    score += tradeValue(action);
  if (type === 'domesticTradePropose') score += random() * 12 - 7;
  if (type === 'domesticTradeAward') score += 26 + tradeValue(action);
  if (type === 'domesticTradePass' || type === 'domesticTradeCancel') score -= 2;
  if (type === 'playProgressCard') score += progressCardValue(action);
  if (type === 'chooseScienceBonusResource')
    score += materialValue(stringField(action, 'resource'));
  if (type === 'discardHalf') score -= bundleValue(action.cards);
  if (type === 'resolveOptionalCardEffect' && action.skip === true) score -= 4;
  if (type === 'chooseProgressDeck') score += deckValue(stringField(action, 'deck'), req);
  return score + (random() - 0.5) * 0.8;
}

function intersectionValue(req: BotRequest, id: string | undefined): number {
  const board = asObject(req.state.board);
  const intersection = recordAt(board, 'intersections', id);
  const hexes = objectField(board, 'hexes');
  const adjacent = stringArray(intersection?.adjacentHexIds);
  let value = 0;
  for (const hexId of adjacent) {
    const hex = asObject(hexes?.[hexId]);
    const token = numberField(hex, 'numberToken');
    if (token !== undefined) value += 7 - Math.abs(7 - token);
    if (hex?.robberPresent === true) value -= 3;
  }
  const types = adjacent
    .map((hexId) => stringField(asObject(hexes?.[hexId]), 'type'))
    .filter((type): type is string => type !== undefined);
  return value + new Set(types).size * 1.5;
}

function roadValue(req: BotRequest, id: string | undefined): number {
  const edge = recordAt(asObject(req.state.board), 'edges', id);
  return [stringField(edge, 'intersectionA'), stringField(edge, 'intersectionB')].reduce(
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
  return (numberField(recordAt(req.state, 'players', id), 'victoryPoints') ?? 0) * 1.8;
}
function tradeValue(action: BotActionCandidate): number {
  return bundleValue(action.want) - bundleValue(action.offer) * 1.05;
}
function bundleValue(value: unknown): number {
  const selections = Array.isArray(value) ? value : [value];
  return selections.reduce<number>((sum, selection) => {
    if (typeof selection === 'string') return sum + materialValue(selection);
    const item = asObject(selection);
    return sum + materialValue(stringField(item, 'type')) * (numberField(item, 'count') ?? 0);
  }, 0);
}
function progressCardValue(action: BotActionCandidate): number {
  const name =
    `${stringField(action, 'cardName') ?? ''} ${stringField(action, 'instanceId') ?? ''}`.toLowerCase();
  if (action.skip === true) return -8;
  if (name.includes('victory') || name.includes('constitution') || name.includes('printer'))
    return 55;
  if (name.includes('merchantfleet')) return 24 + materialValue(stringField(action, 'chosenType'));
  if (name.includes('roadbuilding') || name.includes('engineer')) return 27;
  return 20;
}
function deckValue(deck: string | undefined, req: BotRequest): number {
  return (
    10 -
    (numberField(recordAt(req.state, 'players', req.playerId), `${deck ?? ''}Level`) ?? 0) * 0.4 +
    (deck === 'science' ? 0.6 : 0)
  );
}
function materialValue(type: string | undefined): number {
  return type === undefined ? 0 : (MATERIAL_VALUE[type] ?? 2.5);
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
