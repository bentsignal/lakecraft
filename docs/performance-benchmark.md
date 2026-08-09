# Browser performance benchmark

The development build includes a deterministic 25-second browser benchmark for
Lakecraft's main gameplay loop. It creates seed `7319`, warms up for two seconds,
then measures five seconds idle, five seconds turning through 360 degrees, and
15 seconds sprint-flying forward through newly streamed chunks.

Run the two render-distance controls from a local `npx lakebed dev` server:

```text
http://localhost:3100/?singleplayer=1&performance=1&distance=6
http://localhost:3100/?singleplayer=1&performance=1&distance=12
```

No input is required. When the page says `complete`, the complete JSON result is
shown on screen, logged as `LAKECRAFT_PERFORMANCE_RESULT`, exposed as
`window.__lakecraftPerformanceResult`, and marked by
`document.documentElement.dataset.lakecraftBenchmark === "complete"` for browser
automation. The harness is stripped from compact production builds.

Compare results only on the same browser, hardware, viewport, and device pixel
ratio. For a release comparison, run each distance three times and compare the
median run. Treat idle, turn, and sprint separately: a fast idle average must
not hide streaming stalls.

## Apple M4 / Chromium 151 reference results

Recorded August 9, 2026 at 1280×720 CSS/device pixels, DPR 1, on the ANGLE Metal
Apple M4 renderer. The control is commit `2b37ab2`; the candidate changes only
the streaming schedule while preserving the generated world and render path.

| Distance | Phase | Metric | Control | Candidate |
| ---: | --- | --- | ---: | ---: |
| 6 | sprint | mean FPS | 73.113 | 74.704 |
| 6 | sprint | 1% low FPS | 31.847 | 52.840 |
| 6 | sprint | p95 frame ms | 15.1 | 14.9 |
| 6 | sprint | frames over 25 ms | 24 | 2 |
| 6 | sprint | worst frame ms | 54.8 | 38.5 |
| 12 | sprint | mean FPS | 67.835 | 74.305 |
| 12 | sprint | 1% low FPS | 29.388 | 38.735 |
| 12 | sprint | p95 frame ms | 26.7 | 15.0 |
| 12 | sprint | frames over 25 ms | 95 | 3 |
| 12 | sprint | worst frame ms | 78.8 | 79.8 |

Idle and turn p95 remained 14.8–14.9 ms in both candidates and both distances.
The isolated maximum at distance 12 did not improve, so maximum-frame latency
remains tracked separately from the large steady-state streaming improvement.

## Reference regression gates

On this reference machine, a candidate needs all of the following in the median
of three runs at each distance:

- idle and turn p95 no higher than 16.7 ms;
- sprint p95 no higher than 16.7 ms;
- sprint 1% low at least 45 FPS at distance 6 and 35 FPS at distance 12;
- no more than 6 sprint frames over 25 ms at distance 6 or 9 at distance 12;
- no more than a 5% regression in mean sprint FPS or mean update time.

The JSON also records update, render, terrain-streaming, and per-frame mesh-work
time; pending load/unload/mesh queues; draw calls; visible/loaded chunks; world
vertices; block count; and the final pose. These counters are diagnostic: the
frame-time distribution is the performance source of truth.
