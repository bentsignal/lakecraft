import { createHash } from "node:crypto";

const QUERY_MARKER = "  queries: {\n";
const MUTATION_MARKER = "  mutations: {\n";
const ENDPOINT_MARKER = "  endpoints: {";

export const PRODUCTION_QUERY_KEYS = Object.freeze([
  "worldEdits", "worldChunks", "droppedItems", "worldEditsAt", "multiplayerComposite",
  "myPresence", "myInventory", "chestAt", "furnaceAt", "myProfile", "clientBootstrap",
  "externalMultiplayerServers", "myExternalMultiplayerServers", "fernHollowStatus",
  "currentProfiles", "usernameAvailability", "worldClock", "mobAuthority",
  "mobWorldAuthority", "playerCombatStates",
]);

export const PRODUCTION_MUTATION_KEYS = Object.freeze([
  "growOakTree", "editWorldBlock", "startPresenceSession", "publishMotionSegments",
  "authorizeRespawn", "heartbeatPlayer", "leavePlayer", "applyInventoryAction", "dropItem",
  "pickupDroppedItem", "saveChest", "operateFurnace", "transferChest", "sleepInBed",
  "checkpointMobWorld", "claimMobPlayerDamage", "igniteTnt", "claimTntExplosion",
  "claimCreeperExplosion", "rangedCombat", "shearMob", "attackMob", "attackPlayer",
  "registerExternalMultiplayerServer", "rotateExternalMultiplayerServerCredential",
  "setExternalMultiplayerServerActive", "createExternalMultiplayerJoinTicket", "claimUsername",
]);

export const RETAINED_PRODUCTION_QUERIES = Object.freeze([
  "myProfile", "clientBootstrap", "externalMultiplayerServers", "myExternalMultiplayerServers",
  "fernHollowStatus", "currentProfiles", "usernameAvailability",
]);

export const RETAINED_PRODUCTION_MUTATIONS = Object.freeze([
  "applyInventoryAction", "registerExternalMultiplayerServer",
  "rotateExternalMultiplayerServerCredential", "setExternalMultiplayerServerActive",
  "createExternalMultiplayerJoinTicket", "claimUsername",
]);

const SECTION_FINGERPRINTS = Object.freeze({
  query: "27401edc37696e2ce9b90938215ea54a40ff0bd778423879bf801958d508964d",
  mutation: "0e784388db87d480c7f0b7c5792fb80be0dadf9e450ef6bbca20d5876a40e6da",
});

function fail(message) {
  throw new Error(`Unsafe production server surface transform: ${message}`);
}

function soleIndex(source, marker, after = 0) {
  const index = source.indexOf(marker, after);
  if (index < 0 || source.indexOf(marker, index + marker.length) >= 0) {
    fail(`expected exactly one ${JSON.stringify(marker)} marker`);
  }
  return index;
}

function compactSection(source, startMarker, endMarker, kind, expectedKeys, retainedKeys) {
  const markerIndex = soleIndex(source, startMarker);
  const start = markerIndex + startMarker.length;
  const end = soleIndex(source, endMarker, start);
  if (end <= start) fail(`${kind} section markers are out of order`);
  const section = source.slice(start, end);
  const fingerprint = createHash("sha256").update(section).digest("hex");
  if (fingerprint !== SECTION_FINGERPRINTS[kind]) {
    fail(`${kind} source fingerprint changed; expected ${SECTION_FINGERPRINTS[kind]}, received ${fingerprint}`);
  }
  const pattern = new RegExp(`^    ([A-Za-z][A-Za-z0-9_]*): ${kind}\\(`, "gm");
  const matches = [...section.matchAll(pattern)];
  const keys = matches.map((match) => match[1]);
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    fail(`${kind} keys changed; expected ${JSON.stringify(expectedKeys)}, received ${JSON.stringify(keys)}`);
  }
  const retained = new Set(retainedKeys);
  if (retained.size !== retainedKeys.length || retainedKeys.some((key) => !expectedKeys.includes(key))) {
    fail(`${kind} allowlist is invalid`);
  }
  const output = matches.flatMap((match, index) => retained.has(match[1])
    ? [section.slice(match.index, matches[index + 1]?.index ?? section.length)]
    : []).join("");
  return `${source.slice(0, start)}${output}${source.slice(end)}`;
}

/**
 * The public Lakebed capsule now owns identity, server discovery/registration,
 * join tickets, and the one pre-session inventory bootstrap only. Realtime
 * world, mob, combat, and pack operations belong exclusively to Railway.
 * This production-only transform removes the retired exported handlers before
 * bundling so esbuild can discard their otherwise unreachable implementation.
 */
export function stripRetiredLakebedGameplaySurfaces(source) {
  const withoutQueries = compactSection(
    source,
    QUERY_MARKER,
    "\n  },\n\n  mutations: {",
    "query",
    PRODUCTION_QUERY_KEYS,
    RETAINED_PRODUCTION_QUERIES,
  );
  return compactSection(
    withoutQueries,
    MUTATION_MARKER,
    "\n  },\n\n  endpoints: {",
    "mutation",
    PRODUCTION_MUTATION_KEYS,
    RETAINED_PRODUCTION_MUTATIONS,
  );
}
