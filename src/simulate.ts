import { readFileSync } from 'node:fs';
import { BotRequestSchema } from './schemas.js';
import { searchActions } from './search.js';

const fixturePath = process.argv[2] ?? 'fixtures/play-request-full.json';
const request = BotRequestSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
const results = searchActions(request, { samples: 500, seed: 1, deadlineMs: 2_000 });

console.log(`Ranked ${results.length} legal actions from ${fixturePath}`);
for (const [rank, result] of results.slice(0, 12).entries()) {
  console.log(
    `${String(rank + 1).padStart(2)}. ${result.action.type.padEnd(24)} ` +
      `${result.combinedUtility.toFixed(2).padStart(7)} ` +
      `(now ${result.meanUtility.toFixed(2)}, plan ${result.planValue.toFixed(2)})  ${result.action.id}`
  );
}
