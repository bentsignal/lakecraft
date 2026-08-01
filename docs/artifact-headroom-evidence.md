# Compact artifact headroom evidence

This branch is rebased onto exact `origin/main` commit
`53a4ee4c2cc6b5e659f67edb6b1d96fa5a602787`. Fresh sequential A/B builds of
that commit produced a 1,014,160-byte compact artifact, leaving 34,416 bytes
below Lakebed's 1 MiB ceiling.

## Fresh sequential paired build

```sh
stage_a=$(mktemp -d /private/tmp/lakecraft-headroom-rebased-a.XXXXXX)
stage_b=$(mktemp -d /private/tmp/lakecraft-headroom-rebased-b.XXXXXX)
node scripts/prepare-lakebed-deploy.mjs "$stage_a"
(cd "$stage_a" && LAKEBED_COMPACT_BUNDLE=1 npx lakebed build --json > /private/tmp/lakecraft-headroom-rebased-report-a.json)
node scripts/prepare-lakebed-deploy.mjs "$stage_b"
(cd "$stage_b" && LAKEBED_COMPACT_BUNDLE=1 npx lakebed build --json > /private/tmp/lakecraft-headroom-rebased-report-b.json)
```

The rebased branch pair produced byte-identical outputs:

| Output | A path | B path | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| Artifact | `/private/tmp/lakecraft-headroom-rebased-a.VvA3ro/.lakebed/artifacts/lakecraft-headroom-rebased-a.VvA3ro.anonymous.json` | `/private/tmp/lakecraft-headroom-rebased-b.gc9AIM/.lakebed/artifacts/lakecraft-headroom-rebased-b.gc9AIM.anonymous.json` | 994,292 | `1addec07f00e90c52c21638c60e65fb947c9457be032983fb3aa40c0023a9d86` |
| Client stage | `/private/tmp/lakecraft-headroom-rebased-a.VvA3ro/client/index.tsx` | `/private/tmp/lakecraft-headroom-rebased-b.gc9AIM/client/index.tsx` | 442,547 | `0d1b98d1ca7ea93744405acf383bbb027ed5a616dda667c1b303dd9d17753a37` |
| Server stage | `/private/tmp/lakecraft-headroom-rebased-a.VvA3ro/server/index.ts` | `/private/tmp/lakecraft-headroom-rebased-b.gc9AIM/server/index.ts` | 254,210 | `c0fc95108cf80d170c27f7c4cc40c2ee4c071d563207e3722ab17977e30093d0` |

Exact-main comparison:

- `1,048,576 - 994,292 = 54,284` bytes of headroom.
- `1,014,160 - 994,292 = 19,868` bytes recovered from exact main.
- `994,292 - 990,000 = 4,292` bytes remain above the conservative branch target.

The A/B reports remain outside the stage directories, so Lakebed cannot
accidentally snapshot either report into its artifact. The broad local suite
passed 238/238 after the rebase. The rebase also converted the newly merged mob
detail payload from base64 to the same reviewed base85 representation: the mob
renderer geometry test and static-data fingerprint/regeneration test prove the
decoded geometry remains exact.
