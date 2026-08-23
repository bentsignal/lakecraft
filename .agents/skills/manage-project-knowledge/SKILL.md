---
name: manage-project-knowledge
description: Use when adding durable project knowledge, reorganizing documentation, or recording actionable work.
---

# Manage project knowledge

Keep the repository and GitHub as the project's complete source of durable
knowledge and open work.

## Sources of truth

- Treat current code and tests as authoritative for behavior.
- Use Git history and merged pull requests for completed implementation history.
- Use focused documents under `docs/` for non-obvious decisions, constraints,
  and repeatable procedures. Start at `docs/README.md`.
- Use GitHub Issues for actionable work. Do not create local backlogs, session
  journals, task dumps, or duplicate issue lists.

## Documentation

Before adding a note, confirm that it would be expensive to recover from code,
tests, Git, or an existing document. Update the narrowest owning document and
link relevant code, tests, issues, or pull requests. Keep the docs index current
and remove superseded guidance instead of appending a chronology.

After Markdown changes, run:

```sh
node scripts/check-markdown-lines.mjs
```

## Issues

Search open and recently closed issues before recording work:

```sh
gh issue list --state all --limit 100
```

When authorized to mutate GitHub, create one issue per independently actionable
outcome. State the current evidence, scope boundary, and observable acceptance
criteria; add only existing relevant labels. Close or rewrite an issue when the
code or architecture supersedes it rather than preserving stale instructions.
