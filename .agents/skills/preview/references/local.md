# Local development preview

Use this path only for the agent's own active development, browser automation, and fast reloads. It is not a user handoff.

## Start

1. Inspect listeners with `ss -H -ltn`; never assume port 3000 is free.
2. Select an unused port, preferring 3010 and then increasing. Recheck immediately before binding.
3. Start the server from the worktree and keep its execution session alive:

   ```sh
   npx --yes --package lakebed@0.0.29 --package typescript@5.9.3 \
     lakebed dev --port <port>
   ```

4. Verify all three surfaces before reporting success:

   ```sh
   curl --fail --silent --show-error http://127.0.0.1:<port>/ >/dev/null
   curl --fail --silent --show-error 'http://127.0.0.1:<port>/?multiplayer=1' >/dev/null
   curl --fail --silent --show-error http://127.0.0.1:<port>/api/status
   ```

Use the collaborative browser when available to confirm that `/` shows the auth-free title and `/?multiplayer=1` shows the multiplayer sign-in gate.

## Finish

Keep the local URL inside the agent's testing workflow. When the user needs to test the result, stop treating the local server as the preview and follow [hosted.md](hosted.md).
