---
name: preview
description: Use when the user asks to preview Lakecraft live, and after each completed revision in an established hosted-preview review cycle.
---

# Preview Lakecraft

Choose the workflow based on who will open it:

- For the agent's own browser checks during active development, read [references/local.md](references/local.md).
- Whenever the user will test the work, read [references/hosted.md](references/hosted.md) and publish a public HTTPS Lakebed preview.

Keep local servers inside the agent's own testing workflow. Follow only the selected reference, verify the result, and report the public Lakebed URL when the user will test it.

## Review handoff

When the user asks to review work through a hosted Lakebed preview, treat that as an active review cycle for the current task. After each completed revision in that cycle:

1. Refresh the existing worktree preview with the hosted workflow.
2. Verify the deployed result.
3. Summarize the revision and present the preview URL again, even when the URL did not change.

Do not wait for the user to repeat the publish request. Reuse the existing worktree preview while it is valid; the publisher will replace it if it has expired.

Do not publish incomplete work or infer a review cycle from an ordinary implementation request. Production releases use the `deploy-lakebed` skill instead.
