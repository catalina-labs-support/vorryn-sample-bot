import type { BotRequest } from './schemas.js';
import { asObject, buildPublicStateModel, stringField } from './public-state.js';

export type OpponentBelief = {
  playerId: string;
  materialTypes: ReadonlySet<string>;
  observedNetFlow: Readonly<Record<string, number>>;
  isHuman: boolean | undefined;
  confidence: number;
};

const BUILD_COSTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  buildRoad: { lumber: 1, brick: 1 },
  buildSettlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
  buildCity: { ore: 3, grain: 2 },
  recruitKnight: { wool: 1, ore: 1 },
  activateKnight: { grain: 1 },
};

/** Reconstructs a conservative, public-only estimate from the bounded event window. */
export function buildOpponentBeliefs(req: BotRequest): ReadonlyMap<string, OpponentBelief> {
  const model = buildPublicStateModel(req);
  const humanIds = req.humanPlayerIds === undefined ? undefined : new Set(req.humanPlayerIds);
  const publicTypes = new Set(
    Array.isArray(req.state.opponentMaterialTypes)
      ? req.state.opponentMaterialTypes.filter(
          (material): material is string => typeof material === 'string'
        )
      : []
  );
  const flows = new Map<string, Record<string, number>>();
  for (const event of req.recentEvents) {
    const actor = event.actingPlayerId;
    if (actor === null || actor === req.playerId) continue;
    const action = asObject(event.payload.action);
    const actionType = stringField(action, 'type');
    if (action === undefined || actionType === undefined) continue;
    const flow = flows.get(actor) ?? {};
    for (const [material, count] of Object.entries(BUILD_COSTS[actionType] ?? {})) {
      flow[material] = (flow[material] ?? 0) - count;
    }
    applyTradeFlow(flow, action, actionType);
    flows.set(actor, flow);
  }

  return new Map(
    [...model.players.values()]
      .filter((player) => player.id !== req.playerId)
      .map((player) => {
        const observedNetFlow = flows.get(player.id) ?? {};
        return [
          player.id,
          {
            playerId: player.id,
            materialTypes: new Set([
              ...publicTypes,
              ...Object.entries(observedNetFlow)
                .filter(([, count]) => count > 0)
                .map(([material]) => material),
            ]),
            observedNetFlow,
            isHuman: humanIds?.has(player.id),
            confidence: Math.min(1, req.recentEvents.length / 60),
          },
        ];
      })
  );
}

function applyTradeFlow(
  flow: Record<string, number>,
  action: Record<string, unknown>,
  type: string
) {
  if (type !== 'maritimeTrade' && type !== 'domesticTradeAward') return;
  applyBundle(flow, action.offer, -1);
  applyBundle(flow, action.want, 1);
}

function applyBundle(flow: Record<string, number>, value: unknown, direction: number) {
  const bundle = Array.isArray(value) ? value : [value];
  for (const selection of bundle) {
    const item = asObject(selection);
    const material = stringField(item, 'type');
    const count = typeof item?.count === 'number' ? item.count : 0;
    if (material !== undefined) flow[material] = (flow[material] ?? 0) + count * direction;
  }
}
