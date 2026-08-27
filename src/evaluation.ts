import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BotRequestSchema } from './schemas.js';
import type { BotRequest } from './schemas.js';

export type EvaluationCase = {
  requestFile: string;
  expectedActionId?: string;
  expectedActionType?: string;
  winnerPlayerId?: string;
  request: BotRequest;
};

export function loadEvaluationCorpus(path: string): EvaluationCase[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('evaluation corpus must be a JSON array');
  return raw.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`evaluation case ${index} must be an object`);
    }
    const item = value as Record<string, unknown>;
    if (typeof item.requestFile !== 'string') {
      throw new Error(`evaluation case ${index} needs requestFile`);
    }
    const request = BotRequestSchema.parse(
      JSON.parse(readFileSync(resolve(dirname(path), item.requestFile), 'utf8'))
    );
    return {
      requestFile: item.requestFile,
      ...(typeof item.expectedActionId === 'string'
        ? { expectedActionId: item.expectedActionId }
        : {}),
      ...(typeof item.expectedActionType === 'string'
        ? { expectedActionType: item.expectedActionType }
        : {}),
      ...(typeof item.winnerPlayerId === 'string' ? { winnerPlayerId: item.winnerPlayerId } : {}),
      request,
    };
  });
}
