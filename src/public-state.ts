import type { BotRequest } from './schemas.js';

export type JsonObject = Record<string, unknown>;
export type MaterialInventory = Readonly<Record<string, number>>;

export type PublicPlayer = {
  id: string;
  victoryPoints: number;
  inventory: MaterialInventory;
  progressHand: readonly JsonObject[];
  raw: JsonObject;
};

export type PublicStateModel = {
  request: BotRequest;
  ownPlayer: PublicPlayer;
  players: ReadonlyMap<string, PublicPlayer>;
  board: JsonObject;
  hexes: JsonObject;
  intersections: JsonObject;
  edges: JsonObject;
  victoryTarget: number;
};

const EMPTY_PLAYER: PublicPlayer = {
  id: '',
  victoryPoints: 0,
  inventory: {},
  progressHand: [],
  raw: {},
};

export function buildPublicStateModel(request: BotRequest): PublicStateModel {
  const rawPlayers = objectField(request.state, 'players') ?? {};
  const players = new Map<string, PublicPlayer>();
  for (const [id, value] of Object.entries(rawPlayers)) {
    const raw = asObject(value) ?? {};
    const inventory = {
      ...(numericRecord(objectField(raw, 'resources')) ?? {}),
      ...(numericRecord(objectField(raw, 'commodities')) ?? {}),
    };
    players.set(id, {
      id,
      victoryPoints: numberField(raw, 'victoryPoints') ?? 0,
      inventory,
      progressHand: Array.isArray(raw.progressHand)
        ? raw.progressHand.map(asObject).filter((card): card is JsonObject => card !== undefined)
        : [],
      raw,
    });
  }
  const board = objectField(request.state, 'board') ?? {};
  return {
    request,
    ownPlayer: players.get(request.playerId) ?? { ...EMPTY_PLAYER, id: request.playerId },
    players,
    board,
    hexes: objectField(board, 'hexes') ?? {},
    intersections: objectField(board, 'intersections') ?? {},
    edges: objectField(board, 'edges') ?? {},
    victoryTarget: numberField(request.state, 'victoryPointsTarget') ?? 13,
  };
}

export function publicLeader(model: PublicStateModel): PublicPlayer | undefined {
  return [...model.players.values()]
    .filter((player) => player.id !== model.ownPlayer.id)
    .sort(
      (left, right) => right.victoryPoints - left.victoryPoints || left.id.localeCompare(right.id)
    )[0];
}

export function intersectionProduction(model: PublicStateModel, intersectionId: string): number {
  const intersection = asObject(model.intersections[intersectionId]);
  return stringArray(intersection?.adjacentHexIds).reduce((total, hexId) => {
    const hex = asObject(model.hexes[hexId]);
    const token = numberField(hex, 'numberToken');
    if (token === undefined || token === 7) return total;
    const pips = 6 - Math.abs(7 - token);
    return total + Math.max(0, pips) * (hex?.robberPresent === true ? 0.2 : 1);
  }, 0);
}

export function playerProduction(model: PublicStateModel, playerId: string): number {
  return Object.entries(model.intersections).reduce<number>((total, [intersectionId, value]) => {
    const intersection = asObject(value);
    const building = asObject(intersection?.building);
    if (stringField(building, 'ownerPlayerId') !== playerId) return total;
    const multiplier = stringField(building, 'type') === 'city' ? 2 : 1;
    return total + intersectionProduction(model, intersectionId) * multiplier;
  }, 0);
}

export function adjacentIntersectionIds(model: PublicStateModel, edgeId: string): string[] {
  const edge = asObject(model.edges[edgeId]);
  return [stringField(edge, 'intersectionA'), stringField(edge, 'intersectionB')].filter(
    (id): id is string => id !== undefined
  );
}

export function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

export function objectField(value: JsonObject | undefined, field: string): JsonObject | undefined {
  return asObject(value?.[field]);
}

export function stringField(value: JsonObject | undefined, field: string): string | undefined {
  const item = value?.[field];
  return typeof item === 'string' ? item : undefined;
}

export function numberField(value: JsonObject | undefined, field: string): number | undefined {
  const item = value?.[field];
  return typeof item === 'number' ? item : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function numericRecord(value: JsonObject | undefined): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  );
}
