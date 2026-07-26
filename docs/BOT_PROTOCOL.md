# Vorryn Bot Protocol — v2

Wire contract between the Vorryn web server and a bot service. The
canonical machine-readable schema is [`bot-protocol.schema.json`](./bot-protocol.schema.json) — feed it to NSwag, OpenAPI Generator, or any JSON Schema codegen tool to produce typed DTOs in your language of choice.

This document is the human-readable companion: it explains the contract,
the version policy, and operational concerns (timeouts, cold starts,
auth) that the schema can't capture. Game-rule semantics behind each action — costs, effects, the full progress-card catalog — live in [`RULES_REFERENCE.md`](./RULES_REFERENCE.md).

---

## Endpoint

```
POST <bot-url>/play
Content-Type: application/json
Authorization: Bearer <secret>     (third-party bots only — see "Auth")
```

The web server `POST`s a `BotRequest` body and expects a `BotResponse`
body. There are no other endpoints. A `GET /health` returning `{ "ok":
true }` is recommended but not required.

## Lifecycle of a turn

1. Web computes legal actions for the player whose turn it is.
2. Web `POST`s `/play` with the full visible game state plus the legal
   action list (`validActions[]`). Each candidate carries an opaque
   server-assigned `id`.
3. Bot returns an `action` response with `actionId` set to the `id` of
   one entry from `validActions[]`.
4. Web applies that action and either (a) returns the turn to the next
   player, or (b) loops back to step 1 if the player still has a
   pending decision (e.g. discard, robber placement).

The bot **selects, never constructs.** It picks an `id` from the list
the server hands it. This prevents tampering: a bot can never propose
an action the server has not already validated.

### `validActions[]` ordering

The server returns candidates in **deterministic enumeration order, not
preference order**. There is no "best move first" — bots are expected
to score every candidate before picking. A few orderings are stable and
worth knowing about:

- **Action phase**: `endTurn` is first, followed by `skipRoadBuilding`,
  `domesticTradeCancel`, then maritime/domestic trade proposals,
  progress cards, build-road candidates, per-intersection
  build/recruit/wall, `improveCity` for each track, and per-knight
  activate/promote/move.
- **Roll phase**: `rollDice` is first, then any pre-roll progress
  cards (e.g. Augury).
- **Setup phase**: one `placeSetupBuilding` candidate per legal
  intersection. `placeSetupRoad` candidates appear on the next
  request, after the building is placed.
- **Pending decisions**: only that decision's variants — order depends
  on the decision (e.g. discard combinations, eligible hexes).

Within `playProgressCard` for `scienceAugury`, the 36 `(die1, die2)`
payloads are pre-sorted by descending production-pip weight so a flat-
tie pick lands on `sum=8` rather than `sum=2`. That's the only place
ordering carries semantic intent — everything else is iteration order.

The `id` is opaque and only meaningful within a single request. Across
calls, position N can refer to a different action because the
underlying state changed. Don't index by position across turns.

## Envelopes

### `BotRequest`

```ts
{
  protocolVersion: 2,
  gameId: string,
  playerId: string,                  // the player the bot is acting as
  state: ClientGameState,            // viewer-redacted game state
  validActions: BotActionCandidate[],// non-empty; each has an opaque id
  validActionsTruncated: boolean,    // true if any family was capped
  truncatedFamilies: string[],       // which families hit the cap
  diceHistogram: { [sum: string]: number }, // production-roll tally pad
  recentEvents: RecentEvent[],       // bounded list (≤200), public redacted events
  personality?: string | null,       // optional style tuning-preset key; bot
                                     // service merges over baseline,
                                     // unknown keys fall back to baseline
  tableProfile?: string | null,      // optional table-context overlay; "humans"
                                     // composes with an explicit style
  difficulty?: string | null,        // "easy" | "normal" | "hard"
  decisionMemory?: {                 // first-party, web-owned continuation token
    version: 1,
    strategy: { key: string, sinceTurn: number },
    updatedAtTurn: number,
    updatedAtStateVersion: number
  } | null
}
```

### `BotResponse`

```ts
{
  protocolVersion: 2,
  kind: "action",
  actionId: string,                  // must equal one validActions[i].id
  decisionTrace?: BotDecisionTrace,  // optional — persisted for analysis
  decisionMemory?: { ... } | null    // optional first-party continuation update
}
```

`decisionMemory` on the response is optional; `null` is accepted and
treated the same as omitting the field, so a bot that echoes the
request's `decisionMemory: null` back verbatim still validates. The
server **ignores** memory returned by external bots — it only
round-trips `decisionMemory` for the first-party bot.

External bots may intentionally delegate an unsupported decision:

```ts
{
  protocolVersion: 2,
  kind: "abstain",
  reason?: string                    // optional, max 200 chars
}
```

See [`bot-protocol.schema.json`](./bot-protocol.schema.json) for
exhaustive nested shapes (`ClientGameState`, `BotActionCandidate`,
`PendingDecision`, etc.). Identifiers and action/pending-decision
`type` discriminator strings are camelCase engine tokens
(`"buildRoad"`, `"endTurn"`, `"discardResources"`, ...); preserve
them verbatim.

### Recent event privacy

`recentEvents[]` is decision context, not a replay dump. The list keeps
only public game-log event families and removes fields that would reveal
hidden hands or internal bot analytics:

| Event path                  | What bots receive                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actionApplied.action`      | The public action shape. `playProgressCard.instanceId`, private `resolveOptionalCardEffect` card/material fields, and raw discard card identities are removed. `discardHalf` / `discardProgress` expose only `cardCount`. |
| `actionApplied.production`  | Exact public per-player material receipts for that production event. Bots may use these as public hand-composition evidence.                                                                                              |
| `progressCardDraws.draws[]` | `playerId`, deck, and public flags such as `isVp`; `cardId` and `instanceId` are removed.                                                                                                                                 |
| bot replay annotations      | `botStrategy` and `botTopCandidates` are omitted from bot requests.                                                                                                                                                       |

Treat all unknown recent-event fields as additive context and ignore
what you do not understand.

## Versioning

- **`protocolVersion: 2`** is the current and only stable version.
  Version 1 is no longer accepted.
- Web rejects requests whose `protocolVersion` differs from what its
  bot supports with **HTTP 422**.
- Additive changes (new optional fields, new action variants) ship as
  **v2.x within `protocolVersion: 2`** — bots that ignore unknown
  fields keep working. Codegen against the schema and **do not** error
  on unknown enum members. `personality` is the canonical example:
  bots that don't read it still function correctly.
- Breaking changes ship as a further version bump. Web will publish
  a new schema file and a migration note before flipping the default.

### Domestic trade actions

Responders choose `domesticTradeBid { offer, want }` or
`domesticTradePass`; the proposer chooses
`domesticTradeAward { bidResponderId, offer, want }` or
`domesticTradeCancel`.
An acceptance is a bid whose `offer` and `want` equal the proposal's.
Both remain **proposer-perspective**:
`offer` is what the proposer hands over, `want` is what the proposer
receives, on the proposal and on every bid. The proposer closes the
auction with `domesticTradeAward { bidResponderId, offer, want }`,
naming the standing bid they are taking and echoing its terms. Bids are
revisable while the auction is open, so the engine rejects an award
whose echoed terms no longer match that responder's standing bid — a
selection-only bot never constructs this payload and is unaffected.

The pending payload always contains `auctionId`, `offer`, `want`,
`bids`, and `passedPlayerIds` (plus optional `targetPlayerId`). A
responder may revise their standing answer while the auction remains
open. Selection-only bots still return one pre-validated `actionId`
from `validActions[]`.

## Hosting guidance

Any HTTPS host with persistent process memory works — Fly.io, Render,
Railway, a small VM, or scale-to-zero serverless (AWS Lambda, Azure
Functions, Cloud Run). The one hard constraint is the protocol's
**12-second per-request budget** (one retry), so cold starts are the
main thing to manage. The figures below use Azure Functions to match
the C# example later in this doc; the same trade-off applies anywhere.

Functions on the **Consumption** plan can cold-start in 3–10 seconds
for C# isolated workers. The protocol's per-request timeout is 12
seconds, with one retry. External bot failures re-ask the first-party
bot, and the final safety net picks the first valid action only if that
fallback call also fails.

For production-grade play, two recommendations:

1. **Premium plan, one always-ready instance** (`alwaysReady=1`).
   Eliminates cold starts for the cost of one warm worker (~$140/mo at
   the time of writing).
2. If you stay on Consumption, expect occasional fallback decisions on
   cold starts. Failed external calls are recorded on `bot_decisions`
   with fallback provenance and `error_text`, so you can monitor the
   rate from bot diagnostics.

The Function `230s` request timeout is not a constraint here — every
`/play` call is bounded by the web server's 12-second budget.

## Timeouts and fallbacks

| Scenario                           | Web behavior                                              |
| ---------------------------------- | --------------------------------------------------------- |
| Bot returns 200 within 12s         | Use the returned `actionId`.                              |
| External bot returns `abstain`     | Re-ask the first-party bot for the decision.              |
| Bot returns non-200 or timeout     | Retry once. External failures then re-ask first-party.    |
| Bot returns `actionId` not in list | Treat as failure → retry/fallback path.                   |
| `protocolVersion` mismatch (422)   | Single 422 → use the fallback path immediately, no retry. |

Fallback decisions are recorded in `bot_decisions`. External failures
carry an `error_text` reason such as `timeout`, `http_error`,
`malformed_response`, `protocol_version_mismatch`,
`invalid_action_id`, or `network_error`; intentional abstains keep that
field null.

## Auth (third-party bots)

The shape:

- Register friend-owned bots through **Profile → Build a Bot** (`/profile?tab=build`).
- Each bot user has a row in `users` with `is_bot = true`,
  `bot_endpoint_url` (HTTPS URL), encrypted `bot_secret_enc`, and
  `bot_owner_user_id`.
- Web sends `Authorization: Bearer <secret>` on every `/play`
  request to that URL.
- The bot validates the bearer and rejects with 401 on mismatch.
- Function-level auth (function keys / Easy Auth) is fine in
  _addition_ — the bearer is what the protocol guarantees.

First-party bot rows have `is_bot = true` and **no** endpoint URL;
the web server falls back to the shared `BOT_URL` env var and sends
no `Authorization` header.

## Examples

### Example 1 — Action phase (build)

Mid-game, the player has just rolled, and may build a road, end their
turn, or trade. The bot picks one.

#### Request

```json
{
  "protocolVersion": 2,
  "gameId": "9d9b7a6e-...",
  "playerId": "p-alice",
  "state": {
    "id": "9d9b7a6e-...",
    "version": 142,
    "phase": "action",
    "currentPlayerId": "p-alice",
    "turnNumber": 14,
    "players": {
      "p-alice": {
        /* SelfPlayerState */
      },
      "p-bob": {
        /* OpponentPlayerState */
      }
    },
    "board": {
      "hexes": {
        /* ... */
      },
      "intersections": {
        /* ... */
      },
      "edges": {
        /* ... */
      },
      "harbors": []
    },
    "dice": { "die1": 4, "die2": 4, "sum": 8, "redDie": 3, "eventDieResult": "ship" },
    "berserkerTrackPosition": 3,
    "berserkerTrackMax": 7,
    "firstBerserkerAttackResolved": true,
    "robberActive": false,
    "merchantHexId": null,
    "merchantOwnerPlayerId": null,
    "longestRoadHolderPlayerId": null,
    "pendingDecision": null,
    "winnerPlayerId": null,
    "lastBerserkerAttackResult": null,
    "lastBerserkerAttack": null,
    "lastVpAwards": [],
    "scienceDeckCount": 9,
    "tradeDeckCount": 8,
    "politicsDeckCount": 10,
    "progressDiscardScience": [],
    "progressDiscardTrade": [],
    "progressDiscardPolitics": [],
    "bankResources": { "lumber": 17, "brick": 16, "wool": 19, "grain": 18, "ore": 19 },
    "bankCommodities": { "coin": 12, "paper": 11, "cloth": 12 },
    "opponentMaterialTypes": ["wool", "grain"],
    "domesticTradeDeclinesThisTurn": []
  },
  "validActions": [
    { "id": "a-001", "type": "buildRoad", "edgeId": "e-12-13" },
    { "id": "a-002", "type": "buildSettlement", "intersectionId": "i-22" },
    { "id": "a-003", "type": "endTurn" }
  ],
  "validActionsTruncated": false,
  "truncatedFamilies": [],
  "diceHistogram": {
    "2": 1,
    "3": 4,
    "4": 6,
    "5": 7,
    "6": 9,
    "7": 6,
    "8": 11,
    "9": 5,
    "10": 3,
    "11": 2,
    "12": 1
  },
  "recentEvents": [
    {
      "sequence": 480,
      "type": "diceRolled",
      "actingPlayerId": "p-alice",
      "turnAfter": 14,
      "payload": { "actingPlayerId": "p-alice", "sum": 8 }
    }
  ]
}
```

#### Response

```json
{
  "protocolVersion": 2,
  "kind": "action",
  "actionId": "a-002",
  "decisionTrace": {
    "strategy": "greedy-vp",
    "chosenScore": 42.5,
    "scoreGapTop1Top2": 11.2,
    "candidateCount": 3,
    "top3": [
      { "type": "buildSettlement", "score": 42.5 },
      { "type": "buildRoad", "score": 31.3 },
      { "type": "endTurn", "score": 0.0 }
    ]
  }
}
```

### Example 2 — Forced decision (discard half)

A 7 was rolled; the player must discard half their resources. The bot
chooses which cards to discard.

#### Request

```json
{
  "protocolVersion": 2,
  "gameId": "9d9b7a6e-...",
  "playerId": "p-alice",
  "state": {
    "phase": "action",
    "currentPlayerId": "p-bob",
    "pendingDecision": {
      "type": "discardResources",
      "actingPlayerId": "p-alice",
      "allowedPlayerIds": ["p-alice"],
      "payload": { "required": { "lumber": 2, "grain": 1 } }
    }
    /* ...remaining ClientGameState fields elided for brevity... */
  },
  "validActions": [
    { "id": "d-001", "type": "discardHalf", "cards": ["lumber", "lumber", "grain"] }
  ],
  "validActionsTruncated": false,
  "truncatedFamilies": [],
  "diceHistogram": { "7": 7 },
  "recentEvents": []
}
```

#### Response

```json
{ "protocolVersion": 2, "kind": "action", "actionId": "d-001" }
```

When `pendingDecision` is non-null, every entry in `validActions[]`
already encodes a legal answer to the decision. The bot just picks
one — same shape as any other turn.

## Idempotency

Web includes the same `gameId`+`state.version` on every request for a
given decision point. If the bot reads the response and crashes before
the web server records it, web will **retry the same request**. The
bot may return a different `actionId` on the retry — web takes whatever
arrives on the second call.

Bots that want stable behavior can key on `(gameId, state.version)`
and cache their decision; this is optional.

## Decision trace

`decisionTrace` is optional and persisted to `bot_decisions` for
offline analysis. Keep it small (≤4KB) — large traces are truncated.
Useful fields:

- `strategy` — name/version of the decision algorithm (`"greedy-vp"`, `"mcts-v3"`).
- `chosenScore` / `scoreGapTop1Top2` — how confident the choice was.
- `top3` — top three candidates with scores; helpful for offline tuning.
- `context` — small flat map of game-state features the bot used.

## Codegen — quick start (C# / .NET)

```bash
nswag jsonschema2csclient \
  /input:bot-protocol.schema.json \
  /output:VorrynBotProtocol.cs \
  /namespace:Vorryn.Bot
```

Then host the resulting DTOs behind any HTTP framework. For Azure
Functions (isolated worker), a minimal `/play` endpoint:

```csharp
[Function("Play")]
public async Task<HttpResponseData> Run(
    [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req)
{
    var body = await req.ReadFromJsonAsync<BotRequest>();
    var chosen = body!.ValidActions[0];   // replace with your strategy
    var resp = req.CreateResponse(HttpStatusCode.OK);
    await resp.WriteAsJsonAsync(new BotResponse {
        ProtocolVersion = 1,
        Kind = "action",
        ActionId = chosen.Id,
    });
    return resp;
}
```

## Local development

Web reads the bot URL from `BOT_URL`. To point at a locally-running
Function:

```bash
# In a separate terminal:
func start --port 7071

# In your web/.env:
BOT_URL=http://localhost:7071/api
```

The web server's local game-create flow lets you start a game against
your own bot for end-to-end testing.

---

**Source of truth:** [`bot-protocol.schema.json`](./bot-protocol.schema.json) is
generated from the Vorryn engine's wire schemas and published with each release.
If this document and the schema disagree, **the schema wins** — file an issue
noting the discrepancy.
