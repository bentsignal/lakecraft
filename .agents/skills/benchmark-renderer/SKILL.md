---
name: benchmark-renderer
description: Use after changes that could affect frame time, terrain streaming, mesh work, culling, or renderer memory.
---

# Benchmark the renderer

Read `docs/performance/README.md` and `docs/performance/benchmark.md` before
changing renderer, terrain streaming, culling, mesh generation, or frame-loop
behavior.

Compare the same browser, hardware, viewport, seed, and idle/turn/sprint scenes
at render distances 6 and 12. Report frame-time distributions and long frames,
not only averages or isolated microbenchmarks. Keep the deterministic tests and
live behavior as separate evidence, and do not loosen a budget to make a change
pass.
