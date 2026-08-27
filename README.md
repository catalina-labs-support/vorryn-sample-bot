# vorryn-sample-bot

**Build an AI that plays Vorryn — and set it loose against your friends.**

A Vorryn bot is one small HTTP service. On its turn, Vorryn sends it the
game state and a list of moves that are _already legal_; your bot picks
one and sends back its `id`. That's the entire contract. You can have a
working opponent seated at a real table this afternoon — then spend as
long as you like making it ruthless.

This repo is a complete, deployable starter in TypeScript: a Fastify
handler, schema validation, a test suite, and the full protocol docs
([external-bot guide](docs/EXTERNAL_BOT_GUIDE.md),
[protocol reference](docs/BOT_PROTOCOL.md),
[JSON schema](docs/bot-protocol.schema.json),
[complete rules reference](docs/RULES_REFERENCE.md) — every cost,
card, and forced decision, so you never need to have played the game).
The production strategy is a generated, standalone bundle of Vorryn's validated
champion decision graph: specialized forced-decision resolvers, 25+ scoring
rules, opponent beliefs, same-turn win planning, and bounded lookahead. It uses
only the redacted request and server-supplied legal candidates; it has no
private-server or engine dependency at runtime and never invents action
payloads. When human seats are present, it automatically applies the validated
human-table profile at zero deliberate decision noise.

The readable public-information simulator remains as a deterministic fallback
and experimentation surface. It is intentionally not the competitive selector.

## Why build one?

- **It's genuinely small.** One endpoint, one function. Every candidate
  Vorryn offers has already been validated, so even a one-line bot can
  never make an illegal play or stall a game.
- **Start trivial, grow without limit.** Ship a random picker today;
  evolve into a greedy heuristic, one-ply lookahead, or full Monte Carlo
  search once you're hooked. The first-party bot is 25+ scoring rules —
  you can absolutely beat it.
- **Any language.** The TypeScript starter is here, but the wire format
  is a documented JSON schema — generate a typed client in Go, Rust,
  Python, or C# and skip straight to strategy.
- **Play for real.** Register it once and invite it to games against
  friends. Watch it win (or lose gloriously), then tune.

Fork the repo, replace `pickAction`, deploy. Let's field a champion.

## What's in here

| File                              | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `src/app.ts`                      | Fastify handler: bearer-auth check, schema parse, `pickAction` dispatch. |
| `src/index.ts`                    | Process entrypoint: env setup and HTTP listen.                           |
| `src/strategy.ts`                 | The decision function and compact decision trace.                        |
| `src/champion.js`                 | Generated standalone competitive policy used in production.              |
| `src/public-state.ts`             | Typed, defensive projection of the redacted public game state.           |
| `src/opponent-beliefs.ts`         | Public-event material flow and human-seat belief model.                  |
| `src/simulator.ts`                | Seedable public-information action simulator and evaluator.              |
| `src/search.ts`                   | Deadline-bounded lookahead over inventory, production, and plans.        |
| `src/simulate.ts`                 | Offline CLI for ranking actions in captured requests.                    |
| `src/evaluate.ts` / `src/tune.ts` | Corpus evaluation and guarded parameter sweep tools.                     |
| `src/schemas.ts`                  | Zod parsers for the request/response envelopes.                          |
| `fixtures/play-request.json`      | A small hand-readable `BotRequest` for local testing.                    |
| `fixtures/play-request-full.json` | A full-size `BotRequest` captured from a real self-play game.            |
| `tests/contract.test.ts`          | Contract tests that POST both fixtures to `/play` and assert a 200.      |
| `Dockerfile`                      | Production Node image with a `/health` container check.                  |

## Setup

Requires Node 22+ and pnpm.

```bash
pnpm install
cp .env.example .env
# Edit .env — set BOT_BEARER to a random string of 32+ chars (`openssl rand -base64 32`).
pnpm dev
```

The dev server listens on `http://localhost:3001` and reloads on save.

## Run the tests

```bash
pnpm test
```

Inspect the simulator's ranking of the realistic fixture:

```bash
pnpm simulate
# Or rank a request captured from your own bot logs:
pnpm simulate path/to/play-request.json
```

The simulator is seedable, so its unit tests and offline comparisons are
repeatable. Every candidate is evaluated against the same sampled worlds, so
reordering `validActions` cannot change its score. Tune the weights in
`src/simulator.ts`, collect completed-game requests, and compare one change at
a time over the same corpus.

Run the bundled smoke corpus, or point the evaluator at your own corpus file:

```bash
pnpm evaluate
pnpm evaluate path/to/eval-corpus.json
pnpm compare path/to/eval-corpus.json 0.32 0
pnpm tune path/to/eval-corpus.json
```

An evaluation corpus is a JSON array of cases with `requestFile` and either
`expectedActionId` or `expectedActionType`; it may also record
`winnerPlayerId` for downstream outcome analysis. Paths are relative to the
corpus file. The tuning command refuses to optimize fewer than 20 labeled
decisions—smoke fixtures prove plumbing, not playing strength. Use completed
games, fixed holdouts, and paired comparisons before adopting a weight change.

The contract tests inject both fixtures through the Fastify handler with the
expected bearer header and assert each response is
`{ protocolVersion: 2, kind: 'action', actionId: '...' }` with an `actionId`
from that request's candidate list.

## Registering with Vorryn

Once deployed:

1. Sign in to Vorryn.
2. Visit **Profile → Build a Bot** (`/profile?tab=build`).
3. Under **Enlist an Envoy**, fill in:
   - **Name** — what other players see in the lobby.
   - **Endpoint URL** — your deployed bot's **base** HTTPS URL, with no
     `/play` suffix (e.g. `https://my-bot.fly.dev`) — Vorryn appends
     `/play` itself.
   - **Shared secret** — the value of `BOT_BEARER` you set in `.env`
     (32+ characters).
4. Click **Enlist Bot**.

Your bot is now ready. Seat it from the seat plan in any game **you**
create; opponents at the table play against it, but only you can deploy
it. The shared secret is stored encrypted and never shown to anyone but you.

## Where to put your strategy

`src/strategy.ts` exports `pickAction(req: BotRequest): BotResponse`.
Read the validated request, return the chosen `actionId` (must be one
of `req.validActions[i].id`). The checked-in `champion.js` is generated from
Vorryn's validated decision graph; do not edit that bundle by hand. Put
experiments in the readable simulator/search modules, measure them against a
fixed corpus, and only override the champion when the evidence supports it.

`src/simulator.ts` is an evaluator, not a clone of the private game engine.
The protocol intentionally omits hidden hands, deck order, and the dice seed;
an exact rollout cannot be reconstructed during a game. The simulator instead
uses the complete visible board and samples the uncertainty a human player
also faces. For genuinely stronger play, grow this into a belief-state search:
infer opponent material distributions from `recentEvents`, sample legal hidden
worlds, and backpropagate terminal win value while always selecting from the
original `validActions` array.

`src/search.ts` performs abstract lookahead because the current request cannot
enumerate the server's future legal candidates. It projects post-action
inventory, new production, and the best reachable follow-up plan under a hard
deadline. That is honest public-protocol search; calling it an exact engine
rollout would overstate what an external bot can reconstruct.

Domestic-trade candidates always use proposer perspective. When this bot is a
responder, it therefore treats `offer` as what it receives and `want` as what
it gives; reversing those fields makes a bot systematically accept losing
human offers.

Ideas, ordered from least to most effort:

1. **Random.** `req.validActions[Math.floor(Math.random() * req.validActions.length)].id`.
2. **Greedy heuristic.** Score each candidate with a hand-tuned
   function over the visible state. The Vorryn first-party bot uses
   this approach at scale (25+ score-rule modules).
3. **One-ply lookahead.** Score each candidate's expected outcome by
   simulating one move forward; pick the highest. Costs more time —
   stay under 12s.
4. **Monte Carlo tree search.** Simulate many random rollouts from
   each candidate; pick by win-rate. Works well with a budget of a
   few seconds.

Two fixtures show what your bot will receive. The small one
(`play-request.json`) is hand-readable: a typical action-phase turn with
a few candidates and an `endTurn`. The full one
(`play-request-full.json`, ~68 KB pretty-printed; ~43 KB as actually sent on
the wire, ~5.4 KB gzipped) is captured from a real self-play game at turn 10 —
three fully populated players, a complete board (19 hexes, 54 intersections,
72 edges, 9 harbors), 16 candidates spanning progress cards, domestic trades,
and `endTurn`, a real dice histogram, and a 60-event `recentEvents` window. It
has `validActionsTruncated: false`; production requests can still set that flag
and name capped families in `truncatedFamilies`. Use the fixture to see
realistic payload sizes and opponent redaction (you never see opponents' hands,
only `opponentMaterialTypes`). Your strategy must handle:

- **Setup phases** (`state.phase === 'setup1'` / `'setup2'`).
- **Roll phase** (just `rollDice`, plus any pre-roll progress cards).
- **Pending decisions** (`state.pendingDecision !== null` — the
  candidate list is restricted to legal answers).

A trivial fallback is fine for any of these: just pick
`validActions[0]`. Every candidate in the request has already been
validated by Vorryn.

## Deploying

Any HTTPS-capable host that can keep a small Node process available will work.
The sample fits entry-level container or web-service plans on Fly.io, Render,
or Railway. Fly.io is paid after its trial; Render and Railway offer limited
free plans, but their limits can change. Check provider pricing before
deploying, and use an always-warm instance for competitive games:

```bash
# Fly.io example
fly launch --no-deploy
# Then edit fly.toml: set internal_port = 3001, copy .env into Fly secrets.
fly secrets set BOT_BEARER="<your-secret>"
fly deploy
```

Scale-to-zero serverless (AWS Lambda, Azure Functions on Consumption,
Cloud Run on min-instances=0) will work but expect occasional turn
forfeits on cold starts — the Vorryn server's per-request budget is
12 seconds, and a Node Lambda cold start eats a noticeable chunk of
that. For competitive play, one always-warm instance is worth it.

The included production container can run on any OCI-compatible host:

```bash
docker build -t vorryn-bot .
docker run --rm -p 3001:3001 -e BOT_BEARER="<your-secret>" vorryn-bot
curl http://localhost:3001/health
```

The process handles `SIGTERM`/`SIGINT` with a graceful Fastify shutdown. Keep
the bearer secret in the host's secret store, never in the image or repository.
The bundled GitHub Actions workflow verifies the frozen install, TypeScript
build, tests, and container build on every push and pull request. Dependabot
checks npm and workflow dependencies weekly with a three-day cooldown.

## FAQ

### Does a bot builder have everything they need to build the best possible bot?

Yes — up to the information a player at the table is entitled to. The
`state` in every request passes through the same viewer-redaction layer
as the human browser client, so your bot sees exactly what a human
sitting in its seat would see: the full board, its own hand, and every
opponent's public position (points, knights, improvements, hand _sizes_,
and the set of material types in play across opponents — never the cards
themselves or a per-opponent type breakdown). Hidden information
— opponents' hands, the shuffled decks, the dice seed — is hidden from
everyone equally, including the first-party bot. So the ceiling is "the
strongest possible player with public information," which is the same
ceiling humans play under. Nothing a human player gets is withheld
from your bot.

You also get a few things a human has to track by hand:

- `diceHistogram` — the full production-roll tally for the game so far.
- `recentEvents` — a bounded window of public events, useful for
  inference (who just gained which material type, who traded what).
- `validActions` — every legal move, pre-validated, so you spend zero
  effort on rules enforcement.
- [`RULES_REFERENCE.md`](../../docs/RULES_REFERENCE.md) — the complete
  implemented-rules reference, drift-tested against the engine itself.

The one structural constraint: your bot _selects_ a candidate, it never
constructs its own move payload. That isn't a strategic handicap — the
candidate list is the enumeration of legal moves (see the next question).
Each candidate has an opaque, non-empty `id` that is unique within that
request; return exactly one of those ids.

### What are the chances the "best" move is not in `validActions`?

Effectively zero for everything except trade offers — and the request
tells you explicitly when it happens.

Enumeration is exhaustive per action family with one safeguard: each
family is capped at 96 candidates (forced decisions like discards get a
much larger 4,096 cap that real hands essentially never reach). Builds,
card plays, piece moves, maritime trades, and pending-decision answers
all enumerate completely in practice — every legal option is in the
list.

The only family that genuinely hits the cap is domestic trade
proposals, whose combinatorics explode with hand size. Three things
keep that from costing you:

1. **You're told.** `validActionsTruncated: true` plus
   `truncatedFamilies` naming the capped family — never silent.
2. **Truncation is ordered, not random.** The enumerator emits offers
   asking for the proposer's bottleneck resources _first_, so the
   highest-value asks survive the cap, and multi-card bundles get a
   reserved sub-quota so simple 1-for-1 pairs can't crowd them out.
3. **Trades need a counterparty anyway.** A trade offer is a proposal,
   not a resolution — a "missing" permutation of a similar surviving
   offer rarely changes the outcome.

So: if your dream move is a build, a card, or a move, it's in the list.
If it's one of a hundred near-identical trade offers, a representative
high-value version of it is in the list, and the flags tell you the
family was trimmed.

### Is cheating possible in this game?

Not through your bot — the protocol is designed so the classic cheats
are structurally impossible, not merely against the rules:

- **Illegal moves.** Your bot never submits a move, only an `id` from
  the list Vorryn already validated. An `actionId` outside that list is
  rejected outright; there is no payload of your own construction to
  smuggle anything into.
- **Peeking at hidden information.** Redaction happens on the Vorryn
  server _before_ the request is built. Opponents' hands, the deck
  order, and the dice seed are never on the wire — no amount of clever
  parsing can recover what was never sent.
- **Rigging the dice.** Rolls happen inside the server engine. Your bot
  can choose _to_ roll (when that's the legal move); it has no input
  into the result.
- **Acting out of turn.** Vorryn calls your bot only when it has a
  decision to make, and applies exactly one chosen action per request.
  There's nothing to replay, reorder, or flood.

A slow or crashed bot can't stall a game either — see the failure
question below.

What remains is what remains at any table: soft play — a bot could
deliberately favor one opponent. Since only you can seat your bots in
games you create, your table always knows whose bots they're playing
with, and that reputation is yours to keep.

### Are the dice rolls fair?

Yes — and unusually for an online game, you can verify it yourself.

Every game gets a secret seed drawn from the platform's cryptographically
secure RNG at creation. From then on each roll (two production dice plus the
event die) is derived deterministically from that seed and the dice roll
ordinal (`state.dice.rollNumber`) — the same path for every player, human or
bot, with no reroll, no nudge, and no way for the server operator to favor a
seat without it being detectable.

Three properties fall out of that design:

- **Nobody can predict rolls mid-game.** The seed never appears on the
  wire while a game is active — not to players, not to bots, not in
  the decision traces. Knowing it would mean knowing every future roll,
  so it's treated like a credential.
- **Everybody sees the same evidence.** The `diceHistogram` in every
  request is the actual tally of production rolls so far. A streak of
  8s is right there in the data for all seats equally.
- **Completed games are auditable.** Once a game ends, the seed is
  surfaced to its participants for offline review. Anyone at the table
  can re-derive the full roll sequence from the seed and confirm every
  roll the game reported is exactly what the seed dictated — fairness
  by replay, not by trust.

And yes, real dice are streaky — a fair 2d6 distribution _will_ hand
someone three 11s in a row occasionally. The histogram converges on
the bell curve over a game; short-run variance is the game working as
designed, and good bots (see `diceHistogram`) plan around it rather
than complain about it.

### Does my bot only play its own turns?

No — it's consulted for every decision its seat owes the table, and
some of those happen on _other players'_ turns: responding to an
incoming trade offer, discarding half its hand when the dice demand
it, handing over cards an opponent's progress card forces. The good
news is these need no special handling: when
`state.pendingDecision !== null`, `validActions` is already restricted
to the legal answers. One code path — score the candidates, return an
`id` — covers all of it.

### What happens if my bot crashes, times out, or returns something invalid?

The game continues and your bot stays seated. Any failure — timeout
(12s budget per attempt), connection error, malformed response, an
`actionId` not in the list — gets one quick retry (so a hard timeout
delays a decision by at most ~24s); if that fails too, Vorryn's
first-party bot plays that one decision instead, and your bot is
called again for the next one. Each
substitution is recorded per decision (with the error text) on the
game's bot-decisions page, so a flaky deploy shows up as a visible
streak of fallbacks rather than a silently lost game.

### Can my bot remember things between turns?

The protocol won't do it for you — every request is self-contained by
design (full redacted state, `recentEvents`, `diceHistogram`), so a
completely stateless function is a fully competitive bot. If you want
memory anyway (opponent modeling, plan continuity), keep your own
store keyed by `gameId` + `playerId`. Just treat it as a cache: your
process can restart mid-game, and the next request must be answerable
from its own contents.

### How do I debug my bot after a game?

Two tools. First, return an optional `decisionTrace` (keep it ≤4KB)
with whatever you'll want later — strategy name, chosen score, the
runner-up gap. Vorryn persists it per decision and shows it on the
game's bot-decisions page alongside what was picked. Second, once the
game completes, its dice seed is revealed (see the fairness question
above), so the entire game is deterministically replayable — you can
reconstruct any decision point your bot faced and rerun your strategy
against it offline.

### What is `personality`?

An optional preset key (`aggressive`, `builder`, `trader`, …) the game creator
can assign per seat; the first-party bot merges it over its tuning baseline.
Your bot is free to honor it for flavor — or ignore it entirely. It's the
canonical example of a v2.x additive field: bots that never read it work fine,
and your schema codegen shouldn't error on unknown fields generally.

### How strong is this bot relative to the first-party bot?

The production selector is the same validated champion decision graph under
the same public-information limits. A private engine referee tested one sample
seat against two built-in seats with fixed seeds and cyclic seat rotation:

- Default profile: 104/300 wins (34.67%) versus 33.33% fair share; zero timeouts.
- Human-table profile: 103/300 wins (34.33%) versus 33.33% fair share; zero timeouts.

Average final VP was also essentially equal in both gates. Those results show
policy parity, not a statistically proven edge. The sample automatically uses
the strongest validated zero-noise human-table composition when a human roster
is supplied. Improvements should clear a fresh paired engine gate before they
replace this baseline.

## License

MIT — do whatever you want with this code.
