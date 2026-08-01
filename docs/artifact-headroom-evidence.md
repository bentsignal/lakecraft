# Compact artifact headroom evidence

This branch starts from exact `origin/main` commit
`0935a0c3f23a93c7505c59c68d373c634a35992b`. Its compact client transform
packs the reviewed literal game catalogs into one fingerprinted UTF-8 table.
Fresh sequential A/B builds produced a 985,256-byte compact artifact, leaving
63,320 bytes below Lakebed's 1 MiB ceiling.

## Fresh sequential paired build

```sh
evidence_parent=$(mktemp -d /private/tmp/lakecraft-headroom2-final.XXXXXX)
node scripts/build-lakebed-audit.mjs "$evidence_parent/build-a"
node scripts/build-lakebed-audit.mjs "$evidence_parent/build-b"
```

The candidate pair produced byte-identical outputs:

| Output | A path | B path | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| Artifact | `/private/tmp/lakecraft-headroom2-final-a.xQY8wH/.lakebed/artifacts/lakecraft-headroom2-final-a.xQY8wH.anonymous.json` | `/private/tmp/lakecraft-headroom2-final-b.e5RotN/.lakebed/artifacts/lakecraft-headroom2-final-b.e5RotN.anonymous.json` | 985,256 | `2138de76f367a867e8059f868af7775253efcd6342f5d5a59b5d939210a62108` |
| Client stage | `/private/tmp/lakecraft-headroom2-final-a.xQY8wH/client/index.tsx` | `/private/tmp/lakecraft-headroom2-final-b.e5RotN/client/index.tsx` | 436,002 | `716079add238e54f183220a5bce0a41e8380251c5a442c5d4030cdbc5d86ed44` |
| Server stage | `/private/tmp/lakecraft-headroom2-final-a.xQY8wH/server/index.ts` | `/private/tmp/lakecraft-headroom2-final-b.e5RotN/server/index.ts` | 254,210 | `c0fc95108cf80d170c27f7c4cc40c2ee4c071d563207e3722ab17977e30093d0` |

Exact-main comparison:

- `1,048,576 - 985,256 = 63,320` bytes of headroom.
- `994,292 - 985,256 = 9,036` bytes recovered from exact main.
- The client stage falls from 442,547 to 436,002 bytes; the server stage is
  byte-identical to exact main.

The A/B reports remain outside the stage directories, so Lakebed cannot
accidentally snapshot either report into its artifact. The broad local suite
passed 239/239. A focused transform test additionally imports the transformed
module and deep-compares every block, item, recipe, and smelting recipe against
the source module, including explicit non-ASCII glyph checks. Source-shape and
whole-catalog fingerprint guards fail closed before staging if any reviewed
literal changes. The adversarial checks cover changed mechanical values,
presentation text, recipe text, smelting labels, removed rows, and injected
identifier collisions. An ordinary `npx lakebed build --json` also passed.

This slice changes only deploy tooling, its evidence, and its tests. It does not
touch `client/singleplayer/`, `shared/singlePlayerCloudBackups.ts`, or
`server/index.ts`, so it has no source overlap with the cloud-backup feature.
