import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const entry = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const transport = readFileSync(new URL("../client/singleplayer/SinglePlayerCloudTransport.tsx", import.meta.url), "utf8");
assert.match(entry, /getIdentity\(\)[\s\S]*?Boolean\(identity\.userId \|\| identity\.expired\)/,
  "the synchronous identity check is above the single-player subtree");
assert.match(app, /authState \? <SinglePlayerCloudIdentityBoundary/,
  "the hook-bearing boundary is conditionally instantiated by its hook-free parent");
assert.doesNotMatch(app, /\b(?:useAuth|useQuery|useMutation)\b/,
  "the single-player parent stays hook/transport free for guests");
assert.equal((transport.match(/\buseQuery</g) ?? []).length, 1, "signed-in child owns one reactive query");
assert.equal((transport.match(/\buseMutation</g) ?? []).length, 1, "signed-in child owns one mutation hook");
assert.match(transport, /controller\[6\] = \(\) => \{[\s\S]*?void mutation\(/,
  "the current scheduler closure owns mutation while its deadline lifecycle remains stable");
assert.match(transport, /!auth\.isLoading && \(!auth\.isAuthenticated \|\| auth\.isGuest\)[\s\S]*?reload/,
  "auth loss tears down through sign-out and hard reload");
assert.match(transport, /result\[3\]\.length/, "any server quarantine suppresses automatic upload");
assert.match(transport, /parseRestorableSinglePlayerCloudBackupWire\(value\);[\s\S]*?if \(!remote\) return schedule\(300_000\);[\s\S]*?candidates/,
  "any client-semantic quarantine returns before candidate selection or mutation");
assert.match(transport, /isLocalWorldRegistryTransactionReadOnly/, "uncertain local registry state suppresses upload");
assert.match(transport, /type Controller = [\s\S]*?Map<string, Marker>[\s\S]*?useRef<Controller>/,
  "mounted-session refs remain authoritative when durable storage writes fail");
assert.match(transport, /anchor \? anchor\[0\] \+ Date\.now\(\) - anchor\[1\]/,
  "server time is anchored to elapsed client time instead of freezing at the query timestamp");
assert.match(transport, /<SignedInCloud key=\{auth\.userId\}/,
  "identity changes remount and isolate every per-user session cache");
assert.match(transport, /candidates\.push\(\[world, prepared\.backup\]\)/,
  "the exact stable tuple checked for ancestry is dispatched without a TOCTOU reread");
assert.match(transport, /if \(!disabled && remote\?\.\[7\] === prepared\.backup\[1\]\)/,
  "an exact stale remote cannot overwrite the durable delete tombstone with fresh lineage");
assert.doesNotMatch(transport, /signInWithGoogle|SignInWithGoogle/,
  "single-player guests never see a sign-in prompt from cloud backup code");

console.log("single-player cloud synchronous identity and hook containment tests passed");
