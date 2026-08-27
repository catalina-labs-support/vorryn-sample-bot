import type { BotActionCandidate, BotRequest } from './schemas.js';
import { simulateActions } from './simulator.js';
import type { SimulationResult } from './simulator.js';
import {
  asObject,
  buildPublicStateModel,
  intersectionProduction,
  numberField,
  stringField,
} from './public-state.js';

export type SearchResult = SimulationResult & { planValue: number; combinedUtility: number };

const PLANS: ReadonlyArray<{
  key: string;
  reward: number;
  cost: Readonly<Record<string, number>>;
}> = [
  { key: 'city', reward: 52, cost: { ore: 3, grain: 2 } },
  { key: 'settlement', reward: 42, cost: { lumber: 1, brick: 1, wool: 1, grain: 1 } },
  { key: 'improvement', reward: 30, cost: { coin: 1, paper: 1, cloth: 1 } },
  { key: 'knight', reward: 22, cost: { wool: 1, ore: 1 } },
  { key: 'road', reward: 10, cost: { lumber: 1, brick: 1 } },
];

/** Deadline-bounded abstract lookahead over inventory, production, and next plans. */
export function searchActions(
  req: BotRequest,
  options: { deadlineMs?: number; samples?: number; seed?: number; planWeight?: number } = {}
): SearchResult[] {
  const startedAt = Date.now();
  const deadlineMs = Math.max(1, options.deadlineMs ?? 250);
  const planWeight = options.planWeight ?? 0.32;
  const base = simulateActions(req, {
    ...(options.samples === undefined ? {} : { samples: options.samples }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  });
  const ranked: SearchResult[] = [];
  for (const result of base) {
    if (Date.now() - startedAt >= deadlineMs) {
      ranked.push({ ...result, planValue: 0, combinedUtility: result.meanUtility });
      continue;
    }
    const planValue = projectedPlanValue(req, result.action);
    ranked.push({
      ...result,
      planValue,
      combinedUtility: result.meanUtility + planValue * planWeight,
    });
  }
  return ranked.sort(
    (left, right) =>
      right.combinedUtility - left.combinedUtility || left.action.id.localeCompare(right.action.id)
  );
}

function projectedPlanValue(req: BotRequest, action: BotActionCandidate): number {
  const model = buildPublicStateModel(req);
  const inventory = { ...model.ownPlayer.inventory };
  applyActionMaterials(inventory, action);
  const plan = PLANS.reduce((best, candidate) => {
    const deficit = Object.entries(candidate.cost).reduce(
      (sum, [material, needed]) => sum + Math.max(0, needed - (inventory[material] ?? 0)),
      0
    );
    const value = candidate.reward / (1 + deficit);
    return value > best ? value : best;
  }, 0);
  const intersectionId = stringField(action, 'intersectionId');
  const production =
    intersectionId === undefined ? 0 : intersectionProduction(model, intersectionId) * 0.45;
  return plan + production;
}

function applyActionMaterials(inventory: Record<string, number>, action: BotActionCandidate) {
  const costs: Readonly<Record<string, number>> =
    action.type === 'buildRoad'
      ? { lumber: 1, brick: 1 }
      : action.type === 'buildSettlement'
        ? { lumber: 1, brick: 1, wool: 1, grain: 1 }
        : action.type === 'buildCity'
          ? { ore: 3, grain: 2 }
          : action.type === 'recruitKnight'
            ? { wool: 1, ore: 1 }
            : action.type === 'activateKnight'
              ? { grain: 1 }
              : {};
  for (const [material, count] of Object.entries(costs)) {
    inventory[material] = Math.max(0, (inventory[material] ?? 0) - count);
  }
  if (action.type === 'maritimeTrade' || action.type === 'domesticTradePropose') {
    applyBundle(inventory, action.offer, -1);
    applyBundle(inventory, action.want, 1);
  } else if (action.type === 'domesticTradeBid') {
    applyBundle(inventory, action.offer, 1);
    applyBundle(inventory, action.want, -1);
  }
}

function applyBundle(inventory: Record<string, number>, value: unknown, direction: number) {
  const bundle = Array.isArray(value) ? value : [value];
  for (const selection of bundle) {
    const item = asObject(selection);
    const material = stringField(item, 'type');
    const count = numberField(item, 'count') ?? 0;
    if (material !== undefined) {
      inventory[material] = Math.max(0, (inventory[material] ?? 0) + count * direction);
    }
  }
}
