# Vorryn — Rules Reference

This is the complete implemented-rules reference for Vorryn, intended for third-party bot developers. It is a companion to the one-page overview [`rules.md`](./rules.md); where that document summarizes mechanics at a high level, this one explains _why_ a given `validActions[]` entry appears, what it costs, and what it yields, so your bot can score it intelligently.

A few ground rules about authority:

- **Wire shapes are canonical.** For the exact JSON structure of every action payload and response, [`bot-protocol.schema.json`](./bot-protocol.schema.json) wins on any disagreement with prose here.
- **The server only ever sends legal candidates.** Vorryn's engine validates every action before it reaches your bot. `validActions[]` contains only moves that are currently legal for `playerId`; your bot cannot break a rule by choosing any entry from that list.
- **Protocol envelope details live elsewhere.** Timeouts, authentication, idempotency, and the HTTP contract are documented in [`BOT_PROTOCOL.md`](./BOT_PROTOCOL.md).

## 1. How to read this document

**Wire tokens** appear in `backticks` exactly as they appear on the wire — action `type` values such as `buildRoad`, pending-decision types such as `discardResources`, and card ids such as `scienceAugury`.

**Progress cards** are referred to by their display name (for example, Augury) with the wire card id noted alongside on first reference in each section.

**Cross-references** like "§10" point at the numbered sections in this document.

**Your bot's perspective.** The request's `playerId` is always the player your bot acts for. Unless noted otherwise, "you" means that player.

**Pending decisions.** When `state.pendingDecision` is non-null, `validActions[]` contains only legal answers to the open decision — your bot must resolve it before doing anything else. See §16 for the full pending-decision catalog.

## 2. Overview & components

The first player to reach the **victory-point target on their own turn** wins — **13 VP** in a standard game, though a game may set a lower target (for example, 8 for short / guest games). The active target is on the wire as `state.victoryPointsTarget` (details §15).

### Resources (5 types)

`brick`, `lumber`, `wool`, `grain`, `ore` — produced by settlements and cities adjacent to matching terrain hexes when the hex's number token is rolled (§6). The bank holds **19 cards of each resource type**; the bank can run dry (§6).

### Commodities (3 types)

`paper`, `cloth`, `coin` — produced exclusively by **cities** (not settlements) adjacent to certain terrain hexes (§6). The bank holds **12 cards of each commodity type**.

### Progress cards (54 total — 18 per deck)

Three decks keyed to city-improvement tracks (§13): `science`, `trade`, `politics`. Cards are drawn when the event die lands on the matching face and your city-improvement level is at least 1 on that track. See §14 for the full card catalog.

### Per-player pieces

Each player starts with the following supply:

| Piece          | Supply |
| -------------- | ------ |
| Roads          | 15     |
| Settlements    | 5      |
| Cities         | 4      |
| City walls     | 3      |
| Basic knights  | 2      |
| Strong knights | 2      |
| Mighty knights | 2      |

### Shared tokens and markers

- **Robber** — starts **inactive** (off the board); it is placed on the desert hex when the first berserker attack resolves (§7, §8.6).
- **Berserker ship** — advances along a 0–7 track on certain event-die outcomes; triggers an attack when it reaches position 7 (§8).
- **Guildmaster marker** (`tradeMerchant`) — awarded by the Guildmaster progress card; gives +1 VP while held, and a 2:1 maritime rate for the resource produced by the hex the marker sits on (§12, §14).

### Dice

Two **production dice** (each 1–6; their sum determines production) plus one **event die** (four outcomes: ship / science / trade / politics). The second production die is the **red die** (`state.dice.redDie`). Improvement level 1 draws on red 1–2, level 2 on 1–3, level 3 on 1–4, level 4 on 1–5, and level 5 on 1–6. Augury sets both production dice, including the red die.

## 3. The board

The board is 19 hexes arranged in a fixed axial layout (5 rows of 3–4–5–4–3 hexes). The hex _types_ and number _tokens_ are shuffled randomly from a fixed pool for each game seed.

### Hex mix

| Terrain   | Count | Resource produced | Commodity produced (cities only) |
| --------- | ----- | ----------------- | -------------------------------- |
| Hills     | 3     | `brick`           | —                                |
| Forest    | 4     | `lumber`          | `paper`                          |
| Mountains | 3     | `ore`             | `coin`                           |
| Fields    | 4     | `grain`           | —                                |
| Pasture   | 4     | `wool`            | `cloth`                          |
| Desert    | 1     | —                 | —                                |

Hills and Fields produce only resources; Forest, Mountains, and Pasture produce a commodity in addition to their resource when a city (not a settlement) is adjacent.

### Number tokens

The 18 non-desert hexes each receive one token drawn from the pool `[2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]`. The desert has no token and never produces.

### Intersections and edges

The standard board has **54 intersections** (build spots for settlements, cities, and knights) and **72 edges** (build spots for roads). Of the edges, **30 are coastal** (sea-facing); harbors are placed on coastal edges only.

### Harbors (9 total)

| Type        | Count | Trade rate                                                |
| ----------- | ----- | --------------------------------------------------------- |
| Generic 3:1 | 4     | Any 3 resources/commodities → 1 of any resource/commodity |
| Brick 2:1   | 1     | 2 `brick` → 1 of any                                      |
| Lumber 2:1  | 1     | 2 `lumber` → 1 of any                                     |
| Ore 2:1     | 1     | 2 `ore` → 1 of any                                        |
| Grain 2:1   | 1     | 2 `grain` → 1 of any                                      |
| Wool 2:1    | 1     | 2 `wool` → 1 of any                                       |

Each harbor spans 2 adjacent coastal intersections. Harbors are never placed on the 6 outermost corner-tip edges, and no two harbors share an intersection. Trade rates are covered in full in §12.

## 4. Setup

### 4.1 First-player determination

Before placement begins, every player rolls two production dice. The player with the highest total sits first in the setup order; ties are broken by rolling again among the tied players, repeating until one player leads outright. A single-player game records one roll and uses that player.

### 4.2 Round 1 — `setup1` phase

Starting with the first player and advancing in ascending seat order, each player takes one turn:

1. Play a `placeSetupBuilding` action, providing an `intersectionId`. The engine places a **settlement** at that intersection (consuming one settlement from supply).
2. The state immediately enters a `placeSetupRoad` pending decision. Play a `placeSetupRoad` action, providing an `edgeId`. The engine places a road on that edge (consuming one road from supply).

After the last-seated player completes step 2, the phase transitions to `setup2`.

### 4.3 Round 2 — `setup2` phase

In **reverse** (snake) order — last seat first, ending with the first player — each player takes one turn following the same two-step sequence. The key difference: the `placeSetupBuilding` action now places a **city** (not a settlement), consuming one city from supply. The city is worth 2 VP and will produce commodities on future production rolls (§6); the setup grant itself (below) pays resources only.

After the first player completes their `setup2` road, the phase transitions to `roll` with `turnNumber = 1`, and the first player is the current player.

### 4.4 Starting resources

Immediately after the `placeSetupRoad` action in round 2 (and only round 2), the engine grants the placing player **one resource card per numbered hex adjacent to the round-2 city**. The terrain type determines which resource: Hills → `brick`, Forest → `lumber`, Mountains → `ore`, Fields → `grain`, Pasture → `wool`. Hexes that have no number token (the desert, and any hex that was left untokened) yield nothing. Each grant is clamped to bank availability — if the bank has fewer cards than the city's adjacencies would entitle, you receive only what the bank holds.

Commodities are **not** granted during setup.

### 4.5 Placement legality

**Distance rule**: a `placeSetupBuilding` target intersection must satisfy both:

- The intersection itself is **empty** — no existing building or knight occupies it.
- No **neighboring** intersection (reachable by crossing one edge) holds a building. A knight alone on a neighboring intersection does **not** block placement.

**Setup road**: the chosen edge must share one of its two endpoint intersections with the building just placed (i.e., the road must touch the new building directly). The edge must also be unoccupied.

### 4.6 Wire flow summary

| Step               | Wire token                        | Notes                                                       |
| ------------------ | --------------------------------- | ----------------------------------------------------------- |
| Building placement | `placeSetupBuilding` action       | One candidate per legal intersection                        |
| Road placement     | `placeSetupRoad` pending decision | Cleared after road is placed                                |
| Phase transition   | —                                 | After final setup2 road: `phase = 'roll'`, `turnNumber = 1` |

## 5. Turn structure

Each turn has two phases your bot interacts with: **roll** (`phase = 'roll'`) and **action** (`phase = 'action'`). Between them the engine resolves production automatically — these internal steps are never exposed to your bot as a separate state.

### 5.1 Roll phase

When `state.phase === 'roll'`, `validActions[]` contains:

- **`rollDice`** — always present; submitting it resolves production and transitions to the action phase.
- **`playProgressCard`** candidates — present only if you hold an Augury (`scienceAugury`) card. Augury has a `preRoll` timing window: playing it before rolling lets you preset both production dice to values of your choice (each 1–6). Only one Augury may be played per turn. See §14 for full Augury rules.

### 5.2 Production (internal — not a bot-facing phase)

After `rollDice` is applied, the engine resolves the roll entirely before returning a new state to your bot:

- If the sum is not 7, resources and commodities are distributed to all players with buildings adjacent to matching number tokens (§6).
- If the sum is 7, discard and robber-placement decisions are queued (§7).
- The event die may trigger a progress-card draw, which can itself force a discard-over-limit decision (§14).
- A berserker-ship event (`ship` face on the event die) may trigger an attack resolution (§8).

When any of these force a decision, your bot receives a state with `state.pendingDecision` non-null and `validActions[]` restricted to the legal answers (see §16). Normal turn flow resumes only after all pending decisions are resolved.

### 5.3 Action phase

When `state.phase === 'action'` and no pending decision is open, `validActions[]` always includes `endTurn`, plus every currently legal move (when a pending decision is open, `validActions[]` contains only that decision's answers — §16):

- **Maritime and domestic trades** — §12
- **Build** road, settlement, city, city wall — §9
- **Knight** actions (recruit, activate, promote, move, displace) — §10
- **City improvement** — §13
- **Progress card plays** (action-phase timing window) — §14

There is **no cap** on how many actions you may take in a single turn, beyond affordability and supply. You may play multiple progress cards, build multiple roads, and make multiple trades in any order, as long as each individual action is legal at the moment you submit it.

`endTurn` is always present among the candidates (even if you have taken no actions). Submitting it advances play to the next player's roll phase, or — if you have too many progress cards in hand — first forces a `discardProgress` pending decision before the turn actually advances.

### 5.4 `resign`

`resign` is a **client/engine meta-action** — it is **never emitted by the enumerator** and therefore **never appears in a bot's `validActions[]`**. A bot cannot resign; the human client submits resign directly outside the normal bot-request cycle. Any phase except `gameOver` is valid; no pending-decision or turn restriction applies. The effect is immediate: the game ends, `phase` becomes `'gameOver'`, and the winner (if unique by strict VP maximum among remaining players) is recorded. See §15 for consequences.

### 5.5 Pending decisions

When `state.pendingDecision` is non-null, **only the pending-decision responses appear in `validActions[]`** — all normal actions are suppressed. The pending decision may belong to a player other than the turn's `currentPlayerId` (e.g., another player must discard resources on a 7, or a Betrothal card (`politicsBetrothal`) collects from opponents). Your bot will only receive a request when `playerId` matches the player whose input is needed. See §16 for the full catalog of pending-decision types.

### 5.6 Bot perspective

Your bot never observes the internal `event`, `production`, or `resolveAttack` phases — the engine resolves them atomically inside `rollDice` before serializing the next state. After `endTurn` the next bot request may already be the next player's roll phase, skipping over your own turn entirely if you are not the next player.

## 6. Dice & production

### 6.1 The dice pool

Every turn begins with a roll of three dice:

- **Two production dice** (each 1–6). Their sum (2–12) is the production number. The second die is the **red die** (`state.dice.redDie`). When Augury presets the production dice, its chosen `die2` is also the red-die result.
- **Event die** — six faces, collapsed into four outcomes:
  - Three faces → `ship` (berserker track +1; see §8)
  - One face → `science`
  - One face → `trade`
  - One face → `politics`

The event die result is exposed on the wire as `state.dice.eventDieResult`.

### 6.2 Event-die progress-card draw

When the event die shows `science`, `trade`, or `politics`, the engine iterates players starting with the current player and awards a progress card from the matching deck to each player who satisfies **both** conditions:

1. The matching city-improvement track is at least level 1; owning a city is not required.
2. The red die is no greater than **track level + 1**: level 1 draws on 1–2, level 2 on 1–3, level 3 on 1–4, level 4 on 1–5, and level 5 on 1–6.

Players who meet both conditions draw the top card of the matching deck. Played and discarded cards go face down beneath their matching deck, so there is no normal discard-pile reshuffle. VP cards (`isVp: true`) reveal immediately into `player.revealedVpCards`; all others enter `player.progressHand`.

After all eligible players draw, any non-current player with more than 4 progress cards in hand is queued for a `discardProgress` pending decision (up to 4 cards is fine; over-limit discards are per-player, in seat order starting from the current player). The current player is exempt from the over-limit check after drawing (§5, §16).

See §13 for city-improvement track levels. See §14 for the full progress-card catalog.

### 6.3 Production payouts

On a non-7 roll, every building adjacent to a hex whose number token matches the roll sum receives a payout — **unless the robber is on that hex** (which blocks the entire hex's production; see §7). Production is computed across all hexes matching the rolled sum simultaneously.

**Settlement adjacent to a hex** → 1 resource card of the hex's type.

**City adjacent to a hex** → depends on terrain:

| Terrain   | Resource grant | Commodity grant |
| --------- | -------------- | --------------- |
| Hills     | 2 `brick`      | —               |
| Fields    | 2 `grain`      | —               |
| Forest    | 1 `lumber`     | 1 `paper`       |
| Mountains | 1 `ore`        | 1 `coin`        |
| Pasture   | 1 `wool`       | 1 `cloth`       |
| Desert    | —              | —               |

Hills and Fields cities receive 2 of their resource (no commodity). Forest, Mountains, and Pasture cities receive 1 resource plus 1 commodity.

### 6.4 Bank-shortage behavior

The bank holds 19 cards of each resource type and 12 cards of each commodity type. When the bank cannot cover all demand for a given card type, the engine applies the following rule **per card type independently**:

- **Single owner of that type:** the player receives however many cards remain in the bank (partial payout — "take as many as remain").
- **Multiple owners of that type and bank cannot satisfy all demand:** no player receives any of that type for this roll (nobody gets it).

A shortage of one type does not affect payouts of other types. Resources and commodities are checked separately.

### 6.5 Science bonus (Aqueduct)

Players with `scienceLevel >= 3` who receive **zero** production from a roll are eligible for the Aqueduct bonus: they choose one resource to take from the bank (`scienceLevel3Bonus` pending decision). This is queued after production resolves, one player at a time in seat order. See §13 for science track details, §16 for the pending-decision format.

### 6.6 Wire fields

| Field                                | Description                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `state.dice.die1`, `state.dice.die2` | Production die values (1–6 each)                                                   |
| `state.dice.sum`                     | Production sum (2–12)                                                              |
| `state.dice.redDie`                  | The second production die; equals `die2` on normal and Augury-preset rolls         |
| `state.dice.eventDieResult`          | `'ship'` \| `'science'` \| `'trade'` \| `'politics'`                               |
| `state.dice.alchemyPreset`           | `true` if Augury overrode the production dice this roll                            |
| `diceHistogram` (BotRequest)         | Cumulative `Record<number, number>` of production-sum tallies for the current game |

The roll outcome arrives as updated `state.dice`; the top-level `recentEvents` field of `BotRequest` carries bounded event history. There is no separate `rollDice` response payload.

## 7. The 7 and the robber

### 7.1 Discard on a 7

When the production sum is 7 there is no production. Instead, every player whose hand exceeds their **discard threshold** must discard half their cards.

The threshold for a player is:

```
threshold = 7 + 2 × (number of city walls that player has built)
```

A player over their threshold must discard `floor(handSize / 2)` cards, where `handSize` counts resources plus commodities together. Players at or below their threshold discard nothing.

All discards are queued simultaneously as a single `discardResources` pending decision (`pending.payload.required` maps player id → required count; `pending.actingPlayerId` is `null`, meaning any listed player may respond). Each player chooses exactly which cards to discard; the response action type is `discardHalf`. The discard is from the player's combined resource+commodity hand; cards go back to the bank.

After all required discards are resolved, the engine moves on to the robber step (if active — see §7.2).

### 7.2 The robber — activation and placement

The robber **starts inactive** (`state.robberActive = false`). While inactive, a 7 triggers discards only — there is no robber placement step. The robber activates on the **first resolved berserker attack** (§8.5), at which point it is placed on the desert hex.

Once active (`state.robberActive = true`), rolling a 7 (after all discards resolve) queues a `chooseRobberHex` pending decision for the **current player**. The player must choose any land hex **other than the hex the robber currently occupies**. The desert is a legal destination. The chosen hex becomes the robber's new location.

The robber blocks the entire production of any hex it occupies: no building adjacent to that hex receives any payout on matching rolls (§6.3).

### 7.3 Steal after robber placement

After the robber moves, the engine resolves a steal:

- **Eligible targets** are players (other than the current player) who have at least one building adjacent to the robber's new hex **and** hold at least one card (`handSize > 0`).
- **0 eligible targets** → no steal; the turn continues.
- **1 eligible target** → the engine automatically steals one random card from that player.
- **2+ eligible targets** → a `chooseStealTarget` pending decision is queued; the current player picks a `targetPlayerId` from `eligiblePlayerIds`.

The stolen card is selected uniformly at random from the target's combined hand: resources first (in enumeration order: `lumber`, `brick`, `wool`, `grain`, `ore`), then commodities (`coin`, `paper`, `cloth`). The selection is seeded by `gameState.seed + ':steal:' + version + ':' + targetId`, making it deterministic for audit purposes but opaque to the thief.

### 7.4 Knight chase (moving the robber without a 7)

During their action phase, the **current player** may use the **chase robber** ability if they own an **active** knight adjacent to the robber's hex. Requirements:

- The robber must be active (`state.robberActive = true`).
- The knight must be in `active` state, must not have acted this turn (`knightActionsUsedThisTurn`), and must not have been activated this turn (`knightsActivatedThisTurn`).
- At least one of the knight's adjacent hex ids must be the hex currently holding the robber.

Submitting `chaseRobber` with the knight's `knightId` deactivates the knight, records the action in `knightActionsUsedThisTurn`, and queues a `chooseRobberDestination` pending decision. The current player then chooses any land hex other than the robber's current location; the desert is legal. After the robber moves, the same steal-resolution flow as §7.3 runs (0/1/many targets).

## 8. The berserker

### 8.1 The berserker track

`state.berserkerTrackPosition` starts at 0 each game. Every time the event die shows `ship`, the track advances by 1. When the track reaches `state.berserkerTrackMax` (always 7), an attack resolves immediately during that roll: the engine first runs the full attack (defense check, any pillage/VP awards, and any pending decisions it queues — §8.4, §8.5), and **then production proceeds normally for that same roll sum** — production is _not_ skipped. If the attack queues a pending decision (`choosePillageCity` or `chooseProgressDeck`), production is deferred until that pending resolves, after which it runs against the same sum. After every attack (win or lose) the track resets to 0.

### 8.2 Berserker strength

Berserker strength equals the **total number of city-type buildings** (cities and metropolises) across all players on the board at the moment of attack:

```ts
const berserkerStrength = Object.values(cityCountByPlayer).reduce((a, b) => a + b, 0);
```

The city count includes every city intersection, including those upgraded to metropolises. Settlements do not contribute.

### 8.3 Defender strength

Defender strength is the sum of strength contributions from every **active** knight across **all players**:

| Knight level | Strength |
| ------------ | -------- |
| Basic        | 1        |
| Strong       | 2        |
| Mighty       | 3        |

Only knights currently in `KnightState.Active` contribute. Inactive or freshly-placed knights do not.

### 8.4 Attack resolution — defense wins

Defense succeeds when **`defenderStrength > 0` AND `defenderStrength >= berserkerStrength`**.

**Sole largest contributor:** the player whose active knights contributed the highest total strength receives 1 Defender-of-Vorryn VP token (`player.vpTokens++`). Victory is checked immediately after the award; if the recipient is the **current player** and this VP is the winning point, the game ends at once. If the recipient is a non-current player, the victory check is deferred: the win triggers as soon as the start of their next turn resolves (§15).

**Tied largest contributors:** when two or more players share the highest contribution, the tie-break behavior is:

- The engine does **not** grant a VP token to any tied player.
- Instead, each tied player is queued (in seat order, starting with the current player) for a `chooseProgressDeck` pending decision. Decks with no cards are excluded; legacy snapshot discard entries also count as recoverable cards.

**The code confirms this is implemented via `chooseProgressDeck` pendings**, one per tied player, not a VP token.

### 8.5 Attack resolution — defense loses

Defense fails only when `defenderStrength < berserkerStrength`; 0 strength successfully defends against 0 barbarian strength. The engine pillages the player(s) with the **lowest** defender contribution among **players who have at least one non-metropolis city**:

- Eligible players: those with at least one non-metropolis city. Metropolis-only players do not establish the minimum contribution.
- Pillaged players: among eligible players, those whose active-knight contribution equals the minimum.

For each pillaged player:

1. **No eligible cities** means all their cities are metropolises. Settlement-piece supply does not make a normal city immune.
2. **Exactly 1 eligible city**: the engine automatically downgrades it to a settlement.
3. **2+ eligible cities**: a `choosePillageCity` pending decision is queued; the affected player picks which city to lose.

Downgrading returns the wall, if any. Normally the city returns to supply and a settlement is placed. If no settlement piece is available, the city piece is turned sideways and functions as a settlement; that exact settlement must be rebuilt before any other settlement can be upgraded.

Losing the last city does **not** discard or return the player's progress-card hand.

If no player has any city at all when the attack resolves (`eligiblePlayerIds.length === 0`), the attack is recorded as a berserker victory with no pillage.

### 8.6 Post-attack bookkeeping

Regardless of outcome, after every attack:

1. **All knights deactivate** — every knight on the board across all players is set to `KnightState.Inactive`.
2. **Track resets** — `state.berserkerTrackPosition = 0`.
3. **First attack:** if `state.firstBerserkerAttackResolved` was `false`, the robber is now activated (`state.robberActive = true`) and placed on the desert hex (or all desert hexes if the board has more than one, though the standard board has exactly one). `state.firstBerserkerAttackResolved` is set to `true`.

### 8.7 Wire fields

| Field                                | Description                                                         |
| ------------------------------------ | ------------------------------------------------------------------- |
| `state.berserkerTrackPosition`       | Current ship-advance count (0–6 between attacks)                    |
| `state.berserkerTrackMax`            | Attack threshold (always 7)                                         |
| `state.firstBerserkerAttackResolved` | `true` once the first attack has happened (robber active)           |
| `state.lastBerserkerAttack`          | Summary record of the most recent attack (null before first attack) |
| `choosePillageCity`                  | Pending type: pillaged player selects which city to downgrade       |
| `chooseProgressDeck`                 | Pending type: tied defender chooses which deck to draw from         |

## 9. Building

### 9.1 Costs and supply

| Piece      | Cost                                          | Supply |
| ---------- | --------------------------------------------- | ------ |
| Road       | 1 `brick` + 1 `lumber`                        | 15     |
| Settlement | 1 `brick` + 1 `lumber` + 1 `grain` + 1 `wool` | 5      |
| City       | 3 `ore` + 2 `grain`                           | 4      |
| City wall  | 2 `brick`                                     | 3      |

Full costs are also listed in the quick-reference table at §17. The Apothecary (`scienceMedicine`) card reduces the city cost to **2 `ore` + 1 `grain`** for one build this turn (§14). The Causeway (`scienceRoadBuilding`) card grants up to 2 free road placements (§14).

### 9.2 Roads (`buildRoad`)

**Wire payload:** `{ "edgeId": "<id>" }`

A road may be placed on any **unoccupied** edge that is **connected to your network**. "Connected" means at least one of the two endpoint intersections allows continuation of your road network. For each endpoint intersection:

1. If you have a **building** at the intersection → connected.
2. If you have a **knight** at the intersection → connected.
3. If the intersection holds **any other piece** (opponent building or opponent knight) → **not connected through** that endpoint (the opponent piece severs the chain).
4. Otherwise (empty intersection) → connected if **any adjacent edge** (other than the candidate edge itself) carries one of your roads.

An opponent building or knight at an endpoint **does block** road-chain continuation through that point; your road can still touch the intersection from the other side if the other endpoint is connected. An enemy piece does not prevent you from placing a road that terminates at that intersection — only from using that intersection as a relay point.

Roads cost 1 `brick` + 1 `lumber`. Supply is checked before the cost — with no roads left in supply the action is never offered. After placement the longest-road holder is always recomputed (§11).

**Causeway free roads:** Playing Causeway (`scienceRoadBuilding`) sets `freeRoadsRemaining` to `min(2, roadsInSupply)` and opens a `roadBuildingPlace` pending only when a legal road placement exists. Each `buildRoad` decrements the count; the pending clears at 0 or when no legal placement remains. A legal placement cannot be voluntarily forfeited.

### 9.3 Settlements (`buildSettlement`)

**Wire payload:** `{ "intersectionId": "<id>" }`

Requirements:

1. **Empty intersection** — no building and no knight (even your own) may occupy the target.
2. **Distance rule** — no **adjacent** intersection (one edge away) may hold a **building** of any owner. A knight alone on a neighboring intersection does **not** block placement.
3. **Road adjacency** — at least one adjacent edge must carry one of your roads. This check does **not** block on opponent pieces at the intersection — it only scans adjacent edges.
4. **Supply** — `settlementsInSupply > 0`.

After placement the longest-road holder is recomputed (a new settlement may sever an opponent's road path; §11).

### 9.4 Cities (`buildCity`)

**Wire payload:** `{ "intersectionId": "<id>" }`

A city upgrades **your own settlement** at the target intersection in-place. Requirements:

1. The intersection must hold your own settlement (`building.ownerPlayerId === actingPlayerId`, `building.type === 'settlement'`).
2. `citiesInSupply > 0`, unless this is the mandatory rebuild of a sideways pillaged city piece.
3. You can afford the normal cost: 3 `ore` + 2 `grain`. Medicine performs its own atomic reduced-cost upgrade (§14).

On apply, the settlement returns to supply and a city piece is consumed. A sideways city-piece settlement instead turns upright without moving either piece in supply. If one exists, it must be rebuilt before another settlement. Victory is checked; longest-road is not recomputed.

### 9.5 City walls (`buildCityWall`)

**Wire payload:** `{ "intersectionId": "<id>" }`

A wall may be added to **your own city** that does not already have one. Requirements:

1. The intersection holds your city (`type === 'city'`, `ownerPlayerId === actingPlayerId`).
2. No wall is present (`cityWallPresent === false`).
3. `cityWallsInSupply > 0`.
4. Cost: 2 `brick`.

Effect: `building.cityWallPresent = true`. Each wall raises your discard threshold by 2 (§7.1). If the city is pillaged by the berserker the wall piece is returned to supply alongside the city piece (§8.5). The Engineering (`scienceEngineering`) progress card builds a wall for free (§14).

## 10. Knights

### 10.1 Tiers and strength

| Level  | Wire value | Strength | Supply per player |
| ------ | ---------- | -------- | ----------------- |
| Basic  | `basic`    | 1        | 2                 |
| Strong | `strong`   | 2        | 2                 |
| Mighty | `mighty`   | 3        | 2                 |

Knight strength is used for berserker defense (§8.3) and displacement comparisons (§10.5).

### 10.2 Recruiting (`recruitKnight`)

**Wire payload:** `{ "intersectionId": "<id>" }`

Cost: 1 `ore` + 1 `wool`. Only a **basic** knight may be recruited; promoting to strong or mighty is a separate action (§10.4).

Requirements:

1. `knightsInSupply[basic] > 0`.
2. The target intersection is **empty** — no building and no knight (`intersection.building === null && intersection.knight === null`).
3. At least one adjacent edge carries **your road**.

The recruited knight is placed in **`inactive`** state. If the new knight's intersection is adjacent to any edge carrying an opponent's road, the longest-road holder is recomputed (the placement may interrupt an opponent's path; §11).

### 10.3 Activating (`activateKnight`)

**Wire payload:** `{ "knightId": "<id>" }`

Cost: 1 `grain`. Changes an `inactive` knight to `active` and records the knight id in `knightsActivatedThisTurn`.

A knight added to `knightsActivatedThisTurn` **cannot act this turn** — any act attempt (move, displace, chase) is rejected if the knight appears in that list, even though it is now active. It may contribute to berserker defense immediately (§8.3), and it may still be promoted.

### 10.4 Promoting (`promoteKnight`)

**Wire payload:** `{ "knightId": "<id>" }`

Cost: 1 `ore` + 1 `wool`. Each knight may be promoted at most once per turn — promoting several different knights in the same turn is legal (`knightPromotionsUsedThisTurn` records knight ids).

| From   | To     | Additional requirement                                 |
| ------ | ------ | ------------------------------------------------------ |
| Basic  | Strong | `knightsInSupply[strong] > 0`                          |
| Strong | Mighty | `politicsLevel >= 3` AND `knightsInSupply[mighty] > 0` |

On apply: the old-tier supply counter increments (the knight token returns) and the new-tier counter decrements. The knight's `level` field updates in-place. A knight may be promoted regardless of its `active`/`inactive` state.

### 10.5 Moving (`moveKnight`)

**Wire payload:** `{ "knightId": "<id>", "intersectionId": "<destinationId>" }`

A knight may move if:

1. The knight is `active`.
2. It has **not** been activated this turn (`knightsActivatedThisTurn` does not include its id).
3. It has **not** acted this turn (`knightActionsUsedThisTurn` does not include its id).
4. The destination is **empty** — no building and no knight of any owner.
5. The destination is **reachable** via BFS along your own roads from the knight's current position.

**BFS traversal rules:**

- The BFS expands only along edges whose `roadOwnerPlayerId` equals your id.
- Starting from the knight's current intersection (always included in the visited set), the BFS visits neighbors across your roads.
- When the BFS reaches an intersection other than the start that is **opponent-occupied** (has an opponent building or opponent knight), that intersection is added to the visited set but traversal does **not** continue beyond it. Opponent-occupied intersections are reachable endpoints for displacement but are blocked for normal move destinations (the destination check rejects occupied intersections for `moveKnight`).
- Your own pieces at an intersection do not block traversal; the BFS passes through freely.

**Concrete example:** If your knight is at intersection A, and B and C (adjacent to A along your roads) are opponent-occupied, and D (reachable via an alternate path through empty neighbors) is empty, then `moveKnight` to D is legal. Moving to B or C is illegal — the BFS reaches them but the destination check rejects any occupied intersection, even one that the BFS can reach.

After moving: the knight deactivates (`state = inactive`), its position updates, and the knight id is recorded in `knightActionsUsedThisTurn`. Longest road is recomputed if either the source or destination intersection is adjacent to any opponent road edge (`intersectionAffectsLongestRoad`; §11).

### 10.6 Displacing (`displaceKnight`)

**Wire payload (initial):** `{ "knightId": "<attackerId>", "intersectionId": "<targetId>" }`

Your knight may displace an **opponent** knight at a reachable intersection if your knight's strength is **strictly greater** than the target's. Reachability uses the same BFS as `moveKnight` but the target intersection need not be empty (the opponent knight is there). The displacing player's knight must satisfy the same act-eligibility checks (active, not activated this turn, not acted this turn).

On apply:

1. Your knight moves to the target intersection (deactivates, records in `knightActionsUsedThisTurn`).
2. The displaced knight's owner must retreat it along **their own** road network from the target intersection. The retreat BFS runs **after** your knight is placed on the target (so the target is not treated as free). `reachableEmptyIntersections` is used — only intersections that are empty of both buildings and knights qualify.
3. **0 retreat options** → the displaced knight is returned to its owner's supply.
4. **1 retreat option** → the engine places it automatically.
5. **2+ retreat options** → a `chooseKnightRetreat` pending decision is queued for the **displaced knight's owner** (not the displacing player). The owner responds with `displaceKnight` carrying their chosen `intersectionId` (from `pendingDecision.payload.eligibleIntersectionIds`).

The displaced knight is re-placed with its **original activation state** — an active knight remains active after retreating; only the attacking knight deactivates (step 1).

The longest-road holder is recomputed after displacement and again after retreat resolves (§11). Victory waits until the displaced knight completes any mandatory retreat, because the retreat may break the route again. The same applies to Intrigue (`politicsIntrigue`).

### 10.7 Other knight interactions

- **Berserker defense** — §8.3. All knights deactivate after every berserker attack regardless of who acted (§8.6).
- **Chase robber** — §7.4. Costs the knight's action for the turn.
- **Conspiracy (`politicsIntrigue`)** — displaces an opponent knight adjacent to your road network without consuming a knight action of your own (§14).
- **Treason** — removes a target player's chosen knight and optionally places one of your own (§14).
- **Tempering** — promotes up to 2 of your knights for free (§14).
- **Encouragement** — activates all your knights for free (§14). Knights activated by Encouragement are added to `knightsActivatedThisTurn` and therefore **cannot act** this turn.
- **Settlement placement** — a knight on an intersection blocks settlement placement there (§9.3), but a knight on a **neighboring** intersection does not block placement.
- **Longest road** — an opponent knight at an intersection breaks your road path through that intersection (§11).

## 11. Longest road

### 11.1 Overview

The player who holds the longest road receives **+2 VP** (`state.longestRoadHolderPlayerId`). A road must be at least **5 segments** long to qualify (`LONGEST_ROAD_MIN = 5`). The bonus is recalculated after any event that might change road lengths (§11.4).

### 11.2 Computation

Longest road is computed per-player by a DFS over that player's road edges. For each of the player's roads, the DFS starts from both endpoint intersections and counts the longest non-backtracking path.

**Interruption rule**: when the DFS reaches an intersection that is **opponent-occupied** (an opponent building or an opponent knight), the DFS **stops and does not continue** through that intersection. The path may count the edge that arrived at the opponent-occupied intersection, but cannot extend further through it.

Concretely:

- An opponent piece (building or knight) at an intersection **severs** your road path through it — the DFS backtracks rather than traversing across it.
- The path **can end** at an opponent-occupied intersection (the arriving edge is counted), but **cannot pass through** it.
- Your own pieces (buildings, knights) at an intersection do **not** interrupt your path; the DFS continues normally.

### 11.3 Holder and transfer rules

After recomputation:

1. If no player's longest road reaches `LONGEST_ROAD_MIN` (5), `longestRoadHolderPlayerId` is set to `null` — the bonus is unclaimed.
2. If exactly one player has the strictly longest road among all players, they become the holder.
3. If multiple players share the maximum length (a tie):
   - If the **current holder** is among the tied players, they **retain** the bonus (ties keep the holder).
   - If the current holder is **not** among the tied players (or there is no current holder), `longestRoadHolderPlayerId` is set to `null` — the bonus becomes unclaimed. No new holder is assigned until one player takes a clear lead.

The holder cannot fall below 5 and keep the bonus — once the maximum drops below 5, the holder is cleared unconditionally.

### 11.4 Recompute triggers

The longest-road holder is recomputed after:

| Action            | Notes                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `buildRoad`       | Always — new road may extend the builder's chain or create a new maximum                                     |
| `buildSettlement` | Always — new settlement may interrupt an opponent's path through that intersection                           |
| `recruitKnight`   | Only if the placed knight's intersection is adjacent to any opponent road (`intersectionAffectsLongestRoad`) |
| `moveKnight`      | If source or destination is adjacent to any opponent road                                                    |
| `displaceKnight`  | Always (both displacement and retreat resolution)                                                            |

`buildCity` and `buildCityWall` do **not** trigger recomputation (neither changes road topology or intersection occupancy relative to other players' roads).

## 12. Trade

### 12.1 Domestic trade (player-to-player)

Domestic trade lets the current player exchange cards with opponents without going through the bank.

**Who may propose:** only the current player (`currentPlayerId`). Opponents may not initiate. Bank trades are maritime only (§12.2).

A player may issue at most 5 domestic-trade proposals per turn (`MAX_DOMESTIC_TRADE_PROPOSALS_PER_TURN`); the engine rejects further proposals with a rule violation. Candidate generation additionally applies its normal per-decision truncation budget.

**Proposal payload shape** (`domesticTradePropose`):

```json
{
  "offer": [{ "type": "<MaterialType>", "count": <positive int> }, ...],
  "want":  [{ "type": "<MaterialType>", "count": <positive int> }, ...],
  "targetPlayerId": "<playerId>"   // optional — omit to broadcast to all opponents
}
```

Both `offer` and `want` are arrays of `{ type, count }` items. `MaterialType` covers both resources and commodities — both sides may include commodities. Each array must be non-empty. No duplicate types within a side, and no type may appear in both sides. The proposer must hold at least the offered quantity. `targetPlayerId` must be an existing player other than the proposer; if omitted the proposal is broadcast to all opponents.

**Response flow:**

1. `domesticTradePropose` creates a `DomesticTradeResponse` pending targeting all opponents (or one named target). Its payload always carries the complete current shape: `{ auctionId, offer, want, bids, passedPlayerIds, targetPlayerId? }`.
2. Any responder may submit `domesticTradeBid` or `domesticTradePass`. A bid states terms from the **proposer's perspective**: `offer` is what the proposer would give, while `want` is what the responder would give. Matching the proposal is an at-terms bid; different terms are a modified bid.
3. Each responder has one standing answer. A new bid replaces that responder's previous bid or pass, and a pass replaces their previous bid. Repeating the identical standing answer is rejected as a no-op. Revisions remain available while the auction is open.
4. The pending stays a `DomesticTradeResponse` throughout. The proposer may award any standing bid immediately, without waiting for every opponent. If every responder passes and no bid stands, the auction cancels automatically. A targeted at-terms bid is awarded immediately because there is no competing responder to choose.
5. The proposer resolves a remaining auction by awarding one standing bid (`domesticTradeAward` with `bidResponderId` plus an `offer`/`want` echo of that bid's terms) or cancelling (`domesticTradeCancel`). The awarded bid's own terms execute atomically, with both parties' holdings re-validated at resolution time; an award whose echoed terms no longer match the standing bid (revised since the proposer read it) is rejected.
6. `domesticTradeCancel` withdraws the open proposal at any point while the pending is active. Only the current player may cancel.

An un-taken counter is not recorded as a decline.

The proposer is the pending's `actingPlayerId` and is not a member of `allowedPlayerIds`, which contains responders only.

**Responder bid candidates.** With the counter family enabled (production human tables), a responder's enumerated bids are: the at-terms bid (the former accept), **sweetened bids** — the proposal's own terms plus one extra card on the want side, so the responder pays one more to outbid a rival acceptance without composing a full counter — and the bounded derived-adjustment counters. A sweetener increments an existing want line rather than duplicating its type, never uses a type already on the offer side (no type may appear on both sides), and is emitted only when the responder can pay the whole augmented want side, so the family is bounded by the material-type count.

**Award ranking is a public partial order.** Bid A _dominates_ bid B only when the proposer gives the same multiset and A gives the proposer a strict superset of what B does; bids with different give sides are incomparable and no public rule orders them. A bot proposer applies its hard eligibility gates first — it can pay the bid's give side, the responder is not within two victory points of winning (unless the bot itself is one point away and racing), and the bid clears its value floor — and only then drops dominated bids. So a strictly-dominant eligible bid always beats a plain eligible acceptance, while an **ineligible** dominant bid is still refused; a near-win responder cannot buy an award by sweetening. Bids that remain incomparable are separated by the bot's own private valuation, which is never sent to responders and never presented as an objective ranking.

**Decline records:** fully-declined proposals (all opponents declined, no acceptances) push a `DomesticTradeDeclineRecord` onto `state.domesticTradeDeclinesThisTurn`. Each record holds `{ proposerId, targetPlayerId?, offer, want }`. The enumerator reads these records to avoid re-generating identical 1-for-1 proposals to the same opponent that already declined; instead it generates a 2-for-1 sweetened bid for that target — offering 2 of the same material in exchange for 1 of the wanted type. If the proposer holds 3 or more of the offered material and the wanted type is on a "build-path" shortlist, a 3-for-1 escalation is also generated. Proposals that were never declined continue to generate the standard 1-for-1 candidate (plus higher-count variants when the enumerator's escalation option is on). Candidate generation is grouped per exact terms: when at least two opponents could fulfill the complete ask (and were not already asked those terms this turn), the enumerator emits ONE broadcast (targetless) candidate instead of per-target copies; exactly one qualifying opponent keeps the targeted form, and zero emits nothing. On the public-safe external list the fulfill check is disabled, so broadcast presence is uniform for tables with two or more opponents and encodes no hidden holdings.

**Candidate truncation:** the `DomesticTradePropose` family is generated with a global cap of `MAX_GENERATED_CANDIDATES = 96` and a reserved subcap for richer bundle candidates (want-2 or mixed-surplus offers, off by default). When the family exceeds the cap, `truncatedFamilies` gains `'domesticTradePropose'` and `validActionsTruncated` is set on the wire response.

### 12.2 Maritime trade (with the bank)

Maritime trade lets the current player exchange cards with the bank at a negotiated rate.

**Payload shape** (`maritimeTrade`):

```json
{
  "offer": { "type": "<MaterialType>", "count": <rate * quantity> },
  "want":  { "type": "<MaterialType>", "count": <quantity> }
}
```

Both counts must be positive integers. `offer.count` must equal the player's best applicable rate for `offer.type` multiplied by `want.count`; for example, receiving 2 cards at a 2:1 rate costs 4 offered cards. Offer and want types must differ. Both resources and commodities may be offered; both resources and commodities may be requested. Bank stock is checked: the requested type must have at least `want.count` in `bankResources` or `bankCommodities` (§6).

**Rate hierarchy**:

| Condition                                                                                                 | Rate |
| --------------------------------------------------------------------------------------------------------- | ---- |
| Base (no applicable perk)                                                                                 | 4:1  |
| Player has a building on a 3:1 harbor intersection                                                        | 3:1  |
| Player has a building on a 2:1 resource-specific harbor, and `offer.type` matches                         | 2:1  |
| Player's `tradeLevel >= 3` and `offer.type` is a commodity                                                | 2:1  |
| Player played Galleon (`tradeMerchantFleet`) this turn and `offer.type` is in `player.merchantFleetTypes` | 2:1  |
| Player holds the Guildmaster marker (`tradeMerchant`) on a hex whose resource matches `offer.type`        | 2:1  |

All applicable rates are evaluated simultaneously; the minimum applies. Harbor ownership is determined by having a building (settlement or city) on any of the harbor's `intersectionIds`. The 3:1 harbor reduces all types to 3:1; the 2:1 commodity-track perk applies only when the offered card is a commodity. Each Galleon (`tradeMerchantFleet`) play adds its chosen type to `merchantFleetTypes` for the rest of the turn — multiple Galleons stack, one 2:1 type each; the list is cleared at turn advance. The Guildmaster hex rate applies only if `state.merchantOwnerPlayerId === actingPlayerId` and `state.merchantHexId !== null` and the hex produces the offered resource type (commodity hexes that also produce a resource match on the resource, not the commodity).

## 13. City improvements & metropolises

### 13.1 Improving a city

**Action:** `improveCity`. Requires no pending decision. Requires the acting player to own at least one city.

**Payload:** `{ "track": "science" | "trade" | "politics" }`

**Cost:** `(currentLevel + 1)` commodities of the track's matching commodity, paid from hand. Crane performs one selected improvement atomically for 1 fewer commodity (minimum 0); it does not discount a later `improveCity` action.

Track-to-commodity mapping:

- Science → Paper
- Trade → Cloth
- Politics → Coin

**Level cap:** maximum level is 5 (`MAX_TRACK_LEVEL`).

**Cost table:**

| Current level | Base cost     | With Mason discount |
| ------------- | ------------- | ------------------- |
| 0             | 1 commodity   | 0                   |
| 1             | 2 commodities | 1                   |
| 2             | 3 commodities | 2                   |
| 3             | 4 commodities | 3                   |
| 4             | 5 commodities | 4                   |

### 13.2 Track perks

Perks activate once the player reaches the listed level. They persist until the level drops (metropolis loss does not decrease the track level — the level field stays, only the metropolis marker is removed).

**Science track**

- Level 3: On any non-7 production roll where the player receives zero resources or commodities (determined by before/after diff — robber-blocked counts as zero-production), a `scienceLevel3Bonus` pending is queued for that player. Via `chooseScienceBonusResource` with payload key `resource`, the player picks one resource. Multiple eligible players are queued in seat order starting from the current player.

**Trade track**

- Level 3: commodities the player offers in maritime trade receive a 2:1 rate. See §12.2.

**Politics track**

- Level 3: knights may be promoted to the mighty tier. Basic→strong promotions have no track requirement; strong→mighty promotions require `politicsLevel >= 3`.

### 13.3 Metropolis

**Trigger:** reaching level 4 (`METROPOLIS_TRIGGER_LEVEL`) on a track causes a metropolis transfer if the acting player is not already the holder, or if there is no holder yet.

**Transfer condition:** a transfer occurs if the current holder is `null` (no one holds it yet), or if the current holder is a different player whose track level is strictly less than the acting player's new level.

- Level 4 achiever vs no holder → transfer.
- Level 4 achiever vs level-4 holder → **no transfer** (current holder keeps it; tied level does not displace).
- Level 5 achiever vs level-4 holder → transfer (5 > 4).
- Level 5 achiever vs level-5 holder → **no transfer** (5 is not greater than 5; the existing holder keeps it).

**Placement:** if the acting player has more than one eligible city, a `ChooseMetropolisCity` pending is set, offering `eligibleIntersectionIds` (non-metropolis cities only — `b.metropolisType === null`). The player places the metropolis on one of their own cities. If exactly one eligible city exists, the pending is still created with a single-element list.

**If the holder is displaced:** the previous holder's building's `metropolisType` is set to `null` before the new `ChooseMetropolisCity` pending is created. The previous holder's track level is unchanged.

**VP value:** a city with a metropolis marker is worth 4 VP total (2 city + 2 metropolis bonus). Metropolises are immune to pillage (§8.5).

**Invariant:** at most one metropolis marker per track.

**Max level 5:** the maximum level of 5 can be reached by improving beyond 4. A level-5 holder beats a level-4 holder. Two level-5 holders are a tie — the first to reach 5 retains the marker. There is no mechanism to exceed level 5 (`MAX_TRACK_LEVEL`).

### 13.4 Event-die card draw and track levels

The event die triggers progress-card draws. Owning a city is not required: a positive track level draws when the red die is at most that level plus 1. See §6.2 for the complete draw flow.

## 14. Progress cards

Three decks of 18 (total **54 progress cards**, **18 per deck**), one deck per commodity track: science, trade, politics.

### Drawing

On each roll, if the event die shows a commodity-track face, every player with a positive matching level draws when the red die is at most that level plus 1. Cards are drawn in seat order starting from the current player.

VP cards (`scienceAnnals`, `politicsCharter`) reveal immediately on draw: they go into `revealedVpCards` (not `progressHand`) and award +1 VP; `checkVictory` runs immediately.

`chooseProgressDeck` pendings are queued in two situations:

- **Berserker defense tie** (§8): when multiple players contribute equally the highest knight strength and the defense succeeds, each tied defender chooses which deck to draw from.
- **All-decks-exhausted guard**: if `deckHasCards` returns false for all three decks, the draw queue collapses immediately with no draw.

### Deck exhaustion

Played and forcibly discarded cards go face down beneath their matching deck immediately. The `progressDiscard*` fields remain only for legacy snapshot compatibility and are not populated by current play.

### Hand limit

Maximum hand size is **4** (`PlayerState.MAX_PROGRESS_HAND`). When a non-current player exceeds the limit after a draw, a `discardProgress` pending fires immediately (one player at a time). The current player's excess is handled at `endTurn` — if `progressHand.length > 4`, an `endTurn` attempt installs a `discardProgress` pending with `resumeAfter: EndTurn`.

VP cards live in `revealedVpCards`, not `progressHand`, and do not count against the limit.

### Playing

Play is routed through `PlayProgressCard` (action-phase or pre-roll). Every candidate in `validActions[]` already carries a full payload validated by `tryValidatePlayProgressCard`; your bot selects one without constructing payloads. A `skip: true` payload allows the card to be played with no benefit. Afterward, the card instance moves from `progressHand` beneath the matching deck.

No per-turn cap: a player holding two copies of any card may play both in one turn. The one timing restriction is **Augury** — it is playable only before rolling and only once per turn (the engine checks `progressCardsPlayedThisTurn` for `'scienceAugury'` before allowing a second play).

Cards whose effects produce multi-step interactions install a `pendingDecision`; that pending is resolved via `ResolveOptionalCardEffect` before the next free action. VP cards cannot be played or stolen.

---

### Science deck

#### Augury — `scienceAugury` (science, ×2)

**Window:** roll phase, before rolling (once per turn). **Payload:** `instanceId`, `die1` (1–6), `die2` (1–6).

The player chooses both production dice values. The chosen `die2` is the red die and controls progress-card eligibility; only the event die is rolled randomly. This is the only pre-roll card.

No pendings triggered. Cannot be played if `scienceAugury` already appears in `progressCardsPlayedThisTurn`.

---

#### Mason — `scienceMason` (science, ×2)

**Window:** `actionPhaseWithBuild`. **Payload:** `{}` (no payload parameters read at play time).

The card play itself builds one selected city improvement for 1 fewer matching commodity than normal (minimum 0). It does not arm a discount for a later action.

No pendings triggered.

---

#### Engineering — `scienceEngineering` (science, ×1)

**Window:** `actionPhase`. **Payload:** `intersectionId`.

Builds a free city wall on the player's own city at `intersectionId`. Requires the target to be an own city without an existing wall and at least one city wall in supply. Consumes one city-wall piece from supply.

No pendings triggered. If no own unwalled city exists, no candidate is generated.

---

#### Geomancer — `scienceGeomancer` (science, ×2)

**Window:** `actionPhase`. **Payload:** `hexAId`, `hexBId`.

Swaps the number tokens on two non-Desert, non-protected hexes. Protected tokens are 2, 6, 8, and 12 (as defined in `PROTECTED_NUMBER_TOKENS`). Both hexes must have a number token and neither may be the Desert. The board's number-token index is invalidated after the swap so subsequent production calculations reflect the new arrangement.

No pendings triggered. The robber does not move.

---

#### Aqueducts — `scienceIrrigation` (science, ×2)

**Window:** `actionPhase`. **Payload:** `{}`.

Grants 2 grain per distinct Fields hex adjacent to any of the player's own buildings (settlements or cities). The count is based on unique adjacent hex IDs across all own buildings. Resources are drawn from the bank (subject to bank stock).

No pendings trigger. With no adjacent Fields hex, the card may still be played for no benefit.

---

#### Apothecary — `scienceMedicine` (science, ×2)

**Window:** `actionPhaseWithBuild`. **Payload:** `{}` (no payload parameters read at play time).

The card play itself upgrades the selected settlement for 2 ore + 1 grain. It does not arm a discount for a later build. A sideways pillaged city may be rebuilt this way even with no city in supply.

No pendings triggered.

---

#### Delving — `scienceMining` (science, ×2)

**Window:** `actionPhase`. **Payload:** `{}`.

Grants 2 ore per distinct Mountains hex adjacent to any of the player's own buildings (settlements or cities). The count is based on unique adjacent hex IDs across all own buildings. Resources are drawn from the bank (subject to bank stock).

No pendings trigger. With no adjacent Mountains hex, the card may still be played for no benefit.

---

#### Tempering — `scienceTempering` (science, ×2)

**Window:** `actionPhase`. **Payload:** `{}` (no payload parameters read at play time; the card play payload itself carries no knight selection).

Installs a `smithingPromote` pending with `promotionsRemaining: 2`. The player then resolves up to two free knight promotions one at a time via `ResolveOptionalCardEffect`. Each promotion step reads `knightId` (singular) from the resolution payload, or `skip: true` to end early. Promotion is subject to the normal one-promotion-per-knight-per-turn rule and requires politics level ≥ 3 to promote to Mighty.

**Pending:** `smithingPromote` (self; up to two resolution steps, each consuming one from `promotionsRemaining`).

With no promotable knight, the card may still be played for no benefit.

---

#### Causeway — `scienceRoadBuilding` (science, ×2)

**Window:** `actionPhase`. **Payload:** `{}`.

Grants up to 2 free road placements. When at least one legal placement exists (an unoccupied edge connected to the player's network), sets `player.freeRoadsRemaining = min(2, roadsInSupply)` and installs a `roadBuildingPlace` pending; otherwise no pending is installed. Road placements then proceed exactly as paid `buildRoad` actions (each road must be legally connected when placed). If only 1 road remains in supply, only 1 free road is granted.

The player must place the free roads while legal placements and pieces remain.

**Pendings:** `roadBuildingPlace` (self; repeated until `freeRoadsRemaining` reaches 0 or no legal placement remains).

If no road can be placed, the card may still be played for no benefit.

---

#### Annals — `scienceAnnals` (science, ×1)

**Window:** `immediateOnDraw` (VP card). **No play action.**

Revealed immediately when drawn into `revealedVpCards`. Awards +1 VP. Cannot be played, discarded, or stolen. Does not count against the hand limit. `checkVictory` runs at the moment of draw.

---

### Trade deck

#### Wharfage — `tradeCommercialHarbor` (trade, ×2)

**Window:** `actionPhase`. **Payload:** `{}` (no parameters; the initiator chooses per-step).

Activates a turn-long list of opponents. At any later point that turn, the player may offer one resource to each opponent at most once. Offers are normal action-phase `resolveOptionalCardEffect` actions with `targetPlayerId` and `giveResourceType`, so other actions may occur between offers.

If the target holds a commodity, `commercialHarborGive` asks that target which commodity to return. If the target holds none, the resource stays with the initiator and that opponent's one offer is consumed.

**Pending:** `commercialHarborGive` only for the target's mandatory commodity choice.

The card may be played with no resources or no immediately useful target; resources acquired later that turn may still be offered.

---

#### Tribute — `tradeTribute` (trade, ×2)

**Window:** `actionPhase`. **Payload:** `targetPlayerId` (the chosen opponent). The enumerator emits one candidate per eligible opponent.

Targets one opponent with strictly more VP than the actor. The actor takes exactly 2 resource and/or commodity cards, or every card if fewer than 2 are held, via a `guildDuesChooseCards` pending.

**Pending:** `guildDuesChooseCards` (actor; `cards` must total exactly `min(2, target.handSize())`; it cannot be skipped).

An empty-handed higher-VP opponent is still a legal no-benefit target.

---

#### Guildmaster — `tradeMerchant` (trade, ×6)

**Window:** `actionPhase`. **Payload:** `hexId`.

Places the Guildmaster marker on any **land hex**, including the desert, adjacent to at least one of the player's own buildings. Re-placing it on the same hex is legal even if that produces no benefit. The controlling player gains +1 VP while they hold it.

No pendings triggered.

---

#### Galleon — `tradeMerchantFleet` (trade, ×2)

**Window:** `actionPhase`. **Payload:** `chosenType` (a resource or commodity type string).

Grants a 2:1 bank exchange rate for any named resource or commodity for the remainder of this turn. The type need not currently be held, and naming an already-active type is still a legal no-benefit play.

No pendings triggered.

---

#### Levy — `tradeResourceMonopoly` (trade, ×4)

**Window:** `actionPhase`. **Payload:** `resourceType`.

Takes up to 2 of the named resource from each other player directly (player-to-player transfer, bank bypassed). Each opponent gives `min(2, their count)` of that resource to the actor. Only resource types held by at least one opponent are offered as payload candidates; if no opponent holds any resource the card is fully suppressed.

No pendings triggered.

---

#### Embargo — `tradeTradeMonopoly` (trade, ×2)

**Window:** `actionPhase`. **Payload:** `commodityType`.

Takes exactly 1 of the named commodity from each other player who holds at least 1 (player-to-player transfer, bank bypassed). Players with 0 of that commodity give nothing. Only commodity types held by at least one opponent are offered as payload candidates; if no opponent holds any commodity the card is fully suppressed.

No pendings triggered.

---

### Politics deck

#### Diplomacy — `politicsDiplomacy` (politics, ×2)

**Window:** `actionPhase`. **Payload:** `edgeId`.

Removes any open road from the board, returning it to its owner's supply. A road is open if it has an owner (`roadOwnerPlayerId` is non-null) and at least one of its two endpoints is open for that owner: the endpoint has no own building, no own knight, and no other own road continuing from it (i.e., the owner's road network dead-ends there). Longest-road and victory are rechecked after removal.

If the removed road belonged to the actor, the actor has roads in supply, and at least one legal road placement exists (an unoccupied edge connected to the actor's network), a free road placement is granted immediately: `freeRoadsRemaining = 1` and a `roadBuildingPlace` pending is installed. With no legal placement available — e.g. the removed road was the actor's only network anchor — no pending is installed.

**Pending:** `roadBuildingPlace` (self; only when the actor's own road was removed and a legal free placement exists).

If no open road exists, the card may still be played for no benefit.

---

#### Encouragement — `politicsEncouragement` (politics, ×2)

**Window:** `actionPhase`. **Payload:** `{}`.

Activates all of the player's inactive knights simultaneously. Each knight transitions from `Inactive` to `Active`; its id is added to `knightsActivatedThisTurn`.

No pendings trigger. With no inactive knight, the card may still be played for no benefit.

---

#### Espionage — `politicsEspionage` (politics, ×3)

**Window:** `actionPhase`. **Payload:** `targetPlayerId` (at play time; card selection is made during the `espionageChooseCard` pending).

Targets one opponent who holds at least one progress card in hand. An `espionageChooseCard` pending is installed; the actor then picks one eligible card by `targetInstanceId`, or sends `resolveOptionalCardEffect` with `skip: true` to decline the steal.

The stolen card is spliced out of the target's `progressHand` and pushed onto the actor's `progressHand`. VP cards can never be stolen — they reveal on draw and never sit in a hand.

**Pending:** `espionageChooseCard` (actor; payload key `targetInstanceId`).

If no opponent holds a progress card, the card may still be played for no benefit.

---

#### Conspiracy — `politicsIntrigue` (politics, ×2)

**Window:** `actionPhase`. **Payload:** `targetKnightId`.

Displaces a single opponent knight standing on an intersection adjacent to any of the actor's own roads, without consuming a knight action. The target knight is removed from its intersection; the engine computes retreat options via `reachableEmptyIntersections`. If retreat is possible, the target knight's owner resolves a retreat pending; if no retreat is possible, the knight is simply removed. Longest-road and victory are rechecked.

No additional pendings from the actor's side. (The retreating knight owner resolves their own pending if one is queued.)

If no eligible opponent knight exists, the card may still be played for no benefit.

---

#### Sabotage — `politicsSabotage` (politics, ×2)

**Window:** `actionPhase`. **Payload:** `{}`.

Forces every opponent whose VP is ≥ the actor's VP to discard half their hand (resource + commodity cards only, rounded down). A `discardResources` pending is installed for all affected opponents simultaneously (source tagged `sabotage`). Players with a hand size of 1 discard 0 and are excluded.

**Pending:** `discardResources` (all affected opponents simultaneously; `source: 'sabotage'`).

If no opponent must discard, the card may still be played for no benefit.

---

#### Taxation — `politicsTaxation` (politics, ×2)

**Window:** `actionPhase`. **Payload:** `hexId`.

Moves the robber to `hexId` (must differ from its current position; robber must already be active — i.e., after the first berserker attack has been resolved). Then steals 1 random resource or commodity card from each distinct opponent who owns a building adjacent to the new robber hex. Each steal is processed independently via `stealRandom`.

No pendings triggered. Unplayable before the robber is placed (before the first berserker attack), or if `hexId` equals the current robber hex.

---

#### Treason — `politicsTreason` (politics, ×2)

**Window:** `actionPhase`. **Payload:** `targetPlayerId`.

Targets an opponent who has at least one knight on the board. The target player must choose which of their knights is removed (if they have more than one). If the target has exactly one knight, it is removed immediately without a pending.

After the knight is removed:

- The actor may optionally place one of their own knights of equal or lesser strength at an intersection adjacent to their own road network, inheriting the removed knight's active/inactive status.
- If the actor has no eligible knight in supply, the placement step is skipped.

**Pendings:**

- `treasonChooseKnight` (target player; payload key `targetKnightId` — only queued when the target owns > 1 knight).
- `treasonPlaceKnight` (actor; payload keys `intersectionId`, `level`; or `skip: true` to decline).

Longest-road and victory are rechecked after the knight is removed and again after placement.

---

#### Betrothal — `politicsBetrothal` (politics, ×2)

**Window:** `actionPhase`. **Payload:** `{}`.

Each opponent with strictly more VP than the actor and a non-empty hand must give 2 resource or commodity cards of their choice to the actor (or as many as they hold if fewer than 2). Givers are processed one at a time via `weddingGiveCards` pendings; each gives exactly `min(2, handSize)` cards.

**Pending:** `weddingGiveCards` (one giver at a time; payload key `cards` — array of `{ type, count }`; the giver must give exactly `requiredCount` total).

If no higher-VP opponent can give cards, the card may still be played for no benefit.

---

#### Charter — `politicsCharter` (politics, ×1)

**Window:** `immediateOnDraw` (VP card). **No play action.**

Revealed immediately when drawn into `revealedVpCards`. Awards +1 VP. Cannot be played, discarded, or stolen. Does not count against the hand limit. `checkVictory` runs at the moment of draw.

---

## 15. Victory

### 15.1 VP sources

| Source                               | VP            |
| ------------------------------------ | ------------- |
| Settlement on the board              | 1             |
| City on the board (no metropolis)    | 2             |
| City with a metropolis marker        | 4 total       |
| Longest road bonus (§11)             | +2 while held |
| Guildmaster marker (§12, §14)        | +1 while held |
| Each revealed VP progress card (§14) | +1 each       |
| Each Defender-of-Vorryn token (§8)   | +1 each       |

### 15.2 Win condition

**Reaching the VP target wins** — 13 in a standard game, but configurable per game via `state.victoryPointsTarget` (for example, 8 for short / guest games). Victory is checked only for `state.currentPlayerId` at the end of every applied action — off-turn VP gains (a Defender-of-Vorryn token from a berserker defense, a longest-road transfer away from another player, or an opponent drawing a VP card) do **not** immediately end the game. The player wins automatically when their next turn begins: `advanceTurn` calls `checkVictory` after switching `currentPlayerId`, so a player who silently crossed the target during someone else's turn wins as soon as the first action of their own turn resolves (which may be as early as the phase-transition into their roll phase).

On a win: `state.phase` transitions to `'gameOver'` and `state.winnerPlayerId` is set to the winning player's id.

### 15.3 `resign`

Any player may submit `resign` in **any** phase except `gameOver` — it is not conditional on it being their turn or on there being no open pending decision.

Winner determination after a resign: the player with the **strictly highest** VP total among all non-resigning players becomes `winnerPlayerId`. In the event of a tie among those players, `winnerPlayerId` is left `null` (no winner credited).

The game immediately transitions to `phase = 'gameOver'` and `pendingDecision` is cleared.

### 15.4 Bot visibility at gameOver

Once `phase === 'gameOver'`, `validActions[]` is empty — no further actions are legal for any player. Your bot will not receive any new requests after the game ends. The final state (with `winnerPlayerId` set, or `null` on a tied resign) is terminal.

## 16. Forced decisions

When `state.pendingDecision` is non-null, `validActions[]` contains **only** the legal answers to the open decision. Your bot must resolve it before anything else. Each pending decision has an `allowedPlayerIds` array; only a player whose id appears in that list may answer.

### Queue semantics

There is a single `state.pendingDecision` slot — at most one decision is active at a time. When a chain of decisions is needed (e.g., multiple players must discard after Sabotage), the engine processes them **one at a time in sequence**: the first decision is installed, resolved, then the next is installed. Caller logic in the service layer threads the "next in queue" as continuation data inside the pending payload (`remainingPlayerIds`, `resumeAfter`, etc.) so the apply path knows what to install next.

### `allowedPlayerIds`

When `allowedPlayerIds` has more than one entry (e.g., `discardResources` after a 7 where several players must discard), **any** player in the list may respond — they each reduce their own obligation. The `actingPlayerId` field on the pending may be `null` (meaning "any listed player"), or may name a specific player when only one is allowed to answer.

### `resolveOptionalCardEffect`

The action type `resolveOptionalCardEffect` is the generic answer vehicle for a set of card-generated pending decisions. When the active pending type is one of `weddingGiveCards`, `commercialHarborGive`, `guildDuesChooseCards`, `smithingPromote`, `treasonChooseKnight`, `treasonPlaceKnight`, or `espionageChooseCard`, the `validActions[]` entry uses action type `resolveOptionalCardEffect` with a payload tailored to that specific pending type (see §14 and the table below for payload keys).

### Full pending-decision catalog

The 20 pending-decision types, their triggers, which player must answer, and the legal answer action(s):

| Pending type              | Triggered by                                                                                                                                                              | Who answers                                                                                                                          | Legal answer(s)                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discardResources`        | Production roll of 7 (§7.1) or Sabotage card (`politicsSabotage`, §14)                                                                                                    | Each player listed in `allowedPlayerIds` (one at a time or simultaneously per the multi-player discard flow)                         | `discardHalf` with exact resource/commodity cards to discard                                                                                                      |
| `chooseRobberHex`         | Rolling 7 when robber is active, after all discards resolve (§7.2)                                                                                                        | Current player                                                                                                                       | `chooseRobberHex` with `hexId` of the destination hex                                                                                                             |
| `chooseStealTarget`       | Robber placed on a hex with 2+ eligible adjacent building owners (§7.3)                                                                                                   | Current player (or the chasing player for `chaseRobber`)                                                                             | `chooseStealTarget` with `targetPlayerId`                                                                                                                         |
| `scienceLevel3Bonus`      | Non-7 roll producing zero resources/commodities for a player with `scienceLevel >= 3` (§6.5, §13.2)                                                                       | Each eligible player (one at a time, seat order from current)                                                                        | `chooseScienceBonusResource` with `resource`                                                                                                                      |
| `chooseMetropolisCity`    | Reaching improvement level 4 or 5 and triggering a metropolis transfer (§13.3)                                                                                            | The player gaining the metropolis                                                                                                    | `chooseMetropolisCity` with `intersectionId` of own non-metropolis city                                                                                           |
| `choosePillageCity`       | Berserker attack loss when affected player has 2+ pillage-eligible cities (§8.5)                                                                                          | The pillaged player                                                                                                                  | `choosePillageCity` with `intersectionId` of the city to downgrade                                                                                                |
| `chooseProgressDeck`      | Berserker defense tie (§8.4), or all-decks-exhausted collapse guard (§14)                                                                                                 | Each tied defender (one at a time)                                                                                                   | `chooseProgressDeck` with `deck` (`'science'`, `'trade'`, or `'politics'`)                                                                                        |
| `discardProgress`         | Non-current player exceeds 4 progress cards after a draw (§6.2, §14), or current player ends turn with more than 4 progress cards (§5.3)                                  | The over-limit player                                                                                                                | `discardProgress` with the `instanceId`(s) of cards to discard (exact `requiredCount` must be discarded)                                                          |
| `chooseKnightRetreat`     | Displacement (`displaceKnight` or Conspiracy card) when displaced knight has 2+ valid retreat intersections (§10.6)                                                       | The displaced knight's owner                                                                                                         | `displaceKnight` with `intersectionId` from `eligibleIntersectionIds`                                                                                             |
| `chooseRobberDestination` | `chaseRobber` — an active knight chases the robber (§7.4)                                                                                                                 | The chasing player                                                                                                                   | `chaseRobber` with `hexId` of the destination hex                                                                                                                 |
| `placeSetupRoad`          | After each `placeSetupBuilding` action during setup phases (§4)                                                                                                           | The current player (setup placer)                                                                                                    | `placeSetupRoad` with `edgeId` adjacent to the building just placed                                                                                               |
| `weddingGiveCards`        | Betrothal card (`politicsBetrothal`, §14)                                                                                                                                 | Each richer opponent in sequence (one at a time)                                                                                     | `resolveOptionalCardEffect` with `cards` array of `{ type, count }` to give; must total exactly `requiredCount`                                                   |
| `commercialHarborGive`    | Commercial Harbor offer to a target who holds a commodity                                                                                                                 | The target                                                                                                                           | `resolveOptionalCardEffect` with the target's chosen `commodityType`                                                                                              |
| `guildDuesChooseCards`    | Guild Dues card (`tradeTribute`, §14) — actor selects from target's hand                                                                                                  | **Actor** (the card player, not the target) chooses which cards to take                                                              | `resolveOptionalCardEffect` with `cards` totaling exactly `maxCards`                                                                                              |
| `smithingPromote`         | Tempering card (`scienceTempering`, §14)                                                                                                                                  | The card player                                                                                                                      | `resolveOptionalCardEffect` with `knightId` per free promotion, or `skip: true` to stop; up to 2 steps                                                            |
| `treasonChooseKnight`     | Treason card (`politicsTreason`, §14) when target has **2+ knights** on the board                                                                                         | The **target player** (picks which of their own knights is removed)                                                                  | `resolveOptionalCardEffect` with `targetKnightId`                                                                                                                 |
| `treasonPlaceKnight`      | After `treasonChooseKnight` resolves (or immediately when target has 1 knight), if actor has eligible knight in supply                                                    | The **actor** (card player)                                                                                                          | `resolveOptionalCardEffect` with `intersectionId` and `level`; or `skip: true` to decline placement                                                               |
| `roadBuildingPlace`       | Causeway card (`scienceRoadBuilding`, §14), or Diplomacy card (`politicsDiplomacy`, §14) when actor's own road is removed — only installed while a legal placement exists | The card player                                                                                                                      | `buildRoad` with `edgeId`; `skipRoadBuilding` is only a defensive escape if no placement survives                                                                 |
| `domesticTradeResponse`   | `domesticTradePropose` (§12.1)                                                                                                                                            | Each targeted opponent may bid or pass; the proposer awards a standing bid or cancels — an open auction, no separate confirm pending | Responders: `domesticTradeBid`, `domesticTradePass`. Proposer: `domesticTradeAward` (`bidResponderId` + term echo) or `domesticTradeCancel` (current player only) |
| `espionageChooseCard`     | Espionage card (`politicsEspionage`, §14)                                                                                                                                 | The **actor** (card player) selects which of the target's non-VP cards to steal                                                      | `resolveOptionalCardEffect` with `targetInstanceId`; or `skip: true` to decline the steal                                                                         |

## 17. Appendix: quick reference

### Build & piece costs

| Action            | Cost                                  |
| ----------------- | ------------------------------------- |
| `buildCity`       | 3 ore + 2 grain                       |
| `buildSettlement` | 1 brick + 1 lumber + 1 grain + 1 wool |
| `buildRoad`       | 1 brick + 1 lumber                    |
| `recruitKnight`   | 1 ore + 1 wool                        |
| `activateKnight`  | 1 grain                               |
| `promoteKnight`   | 1 ore + 1 wool                        |
| `buildCityWall`   | 2 brick                               |

### Limits & thresholds

| Limit                                 | Value |
| ------------------------------------- | ----- |
| Victory points to win                 | 13    |
| Longest-road minimum                  | 5     |
| Progress-card hand limit              | 4     |
| Discard threshold (base)              | 7     |
| Discard threshold bonus per city wall | +2    |
| Resource bank stock (per type)        | 19    |
| Commodity bank stock (per type)       | 12    |
| Improvement track maximum level       | 5     |
| Metropolis trigger level              | 4     |

_"Victory points to win" is the standard target; a game may set a lower one (e.g. 8 for short / guest games). The active value is on the wire as `state.victoryPointsTarget` (§2, §15.2)._

### Per-player piece supply

| Piece              | Supply                        |
| ------------------ | ----------------------------- |
| Roads              | 15                            |
| Settlements        | 5                             |
| Cities             | 4                             |
| City walls         | 3                             |
| Knights (per tier) | 2 basic / 2 strong / 2 mighty |

### Action index

All 33 action types and the section(s) where they are documented:

| Action type                  | Section(s)                                             |
| ---------------------------- | ------------------------------------------------------ |
| `rollDice`                   | §5, §6                                                 |
| `endTurn`                    | §5                                                     |
| `resign`                     | §5, §15 (meta-action; never in bot's `validActions[]`) |
| `placeSetupBuilding`         | §4                                                     |
| `placeSetupRoad`             | §4, §16                                                |
| `buildRoad`                  | §9                                                     |
| `buildSettlement`            | §9                                                     |
| `buildCity`                  | §9                                                     |
| `buildCityWall`              | §9                                                     |
| `improveCity`                | §13                                                    |
| `recruitKnight`              | §10                                                    |
| `promoteKnight`              | §10                                                    |
| `activateKnight`             | §10                                                    |
| `moveKnight`                 | §10                                                    |
| `displaceKnight`             | §10                                                    |
| `chaseRobber`                | §7                                                     |
| `chooseRobberHex`            | §7                                                     |
| `chooseStealTarget`          | §7                                                     |
| `discardHalf`                | §7                                                     |
| `choosePillageCity`          | §8                                                     |
| `chooseProgressDeck`         | §8, §14                                                |
| `chooseMetropolisCity`       | §13                                                    |
| `chooseScienceBonusResource` | §13                                                    |
| `domesticTradePropose`       | §12                                                    |
| `domesticTradeBid`           | §12                                                    |
| `domesticTradePass`          | §12                                                    |
| `domesticTradeAward`         | §12, §16                                               |
| `domesticTradeCancel`        | §12                                                    |
| `maritimeTrade`              | §12                                                    |
| `playProgressCard`           | §14                                                    |
| `discardProgress`            | §14, §16                                               |
| `resolveOptionalCardEffect`  | §14, §16                                               |
| `skipRoadBuilding`           | §14                                                    |

---

_All names, terms, and content here describe Vorryn's own implementation. Vorryn is an independent project and is not affiliated with, endorsed by, or sponsored by any commercial board-game publisher._
