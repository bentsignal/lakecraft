# Compact artifact headroom evidence

This branch starts from exact `origin/main` commit
`88ba5b3b1c94f73385101caffeb88783cf2ec479`. The exact-main compact artifact
baseline was 1,014,192 bytes (34,384 bytes of the 1 MiB ceiling remained).

## Fresh sequential paired build

After the client property, private CSS/DOM identifier, and server mechanics-only
catalog changes (including the `Yq0` through `Yq3` prefix-collision guard), run:

```sh
stage_a=$(mktemp -d /private/tmp/lakecraft-headroom-review-a.XXXXXX)
stage_b=$(mktemp -d /private/tmp/lakecraft-headroom-review-b.XXXXXX)
node scripts/prepare-lakebed-deploy.mjs "$stage_a"
(cd "$stage_a" && LAKEBED_COMPACT_BUNDLE=1 npx lakebed build --json > /private/tmp/lakecraft-headroom-review-report-a.json)
node scripts/prepare-lakebed-deploy.mjs "$stage_b"
(cd "$stage_b" && LAKEBED_COMPACT_BUNDLE=1 npx lakebed build --json > /private/tmp/lakecraft-headroom-review-report-b.json)
```

The fresh review pair produced these byte-identical outputs:

| Output | A path | B path | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| Artifact | `/private/tmp/lakecraft-headroom-review-a.rkKwqd/.lakebed/artifacts/lakecraft-headroom-review-a.rkKwqd.anonymous.json` | `/private/tmp/lakecraft-headroom-review-b.9GGXbr/.lakebed/artifacts/lakecraft-headroom-review-b.9GGXbr.anonymous.json` | 1,004,392 | `7c26d0aafe114b3cf889108b44e7fc89afef84516136b8e4e427432631fd1f5e` |
| Client stage | `/private/tmp/lakecraft-headroom-review-a.rkKwqd/client/index.tsx` | `/private/tmp/lakecraft-headroom-review-b.9GGXbr/client/index.tsx` | 443,887 | `ca92ea045583d32c0f695401273fe0ebabecc402a365240b61d4571119f81e24` |
| Server stage | `/private/tmp/lakecraft-headroom-review-a.rkKwqd/server/index.ts` | `/private/tmp/lakecraft-headroom-review-b.9GGXbr/server/index.ts` | 260,432 | `a9f6156c4f4b3b187b44683335445b42a43ca8c3ab8c11b46607117de4fa7598` |

Arithmetic at this checkpoint:

- `1,048,576 - 1,004,392 = 44,184` bytes of headroom.
- `1,014,192 - 1,004,392 = 9,800` bytes recovered from exact main.
- `1,004,392 - 990,000 = 14,392` bytes still required to reach the branch target.

Build reports are outside the stage directories so Lakebed cannot accidentally
snapshot the report file into either artifact.
