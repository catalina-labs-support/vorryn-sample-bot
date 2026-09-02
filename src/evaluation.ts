import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { BotRequestSchema } from './schemas.js';
import type { BotRequest } from './schemas.js';

export type EvaluationCase = {
  requestFile: string;
  expectedActionId?: string;
  expectedActionType?: string;
  winnerPlayerId?: string;
  /** Seat the request was addressed to. Present on NDJSON corpora; with
   *  `winnerPlayerId` it is what makes outcome-weighted analysis possible
   *  (did this seat go on to win?) rather than pure imitation. */
  playerId?: string;
  request: BotRequest;
};

/**
 * Loads an evaluation corpus in either supported form:
 *
 *  - `.json`  — an array of `{ requestFile, expectedAction… }` cases, each
 *    pointing at a separate request file. Good for a handful of hand-labeled
 *    scenarios.
 *  - `.ndjson` / `.ndjson.gz` — one decision per line with the request
 *    INLINE, as produced by `fixtures/corpus/self-play.ndjson.gz` and by
 *    `GET /games/:id/bot-requests` on Vorryn. Files concatenate, so you can
 *    append your own games to the bundled corpus.
 *
 * `chosenActionId` on an NDJSON row is the reference policy's own pick, not a
 * ground truth. It is loaded as `expectedActionId` so both forms share one
 * shape — but agreement with it measures similarity to that policy, not
 * strength. See the README's "Measuring whether you're actually strong".
 */
export function loadEvaluationCorpus(path: string): EvaluationCase[] {
  if (path.endsWith('.ndjson') || path.endsWith('.ndjson.gz')) return loadNdjsonCorpus(path);
  return loadJsonCorpus(path);
}

function loadNdjsonCorpus(path: string): EvaluationCase[] {
  const bytes = readFileSync(path);
  const text = path.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) throw new Error(`${path} has no rows`);
  return lines.map((line, index) => {
    const row: unknown = JSON.parse(line);
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new Error(`corpus row ${index} must be an object`);
    }
    const item = row as Record<string, unknown>;
    const request = BotRequestSchema.parse(item.request);
    return {
      requestFile: `${path}#${String(index)}`,
      ...(typeof item.chosenActionId === 'string' ? { expectedActionId: item.chosenActionId } : {}),
      ...(typeof item.chosenActionType === 'string'
        ? { expectedActionType: item.chosenActionType }
        : {}),
      ...(typeof item.winnerUserId === 'string' ? { winnerPlayerId: item.winnerUserId } : {}),
      ...(typeof item.playerId === 'string' ? { playerId: item.playerId } : {}),
      request,
    };
  });
}

function loadJsonCorpus(path: string): EvaluationCase[] {
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
