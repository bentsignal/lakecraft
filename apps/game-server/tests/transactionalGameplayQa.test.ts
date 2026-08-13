import { expect, test } from "bun:test";

test("fresh two-client gameplay scenario conserves every item across world transactions", async () => {
  const process = Bun.spawn(["bun","run","apps/game-server/scripts/transactional-gameplay-qa.ts"], {
    cwd:new URL("../../..",import.meta.url).pathname,
    stdout:"inherit",
    stderr:"inherit",
  });
  expect(await process.exited).toBe(0);
},15_000);
