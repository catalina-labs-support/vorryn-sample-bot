# Vorryn — Rules Summary

Vorryn is an original strategy game in the resource-trading and territory-building genre. This document summarizes mechanics implemented by the engine; it is intentionally a high-level overview, not a player-facing rulebook.

This is the high-level overview. The complete implemented-rules reference — exact costs, the full progress-card catalog, every forced decision — is [`RULES_REFERENCE.md`](./RULES_REFERENCE.md).

## Objective

The first player to reach 13 victory points (VPs) on their own turn wins. VPs come from building, defending the realm, holding the longest road, controlling the merchant, achieving city-improvement metropolises, earning Defender-of-Vorryn tokens, and revealing VP progress cards.

## Components (logical)

- Resource cards: brick, lumber, wool, grain, ore
- Commodity cards: paper, cloth, coin
- Progress cards across three tracks (science, trade, politics)
- Player pieces: roads, settlements, cities, city walls, knights (basic / strong / mighty)
- A robber, a berserker ship, a merchant token
- Two production dice plus one event die

## Setup

Players take two placement rounds (settlement + road, then city + road in reverse order). Initial resources are dealt for hexes adjacent to the second placement. The distance rule applies to all placements.

## Turn Structure

Each turn is three phases:

1. **Roll** — optional pre-roll cards, then roll the production dice and the event die. The event die may advance the berserker ship and may grant a progress-card draw based on city-improvement levels.
2. **Production** — distribute resources and commodities from the rolled number. On a 7, players over the hand limit discard half (rounded down) and the robber moves and steals.
3. **Action** — any number of trades, builds, knight actions, and progress-card plays in any order.

## Trade

Players may freely propose resource and commodity trades with other players. Maritime trade uses 4:1 by default, 3:1 at a generic harbor, and 2:1 at a matching harbor or via the merchant. Commodity trades follow the same ratios.

## Building

Roads, settlements, and cities follow standard placement rules (connectivity, distance, upgrade-in-place). City walls may be added under a city to raise the discard-limit ceiling. Knights occupy intersections, not edges.

## City Improvements

Three independent tracks — science, trade, politics — each consume their matching commodity. Higher levels unlock stronger effects and access to better progress cards. The first player to reach level 4 on a track founds a metropolis there (worth 2 VP, immune to pillage). A second push to level 5 can take a metropolis from another player.

## Knights

Knights are recruited inactive, must be activated, and may then move along the owner's road network. They defend against berserker attacks (active strength is summed against the number of cities on the board), block enemy road expansion, can displace weaker enemy knights, and can chase the robber off an adjacent hex.

## Berserker Attacks

The berserker ship advances on certain event-die outcomes. When it reaches the end of its track it attacks: total active knight strength is compared against the number of cities on the board.

- **Defense wins** — the sole strongest defender earns a Defender-of-Vorryn VP token (+1 VP); ties draw a progress card instead.
- **Defense loses** — the players who contributed the least defense have a city pillaged back to a settlement; metropolises are protected.

After the attack, the ship resets and all knights become inactive.

## Progress Cards

Progress cards are drawn from one of the three track decks based on the event die and the player's improvement level. They have varied effects (build discounts, free placements, monopolies, displacement, targeted steals, hand-pressure penalties). A few are VP cards that are revealed immediately. Hand limit is 4. There is no per-turn cap on the number of progress cards a player may play.

## Winning

If a player has 13 or more VPs at any point during their own turn, the game ends and that player wins. Off-turn VP gains do not end the game immediately, but a player who silently crossed the threshold wins as soon as their next turn begins.

---

_All names, terms, and content here describe Vorryn's own implementation. Vorryn is an independent project and is not affiliated with, endorsed by, or sponsored by any commercial board-game publisher._
