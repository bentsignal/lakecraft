import { createHash } from "node:crypto";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// These receiver-independent native statics dominate the remaining repeated
// syntax in the closed production client. Snapshotting their values
// once is lossless for Lakecraft, whose bundle neither shadows nor mutates the
// corresponding globals. The ordered occurrence fingerprint makes that claim
// fail closed whenever the first-stage bundle changes.
export const COMPACT_CLIENT_BUILTIN_ALIASES = Object.freeze([
  Object.freeze(["Math", "abs", 108]),
  // Directional doors and derived stair corners share retained transform math.
  Object.freeze(["Math", "cos", 63]),
  // The embedded block-atlas decoder keeps its pixel-grid size and byte
  // addressing arithmetic inside the capsule's reviewed production boundary.
  Object.freeze(["Math", "ceil", 35]),
  // Shared fluid-corner sampling and bounded queue/shore calculations retain
  // exact integer cell coordinates and one horizontal movement magnitude.
  Object.freeze(["Math", "floor", 295]),
  Object.freeze(["Math", "hypot", 38]),
  // Remote atlas integrity now hashes the immutable PNG bytes with Web Crypto
  // instead of applying one pixel-space FNV multiplication after browser decode.
  Object.freeze(["Math", "imul", 35]),
  // Superflat generation and sparse projectile validation clamp reviewed
  // materialization/pool bounds; surface-bob recovery clamps its live timer.
  Object.freeze(["Math", "max", 293]),
  Object.freeze(["Math", "min", 226]),
  Object.freeze(["Math", "round", 36]),
  Object.freeze(["Math", "sin", 77]),
  Object.freeze(["Math", "PI", 123]),
  // The shared, immutable default/superflat terrain descriptor joins the client bundle.
  Object.freeze(["Object", "freeze", 176]),
  Object.freeze(["Object", "keys", 33]),
  // Query bridges reject Lakebed's [] loading sentinel before publishing data.
  Object.freeze(["Array", "isArray", 94]),
  Object.freeze(["Number", "isFinite", 277]),
  // Realtime PvP validates integral damage and health at the untrusted wire boundary.
  Object.freeze(["Number", "isInteger", 61]),
  // Terrain descriptors reject non-integral or unsafe superflat ground heights.
  Object.freeze(["Number", "isSafeInteger", 55]),
  Object.freeze(["Number", "MAX_SAFE_INTEGER", 20]),
  Object.freeze(["Number", "NEGATIVE_INFINITY", 28]),
  Object.freeze(["Number", "POSITIVE_INFINITY", 14]),
  Object.freeze(["Number", "parseInt", 7]),
  Object.freeze(["Date", "now", 67]),
  Object.freeze(["JSON", "stringify", 20]),
  Object.freeze(["JSON", "parse", 12]),
]);
export const COMPACT_CLIENT_BUILTIN_OCCURRENCES = 2_193;
export const COMPACT_CLIENT_BUILTIN_SOURCE_FINGERPRINT = "3a25e4d16dd9cf0bfc869cf0230468e9c19250b0528ffb0d3c03ad08984dd04c";
const PRODUCTION_BOUNDARY = Object.freeze({
  counts: Object.freeze(Object.fromEntries(COMPACT_CLIENT_BUILTIN_ALIASES.map(([receiver, method, count]) => [
    `${receiver}.${method}`, count,
  ]))),
  fingerprint: COMPACT_CLIENT_BUILTIN_SOURCE_FINGERPRINT,
  occurrences: COMPACT_CLIENT_BUILTIN_OCCURRENCES,
});

// Dot-property access repeats the literal key at every callsite, including for
// public DOM/WebGL and persisted/wire records that must never be mangled. A
// computed access through one immutable string preserves the exact observable
// key (and method receiver) while paying for that key once. This fixed manifest
// is taken from the sealed first-stage production bundle; it is intentionally
// not inferred during a release build.
const PROPERTY_ALIAS_SPEC = "action:25,active:20,activeAppearanceRequest:10,activeTexture:6,addEventListener:35,appearanceDigestGeneration:4,appearanceRequestGeneration:4,appearanceRequests:5,appearanceRequestSet:5,appearanceRequestTimer:9,appearanceSupported:5,ARRAY_BUFFER:75,authoritativeCells:5,authoritativeDeadUntil:6,authoritativeRevision:6,behavior:29,behaviorSeed:9,behaviorUntilSeconds:14,bindBuffer:42,bindTexture:16,block:173,bottom:22,bufferData:23,bufferSubData:10,burnRemainingMs:15,byteLength:15,BYTES_PER_ELEMENT:15,canonicalWssUrl:8,capacity:11,center:31,chainPrimed:7,charCodeAt:23,chests:17,chunkRevisions:8,CLAMP_TO_EDGE:10,clear:39,clearInterval:8,clearTimeout:24,COBBLESTONE_STAIRS_UPSIDE_EAST:3,command:15,cookProgressMs:15,coordKey:43,count:183,createBuffer:20,createdAt:28,current:830,currentTarget:18,cursor:45,cycleLengthMs:18,damageSequence:9,dayNight:8,deathUntil:9,delete:65,deleteBuffer:33,deleteProgram:13,deleteTexture:8,direction:24,directionX:19,directionZ:19,distance:20,documentElement:6,drawArrays:19,dropId:20,drops:26,durability:69,DYNAMIC_DRAW:14,elapsedSeconds:38,emitRemotePlayers:5,enableVertexAttribArray:22,endpoint:29,endsWith:20,envelope:12,epochMs:14,epochPhase:14,equipment:40,eventId:16,every:49,exitPointerLock:11,filter:46,flatMap:15,fromEntries:7,furnaces:17,fuseStartedAtSeconds:21,fuseUntilSeconds:17,gameMode:25,getAttribLocation:20,getItem:21,getUniformLocation:62,health:53,height:29,hostileActive:9,hunger:30,includes:41,indexOf:24,initialGameMode:14,inventory:102,inventoryJson:8,inventorySlot:11,isAuthenticated:5,itemId:176,lastMaterializedAtMs:10,lastPlayedAt:14,length:438,localeCompare:15,localStorage:11,maxDurability:11,maxHealth:10,maxStack:25,message:13,mobAccumulatorSeconds:6,mouseSensitivity:7,mutationStarted:9,nextContactDamageAtSeconds:4,offset:71,ONE_MINUS_SRC_ALPHA:5,onWorldChunksUnload:4,operationId:38,options:64,output:23,pendingBlocks:9,pendingChat:7,pendingDrops:8,pendingInventory:8,pendingProjectileDamage:9,pendingRespawn:12,pendingSelfDamage:9,pitch:44,pixelStorei:9,player:34,playerHealth:8,pointerLockElement:25,position:17,preventDefault:45,previousBlock:10,previousX:18,previousY:15,previousYaw:9,previousZ:18,projectiles:17,prototype:16,randomUUID:9,readyState:9,reason:50,recipeId:12,reject:21,remainder:16,remoteAppearances:9,remoteSkins:8,removeEventListener:37,renderDistance:7,repeat:24,requestJson:7,requestPointerLock:12,resolve:16,respawnPoint:9,resumeToken:7,revision:27,rotationDegrees:21,selectedHotbar:13,sentPoses:10,sequence:45,setTimeout:21,sheared:13,slice:108,snapshot:17,soundMuted:18,sourceSlot:9,startsWith:25,state:66,STATIC_DRAW:9,status:19,stopImmediatePropagation:6,subarray:14,sunDamageAt:9,superflatGroundY:10,target:25,terrain:18,texImage2D:10,texParameteri:20,TEXTURE_2D:47,TEXTURE_MAG_FILTER:5,TEXTURE_MIN_FILTER:5,toFixed:23,toLowerCase:7,toUpperCase:10,TRIANGLES:17,uniform1f:36,uniform3f:21,uniform3fv:8,uniformMatrix4fv:9,UNPACK_FLIP_Y_WEBGL:8,UNSIGNED_BYTE:11,useProgram:16,userId:35,username:15,value:36,values:34,velocityX:23,velocityY:23,velocityZ:23,vertexAttribPointer:22,visibilityState:15,world:69,worldChunksSupported:4,worldCoordinate:16,worldId:15,worlds:23,worldTimeMs:6";
// Closed-door sky exposure and paired-door Railway follow-ups add six reviewed
// uses without broadening the fixed exact-key allowlist.
const PROPERTY_ALIAS_COUNT_OVERRIDES = Object.freeze({
  // Remote mob-atlas fetch and integrity validation add one reviewed
  // active/includes/status use apiece.
  active: 23, activeTexture: 9, addEventListener: 38, ARRAY_BUFFER: 88, behavior: 30, behaviorSeed: 10, bindBuffer: 49, bindTexture: 26,
  block: 191, bottom: 30, bufferData: 25, bufferSubData: 14, byteLength: 17, BYTES_PER_ELEMENT: 17,
  center: 36, charCodeAt: 25, chunkRevisions: 11, CLAMP_TO_EDGE: 16, clear: 49, clearTimeout: 26, count: 185,
  createBuffer: 25, current: 877, currentTarget: 25, cycleLengthMs: 20, dayNight: 9, delete: 83, deleteBuffer: 43,
  deleteProgram: 18, deleteTexture: 14, documentElement: 9, drawArrays: 24, dropId: 29, endsWith: 28,
  drops: 25, DYNAMIC_DRAW: 17, enableVertexAttribArray: 27, equipment: 41,
  elapsedSeconds: 39, every: 51, filter: 52, flatMap: 24, fromEntries: 10, getAttribLocation: 24,
  // Embedding the block atlas replaces the remote response dimensions/status
  // with the generated decoder's byte-array length checks.
  getUniformLocation: 69, health: 55, height: 35, includes: 52, inventory: 105, itemId: 183, length: 489,
  indexOf: 27, maxHealth: 13, maxStack: 23, operationId: 43, options: 69, pixelStorei: 15, preventDefault: 54,
  ONE_MINUS_SRC_ALPHA: 7, pendingBlocks: 11, pendingSelfDamage: 10, pitch: 43, pointerLockElement: 24, position: 22,
  previousBlock: 19, previousX: 19, previousY: 16, previousYaw: 10, previousZ: 19, projectiles: 22,
  prototype: 17, randomUUID: 10, readyState: 10, reject: 24, removeEventListener: 40,
  mouseSensitivity: 4, renderDistance: 11, repeat: 32, resolve: 19, revision: 32, rotationDegrees: 30, selectedHotbar: 15,
  remainder: 17, sequence: 47, setTimeout: 22, sheared: 16, slice: 111, sourceSlot: 10, startsWith: 35,
  state: 70, STATIC_DRAW: 8, status: 20, stopImmediatePropagation: 8, subarray: 19, terrain: 23, texImage2D: 15,
  texParameteri: 32, TEXTURE_2D: 74, TEXTURE_MAG_FILTER: 8, TEXTURE_MIN_FILTER: 8,
  TRIANGLES: 22, uniform1f: 41, uniform3fv: 11, uniformMatrix4fv: 12,
  soundMuted: 12, toFixed: 24, toUpperCase: 10, UNPACK_FLIP_Y_WEBGL: 12, UNSIGNED_BYTE: 16, useProgram: 21, userId: 36, value: 40, values: 35,
  vertexAttribPointer: 30, world: 71, worldTimeMs: 7,
});
export const COMPACT_CLIENT_PROPERTY_KEY_ALIASES = Object.freeze(PROPERTY_ALIAS_SPEC.split(",").map((entry) => {
  const separator = entry.lastIndexOf(":");
  const name = entry.slice(0, separator);
  return Object.freeze([name, PROPERTY_ALIAS_COUNT_OVERRIDES[name] ?? Number(entry.slice(separator + 1))]);
}));
// The reviewed boundary includes cursor-directed inventory refs, exact
// destroy-stage texture rendering, textured depth-bearing dropped items,
// retained streaming buffers, packed live-block coordinate access, and the
// paired prompt/background fluid queues plus their bounded mesh lifecycle.
// One shared leaf-family predicate adds the reviewed `endsWith` call.
export const COMPACT_CLIENT_PROPERTY_KEY_OCCURRENCES = 6_478;
export const COMPACT_CLIENT_PROPERTY_KEY_FINGERPRINT = "25fa3fbf4aef6ca7ffd539ab7aa5a461cd2263a98adbac1fb491451c710872c8";
const PROPERTY_ALIAS_INDEX = new Map(COMPACT_CLIENT_PROPERTY_KEY_ALIASES.map(([name], index) => [name, index]));
const PROPERTY_BOUNDARY = Object.freeze({
  counts: Object.freeze(Object.fromEntries(COMPACT_CLIENT_PROPERTY_KEY_ALIASES)),
  fingerprint: COMPACT_CLIENT_PROPERTY_KEY_FINGERPRINT,
  occurrences: COMPACT_CLIENT_PROPERTY_KEY_OCCURRENCES,
});
// The embedded atlas decoder no longer needs the remote-loader Uint8Array copy
// or its document-backed image decode branch; sparse projectile persistence
// and the prompt/background fluid scheduler retain their reviewed Sets. The
// instant Creative hold cadence adds two reviewed performance-clock reads.
const GLOBAL_ALIAS_SPEC = "Float32Array:87,Map:75,Set:70,Uint8Array:21,document:99,performance:79,window:126";
export const COMPACT_CLIENT_GLOBAL_ALIASES = Object.freeze(GLOBAL_ALIAS_SPEC.split(",").map((entry) => {
  const separator = entry.lastIndexOf(":");
  return Object.freeze([entry.slice(0, separator), Number(entry.slice(separator + 1))]);
}));
export const COMPACT_CLIENT_GLOBAL_OCCURRENCES = 557;
export const COMPACT_CLIENT_GLOBAL_FINGERPRINT = "efa40f5166f441193a59175861c89c9417932c3860c2b906b2bf2b17c46e0362";
const GLOBAL_ALIAS_INDEX = new Map(COMPACT_CLIENT_GLOBAL_ALIASES.map(([name], index) => [name, index]));
const GLOBAL_BOUNDARY = Object.freeze({
  counts: Object.freeze(Object.fromEntries(COMPACT_CLIENT_GLOBAL_ALIASES)),
  fingerprint: COMPACT_CLIENT_GLOBAL_FINGERPRINT,
  occurrences: COMPACT_CLIENT_GLOBAL_OCCURRENCES,
});

const RECEIVERS = new Set(COMPACT_CLIENT_BUILTIN_ALIASES.map(([receiver]) => receiver));
const ALIAS_INDEX = new Map(COMPACT_CLIENT_BUILTIN_ALIASES.map(([receiver, method], index) => [
  `${receiver}.${method}`, index,
]));

let typescriptPromise;
async function typescript() {
  if (typescriptPromise) return typescriptPromise;
  typescriptPromise = (async () => {
    const cacheRoot = join(homedir(), ".npm", "_npx");
    const candidates = [];
    for (const entry of await readdir(cacheRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(cacheRoot, entry.name, "node_modules", "typescript", "lib", "typescript.js");
      try {
        await access(path);
        candidates.push({ path, modifiedAt: (await stat(path)).mtimeMs });
      } catch {}
    }
    candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
    if (!candidates[0]) throw new Error("Compact client builtin audit requires Lakebed's cached TypeScript runtime.");
    return import(pathToFileURL(candidates[0].path).href);
  })();
  return typescriptPromise;
}

function fail(message) {
  throw new Error(`Unsafe compact client builtin transform: ${message}`);
}

function collectBindingNames(ts, name, names) {
  if (!name) return;
  if (ts.isIdentifier(name)) names.add(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collectBindingNames(ts, element.name, names);
    }
  }
}

function assignmentTarget(ts, node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isDeleteExpression(parent) || ts.isPostfixUnaryExpression(parent)) return true;
  if (ts.isPrefixUnaryExpression(parent)) {
    return parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken;
  }
  return ts.isBinaryExpression(parent) && parent.left === node
    && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

export async function compactClientBuiltinAliases(source, expected = PRODUCTION_BOUNDARY) {
  if (typeof source !== "string") throw new TypeError("Compact client builtin transform requires JavaScript source.");
  if (source.includes("__lakecraftBuiltin")) fail("runtime identifier collides with source text");
  const ts = await typescript();
  const sourceFile = ts.createSourceFile(
    "lakecraft-client-stage.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS,
  );
  const bindings = new Set();
  const occurrences = [];
  const counts = new Map([...ALIAS_INDEX.keys()].map((key) => [key, 0]));

  function visit(node) {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      collectBindingNames(ts, node.name, bindings);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      bindings.add(node.name.text);
    } else if (ts.isImportClause(node)) {
      if (node.name) bindings.add(node.name.text);
      if (node.namedBindings) {
        if (ts.isNamespaceImport(node.namedBindings)) bindings.add(node.namedBindings.name.text);
        else for (const element of node.namedBindings.elements) bindings.add(element.name.text);
      }
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      collectBindingNames(ts, node.variableDeclaration.name, bindings);
    }

    if ((ts.isElementAccessExpression(node) || ts.isElementAccessChain(node))
      && ts.isIdentifier(node.expression) && RECEIVERS.has(node.expression.text)) {
      fail(`computed ${node.expression.text} access entered the closed builtin boundary`);
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node))
      && ts.isIdentifier(node.expression) && RECEIVERS.has(node.expression.text)) {
      if (assignmentTarget(ts, node) || assignmentTarget(ts, node.expression)) {
        fail(`${node.expression.text}.${node.name.text} is mutated`);
      }
      const key = `${node.expression.text}.${node.name.text}`;
      if (ALIAS_INDEX.has(key)) {
        counts.set(key, counts.get(key) + 1);
        occurrences.push({
          end: node.end,
          index: ALIAS_INDEX.get(key),
          key,
          start: node.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  for (const receiver of RECEIVERS) if (bindings.has(receiver)) fail(`${receiver} is shadowed by a bundle binding`);
  const countDrifts = COMPACT_CLIENT_BUILTIN_ALIASES.flatMap(([receiver, method]) => {
    const key = `${receiver}.${method}`;
    const actual = counts.get(key);
    const expectedCount = expected.counts?.[key];
    return actual === expectedCount ? [] : [`${key} expected ${expectedCount}, received ${actual}`];
  });
  if (countDrifts.length) fail(countDrifts.join("; "));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(occurrences.map(({ key }) => key)))
    .digest("hex");
  if (occurrences.length !== expected.occurrences || fingerprint !== expected.fingerprint) {
    fail(`live set changed; expected ${expected.occurrences}/${expected.fingerprint}, received `
      + `${occurrences.length}/${fingerprint}`);
  }
  let output = source;
  for (const occurrence of [...occurrences].sort((left, right) => right.start - left.start)) {
    output = output.slice(0, occurrence.start)
      + `__lakecraftBuiltin${occurrence.index}`
      + output.slice(occurrence.end);
  }
  const declarations = COMPACT_CLIENT_BUILTIN_ALIASES
    .map((_entry, index) => `__lakecraftBuiltin${index}`).join(",");
  const values = COMPACT_CLIENT_BUILTIN_ALIASES
    .map(([receiver, method]) => `${receiver}.${method}`).join(",");
  return `const [${declarations}]=[${values}];${output}`;
}

/** Preserve exact public/persisted key strings while deduplicating dot syntax. */
export async function compactClientPropertyKeyAliases(
  source,
  expected = PROPERTY_BOUNDARY,
  expectedGlobals = GLOBAL_BOUNDARY,
) {
  if (typeof source !== "string") throw new TypeError("Compact client property-key transform requires JavaScript source.");
  if (source.includes("__lakecraftPropertyKey") || source.includes("__lakecraftGlobal")) {
    fail("property-key runtime identifier collides with source text");
  }
  const ts = await typescript();
  const sourceFile = ts.createSourceFile(
    "lakecraft-client-pooled-stage.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS,
  );
  const occurrences = [];
  const counts = new Map(COMPACT_CLIENT_PROPERTY_KEY_ALIASES.map(([name]) => [name, 0]));
  const globalOccurrences = [];
  const globalCounts = new Map(COMPACT_CLIENT_GLOBAL_ALIASES.map(([name]) => [name, 0]));
  const bindings = new Set();
  function visit(node) {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      collectBindingNames(ts, node.name, bindings);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      bindings.add(node.name.text);
    } else if (ts.isImportClause(node)) {
      if (node.name) bindings.add(node.name.text);
      if (node.namedBindings) {
        if (ts.isNamespaceImport(node.namedBindings)) bindings.add(node.namedBindings.name.text);
        else for (const element of node.namedBindings.elements) bindings.add(element.name.text);
      }
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      collectBindingNames(ts, node.variableDeclaration.name, bindings);
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node))
      && PROPERTY_ALIAS_INDEX.has(node.name.text)) {
      const key = node.name.text;
      counts.set(key, counts.get(key) + 1);
      occurrences.push({
        end: node.end,
        index: PROPERTY_ALIAS_INDEX.get(key),
        key,
        optional: Boolean(node.questionDotToken),
        start: node.expression.end,
      });
    }
    if (ts.isIdentifier(node) && GLOBAL_ALIAS_INDEX.has(node.text)) {
      const parent = node.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(parent) || ts.isPropertyAccessChain(parent))
          && parent.name === node
        || (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)
          || ts.isPropertyDeclaration(parent) || ts.isGetAccessorDeclaration(parent)
          || ts.isSetAccessorDeclaration(parent)) && parent.name === node
        || ts.isBindingElement(parent) && parent.name === node
        || ts.isVariableDeclaration(parent) && parent.name === node
        || ts.isParameter(parent) && parent.name === node
        || ts.isFunctionDeclaration(parent) && parent.name === node
        || ts.isClassDeclaration(parent) && parent.name === node;
      if (!isPropertyName) {
        const key = node.text;
        globalCounts.set(key, globalCounts.get(key) + 1);
        globalOccurrences.push({
          end: node.end,
          index: GLOBAL_ALIAS_INDEX.get(key),
          key,
          shorthand: ts.isShorthandPropertyAssignment(parent),
          start: node.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  for (const name of GLOBAL_ALIAS_INDEX.keys()) if (bindings.has(name)) fail(`${name} is shadowed by a bundle binding`);
  const drifts = COMPACT_CLIENT_PROPERTY_KEY_ALIASES.flatMap(([name]) => {
    const actual = counts.get(name);
    const expectedCount = expected.counts?.[name];
    return actual === expectedCount ? [] : [`${name} expected ${expectedCount}, received ${actual}`];
  });
  if (drifts.length) fail(drifts.join("; "));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(occurrences.map(({ key }) => key)))
    .digest("hex");
  if (occurrences.length !== expected.occurrences || fingerprint !== expected.fingerprint) {
    fail(`property-key live set changed; expected ${expected.occurrences}/${expected.fingerprint}, received `
      + `${occurrences.length}/${fingerprint}`);
  }
  const globalDrifts = COMPACT_CLIENT_GLOBAL_ALIASES.flatMap(([name]) => {
    const actual = globalCounts.get(name);
    const expectedCount = expectedGlobals.counts?.[name];
    return actual === expectedCount ? [] : [`${name} expected ${expectedCount}, received ${actual}`];
  });
  if (globalDrifts.length) fail(globalDrifts.join("; "));
  const globalFingerprint = createHash("sha256")
    .update(JSON.stringify(globalOccurrences.map(({ key }) => key)))
    .digest("hex");
  if (globalOccurrences.length !== expectedGlobals.occurrences
    || globalFingerprint !== expectedGlobals.fingerprint) {
    fail(`global live set changed; expected ${expectedGlobals.occurrences}/${expectedGlobals.fingerprint}, received `
      + `${globalOccurrences.length}/${globalFingerprint}`);
  }
  let output = source;
  const replacements = [
    ...occurrences.map((occurrence) => ({
      ...occurrence,
      text: `${occurrence.optional ? "?." : ""}[__lakecraftPropertyKey${occurrence.index}]`,
    })),
    ...globalOccurrences.map((occurrence) => ({
      ...occurrence,
      text: `${occurrence.shorthand ? `${occurrence.key}:` : ""}__lakecraftGlobal${occurrence.index}`,
    })),
  ];
  for (const occurrence of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, occurrence.start)
      + occurrence.text
      + output.slice(occurrence.end);
  }
  const declarations = COMPACT_CLIENT_PROPERTY_KEY_ALIASES
    .map((_entry, index) => `__lakecraftPropertyKey${index}`).join(",");
  const values = COMPACT_CLIENT_PROPERTY_KEY_ALIASES.map(([name]) => JSON.stringify(name)).join(",");
  const globalDeclarations = COMPACT_CLIENT_GLOBAL_ALIASES
    .map((_entry, index) => `__lakecraftGlobal${index}`).join(",");
  const globalValues = COMPACT_CLIENT_GLOBAL_ALIASES.map(([name]) => name).join(",");
  return `const [${declarations}]=[${values}],[${globalDeclarations}]=[${globalValues}];${output}`;
}
