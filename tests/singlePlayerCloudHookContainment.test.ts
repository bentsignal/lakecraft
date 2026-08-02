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

assert.match(transport, /const enum ACTION \{ DELETE, RESTORE, KEEP_LOCAL, CANCEL_DELETE, RESUME, RECOVER, RESUME_ALL \}/);
assert.match(transport, /const enum STATUS \{ CHECKING, READY, CURRENT, UPLOADING, OFFLINE, QUOTA, CAPACITY, CONFLICT, TOMBSTONES, QUARANTINE, AUTH \}/);
assert.match(transport, /type Controller = \[[\s\S]*?Map<string, Marker>[\s\S]*?DeletePending \| null\]/,
  "compact tagged controller retains mounted lineage and pending-delete authority");
assert.match(transport, /controller\[4\] = 2[\s\S]*?mutate\(request\)/,
  "automatic and manual calls acquire the same mutation fence");
assert.match(transport, /if \(controller\[4\]\) return/);
assert.match(transport, /if \(state\[3\]\) \{ setStatus\(STATUS\.QUARANTINE\); return schedule\(RETRY\); \}[\s\S]*?const candidates/,
  "semantic quarantine returns before automatic candidate mutation");
assert.match(transport, /isLocalWorldRegistryTransactionReadOnly/);
assert.match(transport, /controller\[1\] \? controller\[1\]\[0\] \+ Date\.now\(\) - controller\[1\]\[1\]/);
assert.match(transport, /<SignedInCloud key=\{auth\.userId\}/);

const deleteStart = transport.indexOf("if (kind === ACTION.DELETE)");
const durableWrite = transport.indexOf("store(storage, key(userId, worldId), durable)", deleteStart);
const deleteDispatch = transport.indexOf("sendDelete([frozen, deleteRequest(worldId", deleteStart);
assert.ok(deleteStart >= 0 && durableWrite > deleteStart && deleteDispatch > durableWrite,
  "permanent delete read-back persistence precedes remote mutation");
assert.match(transport, /type DeletePending = readonly \[Frozen, string, number\]/);
assert.match(transport, /controller\[9\] = pending[\s\S]*?call\(pending\[1\]/,
  "the exact frozen request and operation id remain pending across unknown outcomes");
assert.match(transport, /const retry = \(\) =>[\s\S]*?Math\.min\(RETRY, SHORT_RETRY \* count\)/,
  "permanent-delete retry backoff is bounded");
assert.match(transport, /const resumeDelete[\s\S]*?deleteRequest\(worldId, revision, deletion\[1\]\)/,
  "reload reconstructs the identical request from the durable D marker");
assert.match(transport, /response\?\.\[0\] === 3[\s\S]*?controller\[9\] = null[\s\S]*?clearTimeout[\s\S]*?tombstone_capacity[\s\S]*?STATUS\.TOMBSTONES/,
  "permanent capacity is terminal for the exact delete instead of entering the retry loop");
assert.match(transport, /deletion\?\.\[0\] === "D" \|\| deletion\?\.\[0\] === "P"[\s\S]*?if \(!deletion \|\| deletion\[2\]\) return false/,
  "a durably paused capacity marker cannot auto-resume after reload");
assert.match(transport, /ACTION\.CANCEL_DELETE[\s\S]*?store\(storage, key\(userId, worldId\), null\)[\s\S]*?controller\[9\] = null/,
  "pending deletion always has a local, non-mutating cancellation path");
assert.match(transport, /revision !== frozen\[2\][\s\S]*?remote\[6\] !== frozen\[3\]\?\.\[6\][\s\S]*?remote\[9\] !== frozen\[3\]\?\.\[9\]/,
  "submit revalidates revision, hash, and upload time from the frozen wire");
assert.match(transport, /prepareSinglePlayerCloudBackup\(storage, restored\.world, frozen\[2\]\)[\s\S]*?\[frozen\[2\], prepared\.backup\[2\], prepared\.backup\[3\], prepared\.backup\[4\]\]/);
assert.match(transport, /kind === ACTION\.RECOVER[\s\S]*?controller\[0\]\?\.\[0\] !== 3 \|\| controller\[0\]\[2\] !== frozen\[2\]/,
  "account repair submits only the exact revision frozen from the code-3 query");
assert.match(transport, /query\?\.\[0\] === 3 \? action\("Repair Cloud Backups"[\s\S]*?ACTION\.RECOVER[\s\S]*?query\[2\]/,
  "a status-3 malformed-fence query makes account repair directly reachable");
assert.match(transport, /parseRestorableSinglePlayerCloudBackupWire\(raw\)[\s\S]*?parseSinglePlayerCloudBackupWire\(raw\)[\s\S]*?`!\$\{outer\[8\]\}`/,
  "semantically quarantined backup wires retain their payload-free owner descriptor");
assert.match(transport, /const DAMAGED = "Damaged cloud backup"[\s\S]*?state\[1\]\]\.map\([\s\S]*?row\(DAMAGED[\s\S]*?action\("Delete"/,
  "bounded per-world quarantine descriptors render an explicit deletion path");
assert.match(transport, /localState === 3 \? action\("Keep Local"[\s\S]*?button\("Download"/,
  "a divergent same-id lineage exposes CAS-safe keep-local and cloud-preserving download choices");
assert.match(transport, /remote\?\.\[8\] \?\? current\[2\] \?\? "0"/,
  "an explicitly kept local world whose cloud lineage disappeared CASes the still-empty slot");
assert.match(transport, /singlePlayerCloudUploadRevision[\s\S]*?diverged = true[\s\S]*?STATUS\.CONFLICT/,
  "an omitted divergent candidate is surfaced as conflict instead of current");
const uploadReconcile = transport.indexOf("if (controller[7])");
const durableDeleteScan = transport.indexOf("for (const remote of state[0].values())");
assert.ok(uploadReconcile >= 0 && uploadReconcile < durableDeleteScan
  && transport.slice(uploadReconcile, durableDeleteScan).includes("acceptUpload(pending, remote[8])"),
"a lost Resume response reconciles exact active bytes and generation before the D-marker scan");
assert.match(transport, /if \(controller\[4\] !== 1\) return;[\s\S]*?controller\[4\] = 2[\s\S]*?disabled=\{controller\[4\] === 2 \|\|/,
  "dialog-open and submit-in-flight are distinct, with a synchronous guard and disabled confirm button");

assert.match(transport, /const CLOUD = "Cloud backup";\s*const cloud = "cloud backup";/);
for (const label of ["Checking ${cloud}s…", "${CLOUD} ready", "${CLOUD}s up to date",
  "Uploading ${cloud}…", "${CLOUD}s offline", "${CLOUD} paused until its quota resets",
  "Cloud storage capacity reached", "Local and cloud versions need a choice", "Cloud deletion history is full",
  "${CLOUD} needs attention", "Sign in again for ${cloud}s"]) {
  assert.ok(transport.includes(label), `cloud status matrix retains ${label}`);
}
assert.match(transport, /role=\{status === STATUS\.OFFLINE \|\| status >= STATUS\.CONFLICT \? "alert" : "status"\}/);
assert.match(transport, /role="alertdialog"/);
assert.match(transport, /const DELETE_PHRASE = "yes, I want to delete this world"/);
assert.doesNotMatch(transport, /window\.(?:confirm|prompt)|(?<!\.)\b(?:confirm|prompt)\(/);

console.log("single-player cloud identity, durable actions, retry, and hook containment tests passed");
