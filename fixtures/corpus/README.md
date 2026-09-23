# Captured request provenance

`self-play.ndjson.gz` contains 250 redacted requests from 13 completed games,
regenerated on 2026-09-22 using the current engine and existing capture instrument,
after opponents' hands became `materialCount` + `progressHandByDeck` (the physical
table's view) under `protocolVersion: 3`. The engine/policy base revision was `29e6a93f1`; the exporter
also includes this change's full request-schema check before publishing a row.
No policy settings or recorded event numbers were edited to repair the artifact.

From `bot/` in the main repository:

```sh
pnpm exec tsx scripts/export-request-corpus.ts --games 14 --every 3 --max 250 --per-game 20 --min-candidates 2 --seed-offset 0 --out ../examples/sample-bot/fixtures/corpus/self-play.ndjson.gz
```

The compressed artifact's SHA-256 is
`56c9fdfdf0f7e596ccedae32a886b6f2092e55659d8f2f44094b13882c77ee59`.
It contains 8,993 recent-event entries; every request passes the current complete
wire schema, every recorded decision belongs to its supplied candidates, and each
game has an official winner. The main repository tests enforce the 250-row,
13-game populations and full wire-schema compatibility. The earlier artifact had
164 rows containing event sequence zero, which the current HTTP protocol rejects.

`../http-corpus.json` is a separate four-case HTTP regression set. Its requests are
unchanged historical captures from the **earlier** compressed artifact at revision
`4331c3a3f291341771927a9cab0b45da745019a6`, SHA-256
`783007622f2b1792eddb7b3ba795dcc484e2cced890307919a105c1856e0f447`.
All four individually pass the current complete schema. Their opponent entries were
migrated in place to `materialCount` + `progressHandByDeck`: the per-deck counts
were chosen as the first split the unseen-pool arithmetic accepts, since the
captures predate per-deck counts. Each case records that
revision, digest, game and sequence so refreshing the larger corpus does not
silently change its provenance:

| Family         | Source game  | Sequence | Candidates | Request bytes |
| -------------- | ------------ | -------: | ---------: | ------------: |
| Action         | self-play-1  |       49 |         71 |        49,934 |
| Discard        | self-play-11 |       58 |         30 |        43,121 |
| Proposer award | self-play-2  |       58 |          3 |        41,859 |
| Responder bid  | self-play-7  |       58 |         14 |        43,033 |

The small set pins the current bundled policy's literal decisions and diagnostic
shape through real HTTP handlers. Those labels establish a regression baseline;
they are not claims of optimal play or evidence of strength against people.
