import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const entry = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const transport = readFileSync(new URL("../client/singleplayer/SinglePlayerCloudTransport.tsx", import.meta.url), "utf8");

assert.match(entry, /useState\(\(\) => \{\s*const identity = getIdentity\(\)/);
assert.match(entry, /function joinSingleplayer[\s\S]*?getIdentity\(\)[\s\S]*?setCloudIdentityCandidate/);
assert.match(app, /cloud=\{authState \? <SinglePlayerCloudIdentityBoundary storage=\{storage\} title \/>/);
assert.match(app, /activeWorld[\s\S]*?authState \? <SinglePlayerCloudIdentityBoundary storage=\{storage\} \/>/);
assert.doesNotMatch(app, /\b(?:useAuth|useQuery|useMutation)\b/);
assert.equal((transport.match(/\buseQuery</g) ?? []).length, 1);
assert.equal((transport.match(/\buseMutation</g) ?? []).length, 1);
assert.match(transport, /auth\.isAuthenticated && !auth\.isGuest\s*\? <SignedInCloud/);
assert.doesNotMatch(transport, /signInWithGoogle|SignInWithGoogle|\bsignOut\b|location\.reload|window\.location/);

assert.match(transport, /const enum ACTION \{ DELETE, RESTORE, RESUME, RECOVER, RESUME_ALL \}/);
assert.match(transport, /const enum STATUS \{ CHECKING, READY, CURRENT, UPLOADING, OFFLINE, QUOTA, CAPACITY, QUARANTINE, AUTH \}/);
assert.match(transport, /type Controller = \[[\s\S]*?Map<string, Marker>[\s\S]*?DeletePending \| null\]/,
  "compact tagged controller retains mounted lineage and pending-delete authority");
assert.match(transport, /controller\[4\] = true[\s\S]*?mutate\(request\)/,
  "automatic and manual calls acquire the same mutation fence");
assert.match(transport, /if \(controller\[4\]\) return/);
assert.match(transport, /if \(state\[3\]\) \{ setStatus\(STATUS\.QUARANTINE\); return schedule\(300_000\); \}[\s\S]*?const candidates/,
  "semantic quarantine returns before automatic candidate mutation");
assert.match(transport, /isLocalWorldRegistryTransactionReadOnly/);
assert.match(transport, /controller\[1\] \? controller\[1\]\[0\] \+ Date\.now\(\) - controller\[1\]\[1\]/);
assert.match(transport, /<SignedInCloud key=\{auth\.userId\}/);

const deleteStart = transport.indexOf("if (frozen[0] === ACTION.DELETE)");
const durableWrite = transport.indexOf("store(storage, key(userId, worldId), durable)", deleteStart);
const deleteDispatch = transport.indexOf("sendDelete([frozen, JSON.stringify([1, worldId", deleteStart);
assert.ok(deleteStart >= 0 && durableWrite > deleteStart && deleteDispatch > durableWrite,
  "permanent delete read-back persistence precedes remote mutation");
assert.match(transport, /type DeletePending = readonly \[Frozen, string, number\]/);
assert.match(transport, /controller\[9\] = pending[\s\S]*?call\(pending\[1\]/,
  "the exact frozen request and operation id remain pending across unknown outcomes");
assert.match(transport, /const retry = \(\) =>[\s\S]*?Math\.min\(300_000, 60_000 \* count\)/,
  "permanent-delete retry backoff is bounded");
assert.match(transport, /JSON\.stringify\(\[1, remote\[1\], deletion\[0\], deletion\[1\]\]\)/,
  "reload reconstructs the identical request from the durable D marker");
assert.match(transport, /revision !== frozen\[2\][\s\S]*?remote\[6\] !== frozen\[3\]\?\.\[6\][\s\S]*?remote\[9\] !== frozen\[3\]\?\.\[9\]/,
  "submit revalidates revision, hash, and upload time from the frozen wire");
assert.match(transport, /prepareSinglePlayerCloudBackup\(storage, restored\.world, frozen\[2\]\)[\s\S]*?\[frozen\[2\], prepared\.backup\[2\], prepared\.backup\[3\], prepared\.backup\[4\]\]/);

for (const label of ["Checking cloud backups…", "Cloud backup ready", "Cloud backups up to date",
  "Uploading cloud backup…", "Cloud backups offline", "Cloud backup paused until its quota resets",
  "Cloud storage capacity reached", "Cloud backup needs attention", "Sign in again for cloud backups"]) {
  assert.ok(transport.includes(label), `cloud status matrix retains ${label}`);
}
assert.match(transport, /role=\{status === STATUS\.OFFLINE \|\| status === STATUS\.QUARANTINE \? "alert" : "status"\}/);
assert.match(transport, /role="alertdialog"/);
assert.match(transport, /const DELETE_PHRASE = "yes, I want to delete this world"/);
assert.doesNotMatch(transport, /window\.(?:confirm|prompt)|(?<!\.)\b(?:confirm|prompt)\(/);

console.log("single-player cloud identity, durable actions, retry, and hook containment tests passed");
