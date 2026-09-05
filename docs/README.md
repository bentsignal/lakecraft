# Lakecraft documentation

Code and tests are authoritative for implemented behavior. These documents
capture the decisions, constraints, and repeatable procedures that are costly to
recover from implementation history.

## Start here

- [Getting started](getting-started.md): local development, play modes, saves,
  and controls
- [Open work](https://github.com/bentsignal/lakecraft/issues): the project task
  backlog

## Architecture

- [Gameplay authority](architecture/gameplay-authority.md): shared client core
  and local/Railway authority adapters
- [Railway multiplayer](architecture/railway-multiplayer.md): hosting,
  persistence, auth, administration, and protocol behavior
- [Railway template](architecture/railway-template.md): generated resources and
  connection steps

## Design

- [Minecraft fidelity](design/minecraft-fidelity.md): player-facing target
- [Visual assets](design/visual-assets.md) and
  [texture pipeline](design/texture-pipeline.md): provenance and generation
- [First-person viewmodel](design/first-person-viewmodel.md),
  [pose tuning](design/first-person-pose-tuning.md), and
  [held-item references](design/held-item-pose-references.md): camera and item
  presentation

## Performance and operations

- [Performance contract](performance/README.md) and
  [benchmark](performance/benchmark.md): budgets and deterministic measurement
- [Artifact headroom](performance/artifact-headroom.md): compact-build evidence
- [Lakebed production](operations/lakebed-production.md): release and recovery
- [Delivery workflows](operations/workflows.md): development review, integrated
  release previews, shared checks, and production records
- [Incident containment](operations/incident-containment.md): retained schema
  safety boundary

## Quality assurance

- [Live visual QA](quality/live-visual-qa/README.md): integrated screenshot,
  motion, and performance evidence
- [Creative combat](quality/creative-combat.md): fast single-player combat route
- [Mob fixture](quality/mob-fixture.md): repeatable mob-renderer inspection

Keep this index small. Add a document only for durable, non-obvious knowledge;
put actionable work in GitHub Issues and completed implementation history in Git
and pull requests.
