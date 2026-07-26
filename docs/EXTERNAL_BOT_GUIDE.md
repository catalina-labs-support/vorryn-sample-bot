# Building a bot for Vorryn

Vorryn is a strategy game of trade, settlement, and knights. You can plug in your
own bot — an HTTP service the Vorryn server will call on its turn — and
play your bot against other people's bots (or against humans).

**This repository is that starter bot** — a working bot in TypeScript,
with this guide bundled alongside it. Clone it, change the strategy,
deploy it, and you have a Vorryn bot.

This guide explains the contract your bot must satisfy. The
machine-readable companion is
[`bot-protocol.schema.json`](./bot-protocol.schema.json) — point any JSON
Schema codegen tool at it for typed DTOs in your language. If this
document and the schema disagree, **the schema wins**. The canonical
human-readable envelope and fallback reference is
[`BOT_PROTOCOL.md`](./BOT_PROTOCOL.md); this guide stays focused on
onboarding and implementation.

## Concept

A Vorryn bot **selects, never constructs.** On each of your bot's turns
the Vorryn server enumerates every legal action, posts the whole game
state plus the list of legal candidates to your endpoint, and waits for
you to pick one by id. Your bot never proposes an action the server
hasn't already validated — that prevents tampering and means your bot
can't put itself in an impossible state.

```
                  ┌────────────────┐                  ┌──────────────┐
   Player's turn  │ Vorryn server  │  POST /play      │  Your bot    │
   ──────────────▶│  computes      │ ───────────────▶ │              │
                  │  legal actions │                  │  pick one    │
                  │                │ ◀─────────────── │  by id       │
                  │  applies it    │ { kind, actionId }│              │
                  └────────────────┘                  └──────────────┘
```

Your bot is just an HTTP server. Any language, any host. The only
required endpoint is `POST /play`.

## Registering your bot

1. Sign in to your Vorryn account.
2. Visit **Profile → Build a Bot** (`/profile?tab=build`).
3. Under **Enlist an Envoy**, supply:
   - **Name** — what other players see in the lobby.
   - **Endpoint URL** — an `https://` URL where your bot will listen for
     `/play` POSTs. The URL must be publicly reachable. `http://`,
     loopback, and private-network addresses are rejected.
   - **Shared secret** — a strong random string you'll also configure
     on your bot. Vorryn sends it as `Authorization: Bearer <secret>`
     on every request. Generate one with `openssl rand -base64 32` (or
     the **Generate** button), then click **Enlist Bot**.

Vorryn encrypts the secret at rest with AES-256-GCM, and it is never shown
to anyone but you. Only you can seat your bot, and only in games you create
— opponents at the table play against it but cannot deploy it themselves.

If your bot is unreachable, slow, or replies with the wrong protocol
version, the server falls back to its built-in bot for that turn (see
"Timeouts and fallbacks" below). Players won't get stuck.

## The endpoint

```
POST <your-bot>/play
Content-Type: application/json
Authorization: Bearer <your-shared-secret>
```

A `GET /health` returning `{"ok": true}` is recommended but not
required.

## Request and response

`POST /play` uses the `BotRequest` and `BotResponse` envelopes from the
[protocol reference](./BOT_PROTOCOL.md#envelopes). Generate DTOs from
the schema instead of copying those shapes by hand.

A request carries a viewer-redacted `ClientGameState`, the acting
`playerId`, and non-empty `validActions[]`. Hidden information
(opponent hands, deck contents) appears as counts only.

Each `BotActionCandidate` has an opaque server-assigned `id` plus the
action payload. The `id` is the only thing your bot needs to return.

**Don't index by position across turns.** The `id` is meaningful within
a single request; the same array index may map to a different action
on the next call because the state changed.

Return a 200 `kind: "action"` response with one candidate `actionId`
within 12 seconds and your bot's turn is done. A bot may return
`kind: "abstain"` when it intentionally delegates an unsupported
decision; Vorryn then re-asks its built-in bot.

## Pending decisions

Sometimes a player owes a decision before the turn can advance — they
rolled a 7 and must discard, they were the target of a progress card,
they have to place the robber. In those cases `state.pendingDecision`
is non-null and `validActions[]` contains only legal answers to that
decision. Your bot picks one the same way as any other turn.

Pending decisions can target a player who isn't the current player
(e.g. on a 7 roll, multiple players may need to discard simultaneously).
The `playerId` in the request tells you which player to act for.

## Action selection in practice

`validActions[]` is in **deterministic enumeration order, not
preference order.** There is no "best move first" — your bot is
expected to score every candidate. The
[protocol reference](./BOT_PROTOCOL.md#validactions-ordering) records
the current stable ordering notes for action, setup, roll, and pending
decision phases.

When a family of actions would explode combinatorially (e.g. trade
offers across many resource splits), the server caps it and sets
`validActionsTruncated: true` with the affected family in
`truncatedFamilies[]`. A truncated family still contains a useful
slice — your bot doesn't need to do anything special, but knowing the
cap fired can be a tuning signal.

## Timeouts and fallbacks

The server's per-request budget is **12 seconds**, with **one retry**
for external bot failures. If your bot fails or abstains, Vorryn
re-asks its built-in bot; `validActions[0]` is the final safety net if
the built-in bot also fails. The
[protocol reference](./BOT_PROTOCOL.md#timeouts-and-fallbacks) owns
the scenario matrix.

Every failure is logged with the reason (`timeout`, `http_error`,
`malformed_response`, `protocol_version_mismatch`, `invalid_action_id`,
`network_error`) and measured latency. You can see your own bot's
failure rate on the **Build a Bot** tab (`/profile?tab=build`).

A **circuit breaker** trips automatically if your endpoint fails
repeatedly within a short window — the server stops calling for a few
minutes and falls back to the built-in bot, then probes again. This
protects active games from being stuck waiting on a deployment outage
on your side.

## Idempotency

Vorryn includes the same `gameId` + `state.version` on every request
for a given decision point. If your bot crashes between deciding and
the server recording the response, the server retries the same request.
Your bot may return a different `actionId` on retry — the server
accepts whichever arrives second.

If you want strictly deterministic behavior, key your decision on
`(gameId, state.version)` and cache the answer for a few seconds.

## Versioning

- **`protocolVersion: 2`** is the current and only stable version.
  Version 1 is no longer accepted.
- The server rejects requests whose `protocolVersion` differs from
  what its bot supports with HTTP **422**.
- **Additive changes** (new optional fields on `BotRequest`, new
  action variants) ship as **minor v2.x** — bots that ignore unknown
  fields keep working. Generate code from the schema and **don't**
  error on unknown enum members.
- **Breaking changes** ship as a further version bump. A new schema
  and migration note will be published before the default flips.

**Domestic trade:** responders send `domesticTradeBid { offer, want }`
(an acceptance is a bid at the proposal's own terms) or
`domesticTradePass`; the proposer closes with
`domesticTradeAward { bidResponderId, offer, want }` — the echoed terms
must still match that responder's standing bid, which protects the
proposer from a bid revised after they decided. Terms stay
proposer-perspective throughout: `offer` is what the proposer hands
over, `want` is what they receive. The pending always includes complete
`bids` and `passedPlayerIds` arrays, and a responder may revise a
standing answer while the auction remains open. Bots that only pick an
`actionId` out of `validActions[]` need no special trade logic.

## Decision trace (optional)

`decisionTrace` lets you persist a small note about why your bot
picked what it did. Useful for offline tuning. Keep it under ~4KB.
Suggested fields:

```ts
{
  strategy: "mcts-v3",                // your bot version / algorithm
  chosenScore: 42.5,
  scoreGapTop1Top2: 11.2,             // confidence proxy
  candidateCount: 18,
  top3: [
    { type: "buildSettlement", score: 42.5 },
    { type: "buildRoad",       score: 31.3 },
    { type: "endTurn",         score: 0.0 }
  ],
  context: { /* small flat map of features */ }
}
```

Your bot's traces are visible to you on the **Build a Bot** tab (`/profile?tab=build`).

## Local development

The sample bot is the fastest way in. Two-terminal setup:

```bash
git clone https://github.com/catalina-labs-support/vorryn-sample-bot
cd vorryn-sample-bot
pnpm install
pnpm dev          # listens on http://localhost:3001 by default
```

To smoke-test the contract without standing up the full Vorryn server,
the sample repo injects a single fixture request through its Fastify
handler:

```bash
pnpm test         # injects fixtures/play-request.json, asserts a 200
```

## Going to production

Anywhere you can host an HTTPS Node service works — Fly.io, Render,
Railway, Heroku, your own VPS. Three constraints:

1. **HTTPS, no loopback / private IPs.** The server rejects URLs that
   look internal (loopback, RFC1918, link-local, `.local`, `.internal`,
   IPv6 ULA). DNS rebinding is not yet checked at the IP-pinning level,
   so don't deploy your bot on a host you don't fully control.
2. **Stay under 12 s per request.** Cold starts on serverless platforms
   are the #1 cause of fallback. If you use AWS Lambda / Azure
   Functions / Cloud Run on a scale-to-zero plan, expect occasional
   first-action forfeits. A single always-warm instance fixes it.
3. **Validate the bearer.** Reject `/play` requests whose
   `Authorization: Bearer <secret>` doesn't match the secret you
   registered. The sample bot does this in two lines — copy that
   block.

## FAQ

**Can I see other players' hands?** No. `ClientGameState` is redacted
per viewer: opponents appear with counts only, never card identities.

**Can my bot remember state between calls?** Yes, but you don't have
to. Every request carries the full visible game state plus the legal
actions, so a stateless bot can play perfectly well.

**Can I write a bot in <language>?** Yes. The schema generates DTOs for
any major language. The sample is TypeScript because Node has the
shortest setup path.

**Does the protocol version freeze?** Within v1, only additive changes.
Codegen tools that error on unknown enum members will need to be
relaxed; otherwise additive minor releases will break your bot
unnecessarily. Use the schema, set `additionalProperties: true` when
your tool supports it.

**Can I run multiple bots from one server?** Yes — register each as a
separate bot user with its own endpoint URL or path. The endpoint URL
can carry path components.

## Resources

- [`bot-protocol.schema.json`](./bot-protocol.schema.json) — canonical machine-readable schema.
- [`RULES_REFERENCE.md`](./RULES_REFERENCE.md) — complete implemented-rules reference (costs, cards, forced decisions).
- [Sample bot code](../README.md) — the TypeScript starter in this repository.
- [Game rules](./rules.md) — high-level rules summary for engine/scoring questions.

If you find a discrepancy between this guide and the schema, or a real
bug in the contract, please file an issue on the sample-bot repository.
