import { resolve } from "node:path";
import { runAuditBuild } from "./lakebed-build-transaction.mjs";

const args = process.argv.slice(2);
if (args.length !== 1 || !args[0] || args[0].startsWith("-")) {
  throw new Error("Usage: node scripts/build-lakebed-audit.mjs <new-evidence-directory>");
}

const result = await runAuditBuild({
  outputRoot: args[0],
  sourceRoot: resolve(process.cwd()),
});
console.log(JSON.stringify(result, null, 2));
