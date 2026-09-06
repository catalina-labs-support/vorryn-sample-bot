export function parseEvaluateOptions(args: readonly string[]): {
  corpusPath: string;
  limit: number;
  strict: boolean;
} {
  let corpusPath: string | undefined;
  let limit = 0;
  let strict = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--strict') strict = true;
    else if (arg === '--limit') {
      const value = args[++index];
      if (
        value === undefined ||
        !/^[1-9]\d*$/.test(value) ||
        !Number.isSafeInteger(Number(value))
      ) {
        throw new Error('--limit requires a positive integer');
      }
      limit = Number(value);
    } else if (arg !== undefined) {
      if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
      if (corpusPath !== undefined) throw new Error('Expected one corpus path');
      corpusPath = arg;
    }
  }
  corpusPath ??= 'fixtures/eval-corpus.json';
  return { corpusPath, limit, strict: strict || corpusPath.endsWith('.json') };
}
