// Minimal Zod schemas for the BotRequest/BotResponse envelopes. `.loose()`
// keeps unknown fields so additive protocol changes don't break the bot —
// the Vorryn server is the source of truth for nested-field validation.

import { z } from 'zod';

const BotActionCandidateSchema = z
  .object({
    id: z.string().min(1),
    type: z.string(),
  })
  .loose();

const BotActionCandidatesSchema = z
  .array(BotActionCandidateSchema)
  .nonempty()
  .superRefine((actions, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < actions.length; index++) {
      const id = actions[index]?.id;
      if (id === undefined) continue;
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `Duplicate bot action candidate id "${id}"`,
        });
      } else {
        seen.add(id);
      }
    }
  });

const RecentEventSchema = z
  .object({
    sequence: z.number(),
    type: z.string(),
    actingPlayerId: z.string().nullable(),
    turnAfter: z.number().nullable(),
    payload: z.record(z.string(), z.unknown()),
  })
  .loose();

export const BotRequestSchema = z
  .object({
    protocolVersion: z.literal(2),
    gameId: z.string(),
    playerId: z.string(),
    state: z.object({}).loose(),
    validActions: BotActionCandidatesSchema,
    validActionsTruncated: z.boolean(),
    truncatedFamilies: z.array(z.string()),
    diceHistogram: z.record(z.string(), z.number()),
    recentEvents: z.array(RecentEventSchema),
    personality: z.string().nullable().optional(),
  })
  .loose();

export type BotRequest = z.infer<typeof BotRequestSchema>;

export type BotResponse = {
  protocolVersion: 2;
  kind: 'action';
  actionId: string;
  decisionTrace?: Record<string, unknown>;
};
