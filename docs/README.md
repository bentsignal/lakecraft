# Lakecraft documentation

This directory contains current architecture, operations, quality, and design
contracts. Code and tests remain the first source of truth for implementation;
these documents preserve non-obvious rationale and repeatable procedures.

## Architecture and hosting

- [Gameplay authority](gameplay-authority-architecture.md) explains the shared
  client core, local authority, Railway authority, and Lakebed control plane.
- [Railway multiplayer server](railway-multiplayer-server.md) covers the world
  server, authentication modes, persistence, administration, and deployment.
- [Railway template](railway-template-overview.md) describes the managed
  community-server experience.

## Production and performance

- [Production operations](production-operations.md) is the fail-closed Lakebed
  capsule release and recovery runbook.
- [Incident containment](incident-containment.md) records the narrow schema and
  deployment safety boundary retained after the accidental cloud experiment.
- [Performance](../PERFORMANCE.md) defines current budgets and the benchmark
  workflow; [benchmark details](performance-benchmark.md) cover the harness.
- [Artifact headroom](artifact-headroom-evidence.md) records the compact-build
  size and reproducibility contract.

## Visual and gameplay quality

- [Minecraft fidelity](../MINECRAFT_FIDELITY.md) defines the current player-facing target.
- [Visual asset pipeline](reference-visual-asset-pipeline.md) and the
  [texture pipeline](../TEXTURE_PIPELINE.md) define provenance and generation.
- [Live visual QA](live-visual-qa.md) is the integrated evidence route.
- [First-person reference](first-person-viewmodel-reference.md),
  [pose tuning](first-person-pose-tuning.md), and
  [held-item references](held-item-pose-references.md) cover viewmodel work.
- [Creative combat QA](creative-combat-qa.md) and
  [mob visual QA](mob-visual-qa-fixture.md) are focused repeatable routes.

## Work tracking

- [Project backlog](backlog.md) is the bounded local list of unresolved work
  recovered during the UAV migration. Completed work belongs in Git and pull
  requests, not in an accumulating task-history document.

Do not add broad session journals or duplicate implementation summaries here.
A new document should capture durable, non-obvious knowledge, link its owning
code or test, and remain at or below the repository's 300-line Markdown limit.
