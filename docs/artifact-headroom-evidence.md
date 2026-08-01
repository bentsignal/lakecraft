# Compact artifact headroom evidence

This branch starts from exact `origin/main` commit
`c2330092bfa2a44333d049dbd3142d5d33eee3fd`. Its compact client transform
packs the reviewed literal game catalogs into one fingerprinted UTF-8 table.
Fresh sequential A/B audit builds produced a 986,753-byte compact artifact,
leaving 61,823 bytes below Lakebed's 1 MiB ceiling.

## Fresh sequential paired build

```sh
evidence_parent=$(mktemp -d /private/tmp/lakecraft-headroom2-final.XXXXXX)
node scripts/build-lakebed-audit.mjs "$evidence_parent/build-a"
node scripts/build-lakebed-audit.mjs "$evidence_parent/build-b"
```

The candidate pair produced byte-identical, inert evidence outputs. The build
transaction deleted each full artifact after verification and retained only its
redacted metadata record and noncanonical staged-source snapshots:

| Output | A path | B path | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| Redacted artifact metadata | `$evidence_parent/build-a/artifact-metadata.json` | `$evidence_parent/build-b/artifact-metadata.json` | 648 | `b57b19dc7196d32dbf3452815d9082195ec2c92b67203228f5528badbfc5f9fa` |
| Client stage | `$evidence_parent/build-a/staged/client-index.tsx` | `$evidence_parent/build-b/staged/client-index.tsx` | 436,002 | `716079add238e54f183220a5bce0a41e8380251c5a442c5d4030cdbc5d86ed44` |
| Server stage | `$evidence_parent/build-a/staged/server-index.ts` | `$evidence_parent/build-b/staged/server-index.ts` | 254,672 | `2666dbc1a486d66ad057e4ab5bec859f4e4f810660c174966e2ddd2297331a87` |

The redacted metadata records the independently verified full-artifact
measurements without retaining deployable payload bytes:

- Artifact size: 986,753 bytes.
- Headroom: `1,048,576 - 986,753 = 61,823` bytes.
- Full-artifact SHA-256:
  `dc2f144dac23c4a8c73fc834e0f0e5e5fbdac6e3495b59efd2358e12b8fd1694`.
- Lakebed artifact hash:
  `sha256:fe253e95ec04cf2f1ea2536e7b926450ca7b8dd2e666b74ccf89a94d927fd948`.

The A/B reports and exported evidence remain outside the staged payload, so
Lakebed cannot snapshot them into its artifact. Focused transform tests import
the transformed module and deep-compare every block, item, recipe, and smelting
recipe against the source module, including explicit non-ASCII glyph checks.
Source-shape and whole-catalog fingerprint guards fail closed before staging if
any reviewed literal changes. The adversarial checks cover changed mechanical
values, presentation text, recipe text, smelting labels, removed rows, and
injected identifier collisions. An ordinary Lakebed build also passed.

This slice changes only deploy tooling, its evidence, and its tests. It does not
touch `client/singleplayer/`, `shared/singlePlayerCloudBackups.ts`, or
`server/index.ts`, so it has no source overlap with the cloud-backup feature.
