import { readFileSync } from 'node:fs';
import { BotRequestSchema } from './schemas.js';
import { simulateActions } from './simulator.js';

const fixturePath = process.argv[2] ?? 'fixtures/play-request-full.json';
const request = BotRequestSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
const results = simulateActions(request, { samples: 500, seed: 1 });

console.log(`Ranked ${results.length} legal actions from ${fixturePath}`);
for (const [rank, result] of results.slice(0, 12).entries()) {
  console.log(
    `${String(rank + 1).padStart(2)}. ${result.action.type.padEnd(24)} ` +
      `${result.meanUtility.toFixed(2).padStart(7)} +/- ${result.uncertainty.toFixed(2)}  ${result.action.id}`
  );
}
