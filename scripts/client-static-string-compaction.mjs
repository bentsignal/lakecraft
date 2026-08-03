import { createHash } from "node:crypto";

export const COMPACT_CLIENT_STATIC_STRING_VALUES = Object.freeze([
  "button", "string", "warning", "number", "function", "span", "object", "creative",
  "crafting_table", "inventory_action_pending", "div", "section", "storage_read_failed",
  "corrupt", "shaped", "unsupported", "survival", "to_chest", "stone",
  "presentation", "diamond", "keydown", "unsafe_existing_data", "visibilitychange",
  "error", "creeper", "gravel", "Escape", "visible", "invalid_time", "idle",
  "presence_refresh_failed", "leaves", "invalid_inventory", "inventory", "too_large",
  "place", "incomplete_column", "noise", "boolean", "cobblestone", "stone_brick_slab",
  "itemId", "invalid_envelope", "tone", "flint_and_steel", "recovered", "status",
  "stone_bricks", "empty_slot", "sapling", "furnace", "unknown", "small",
  "oak_fence_gate", "polite", "dialog", "diamond_ore", "ladder", "input", "sand",
  "deposit_input", "pointerlockchange", "Checking the shared night watch with Lakebed…",
  "stack_full", "take_input", "budget_exhausted", "blockPlace", "invalid_registry",
  "deposit_fuel", "break", "ControlRight", "singleplayer", "authentication_required",
  "leather", "version", "readback_failed", "world_not_found", "Respawn not authorized",
  "Input and fuel are shared through Lakebed.", "player", "strong", " is-error",
  "no_capacity", "chest", "take_fuel", "grass", "sneak", "ControlLeft", "creeperFuse",
  "Lakebed returned a damaged chest payload.", "cursor_blocked", "needs_username", "stale_registry",
]);

const SHARED_NAME_PREFIX = "__lakecraftSharedString";
const CONTEXT_WIDTH = 56;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedContext(source, start, end) {
  const normalize = (value) => value
    .replace(/\\(?:u\{[0-9a-f]+\}|u[0-9a-f]{4}|x[0-9a-f]{2}|.)/gi, "E")
    .replace(/[A-Za-z_$][\w$]*/g, "I")
    .replace(/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi, "N")
    .replace(/\s+/g, "");
  return `${normalize(source.slice(Math.max(0, start - CONTEXT_WIDTH), start))}`
    + `|${normalize(source.slice(end, Math.min(source.length, end + CONTEXT_WIDTH)))}`;
}

function literalPositions(source, literal) {
  const positions = [];
  for (let cursor = 0; cursor <= source.length - literal.length;) {
    const index = source.indexOf(literal, cursor);
    if (index < 0) break;
    positions.push(index);
    cursor = index + literal.length;
  }
  return positions;
}

export function analyzeClientStaticStrings(source, values = COMPACT_CLIENT_STATIC_STRING_VALUES) {
  if (typeof source !== "string" || !Array.isArray(values)) {
    throw new TypeError("Compact client static-string analysis requires source text and a value array.");
  }
  return values.map((value) => {
    if (typeof value !== "string" || !value || value.includes(SHARED_NAME_PREFIX)) {
      throw new Error("Compact client static-string values must be non-empty inert strings.");
    }
    const literal = JSON.stringify(value);
    const positions = literalPositions(source, literal);
    const contexts = positions.map((start) => normalizedContext(source, start, start + literal.length)).sort();
    return Object.freeze({ count: positions.length, contextFingerprint: digest(JSON.stringify(contexts)), value });
  });
}

export const COMPACT_CLIENT_STATIC_STRING_MANIFEST = Object.freeze([
  ["button", 96, "b2862bd6d54a799f7331fc148a9864e4cba93714dbb3411c23b7ac8b3b29fb7b"],
  ["string", 50, "b1d84e66a3997aa8b4a2efc63426e4cf4674cebddb1b35228e7d3ee583bc55ee"],
  ["warning", 54, "1a4735edb6b3eb75a5980dabb5ec12395defa394daf9233e9681bedfdc2f9ca8"],
  ["number", 54, "1f6fb7960c01553164df6e133863ad476ca53c18f60d169487e32263d1de10c3"],
  ["function", 19, "516654636cc47ee1628999d664530380c740d4b4ed17b4a55a7b9451a145af9f"],
  ["span", 75, "791eb6efd5db5aa841fd3f120de084e8c17b32d098af5a3d2646da7631febd42"],
  ["object", 35, "0d5a7f9c75ed9e367c2298f336784dd02c1df80c67cd46226239915490de1c52"],
  ["creative", 28, "9f9ba1211f3f1a5edd32a608d5e87967b94a3cd8521603b815fd69ce2433c049"],
  ["crafting_table", 13, "64b3b1a9dd395534ccb7908c8cf933aefc140498e9841388936dd975a540d590"],
  ["inventory_action_pending", 7, "9400bfb3b55fd2591280f07b15d740f60df5d8a50136e2d45ec4d2b0f15c8a0f"],
  ["div", 66, "28bd767bb350e83557250b9b67a61e947194ccdd295d3df5ca0dc0ea8d5f604f"],
  ["section", 22, "0c65316c689f2843fa5b2a817fd1a5ffada7b3e3bc9f39581d572f0286a263f8"],
  ["storage_read_failed", 8, "c9c83d20f8c97ff417d2d7dd2bf28c86ef6496752ee0edf11bf523d069218871"],
  ["corrupt", 21, "96407bcb9741a2be1b89cf9e316f9d1619b750f6f8a006ff422dd5648a7efc2b"],
  ["shaped", 22, "4abfa32cdd406bafed29a090477875dd803e514f1aa26f498a426c1058363dc8"],
  ["unsupported", 11, "cc6438c6d7d906a8070f0504a74667cea158b30bdf9e7ed7ee1e945593192794"],
  ["survival", 15, "a1bbcf67eb4e83696189635450dff75fa0a67fa2e45674a0fbf832a81a6c44ed"],
  ["to_chest", 14, "05944fdeb08ec1799581b939d1d9af17be6d0dcaa10449a04295ad42f7350e61"],
  ["stone", 23, "741529fe1bf2d247c573004d3cf1f617c19a53d01e611f83f315225f89815d79"],
  ["presentation", 9, "646578d04707d7b6f5444c1840cfe8b47852e9e7b278653e4a7bd6f7ca9e12f5"],
  ["diamond", 14, "f13988c6ab97eed626ac55c4b4695542c607d329d8d858ecc9b877384aa6e84f"],
  ["keydown", 14, "634eee9f76709bccb45b4aef88779382d5260d3066318fdea7b041182f997b21"],
  ["unsafe_existing_data", 5, "0434c8504fb94b351e0e809273dcadbb100a0bc77e3a03b708187e22d6839d12"],
  ["visibilitychange", 6, "9d215d52f2d6cc7650fff678eb0f1d0444315779a7ffce93fdec276e3f14c143"],
  ["error", 12, "44b26e9bfd5128a97dfb85a707a4004de9caef7fbd7217c665fcc997a21ed88d"],
  ["creeper", 13, "d1670a2bb7f81989a14976e4a0902e2cf1db58bbceac844d4308fae65ecefaea"],
  ["gravel", 15, "44109175b5e356f704f281010d399563e45649c9c4427d04ffa7512307cd130f"],
  ["Escape", 15, "b7bd654c132b75b17b38a046c4ef5f9f212f68cdbac0330ae0d442174956f14d"],
  ["visible", 12, "c9ea135061a904e1123faa1fafc226547b12d54e5612fa93429b5f527432734e"],
  ["invalid_time", 7, "677cafcec8e10856473212c1fbced5f04714963b6b81b0846f95e0368a92cb3b"],
  ["idle", 23, "e76ce7b3c114ff6027d7e3bae2b42df859002fe58bdb81f34eef2cbde0cd7135"],
  ["presence_refresh_failed", 4, "f4bf946785b67b3ae4774d4533a13c27ae0f17ccb6da213cc00c51262f1677bd"],
  ["leaves", 14, "ec479b39165a201d27380ba3970c79424fb64009b9384928226abad9c8640d28"],
  ["invalid_inventory", 5, "6780a9949a37e1a709c37891f7a6b27438b19c0be01530d31d53f72616533611"],
  ["inventory", 9, "eb1407eb5d0c7762da136623703ee6df2181a399e82fb4657b6b78653cb2e06b"],
  ["too_large", 9, "adb1ae5e42d5697f92aa9a1e49cef09dcf41696c38e3819377d1a79a69df230f"],
  ["place", 17, "e5806d1ce705d9b8f60bbd7abae7bc0775d6830fd373fc6bc55bf16c6b7ae49c"],
  ["incomplete_column", 5, "0449f9e8c0b8a4b3215ab0dbc61ebb2750047b6da234ff7acfc3ba22e77dce50"],
  ["noise", 17, "bcdfab3851207ff41945fcb835f3ec2a37c2a853006e6e46cc2c5951bf040c02"],
  ["boolean", 9, "5170255c689baa76b8a1a457ae404c44026cc6f116c2e6bd3884892b3e7b78a8"],
  ["cobblestone", 7, "bd5af77edede57d9d58c1ec4ba7b88f8d5fbaf291333b42fd879c905115df752"],
  ["stone_brick_slab", 5, "0d171e364e794dcbf2a91f5e826c7de787dc297ca18b9c4cb56394bda910ad52"],
  ["itemId", 13, "942abc509d785096364501648d11b15bb8be9171e2f7346fb3d695ce64b7c9d9"],
  ["invalid_envelope", 5, "b55af75189682358816c466b3e3cb1ae49dcb00f01470b080b8176eafec5de3f"],
  ["tone", 20, "3a76caf533b7e59afb1c9e4ef426245fe021743d8c0221c039105022fc561873"],
  ["flint_and_steel", 5, "ae85a274ff1adb4cdef30389ae924c2f4cf1b5868ef80681153ab0dd02a4259e"],
  ["recovered", 8, "432cf6cf592a80be3b56bb147ebdc094280cd9fafcfe1ab10a65d8478771d241"],
  ["status", 12, "112195ba9888afeaabf659359556863ef29aba76652f68d5f450ffb429f640b1"],
  ["stone_bricks", 6, "897488c06992cf4ff35fbd5b9add2991a7c363b1de3044f5c0c19105a07d6a8e"],
  ["empty_slot", 7, "0e3ae5ae6e572ae63e05a776a8d8a220810a8b8f559bcc819d9942051ab4de55"],
  ["sapling", 10, "8a8cd0aafb2b25af8658afdc0af794bf0bd4e4f3b37e15afb754ae52abd2efb4"],
  ["furnace", 10, "127fccec290998abcb55c802008be2c13e39942c8c9bf4a51184f4fe9b858db4"],
  ["unknown", 10, "5172101ba4410b9e31427f66e3ff63fbd1ee61de03cd721f1741be4a5949864c"],
  ["small", 14, "c7efc67c5a59357cf291b4c430661159091c47e8e1dd7aea27aa293145d468f2"],
  ["oak_fence_gate", 5, "64f01fb3f0016c25ed2d17f664bd3e66a2a781f749c35a93a29647b1e6a0c732"],
  ["polite", 11, "75433d141dfe11979191464b04055e59fd8ab4d6e778e50ad2ac868a2f26c2ab"],
  ["dialog", 11, "b1b58cd47916eea272039aa1f822a94a406be47b7e53a7b684552939f91d9265"],
  ["diamond_ore", 6, "1516bbfdf3d8c5da3f74a59c8d4e93a36e9bb2211a56cc5cd225d23a2d65f385"],
  ["ladder", 11, "5fa1e36414c9b460a8f7c6f9f46311e9982fab6e4bd746c2eab1919c6656bbfc"],
  ["input", 13, "3cd0b3143780707ad2cebdfe9b55868a6ff0367551f2351741691f116c8ba12b"],
  ["sand", 17, "4ef28ad18178aa4c90ec053b1fd6a8e3c62273b83c8bc300c1090c107262f17c"],
  ["deposit_input", 5, "e758b167045b1b7f30e348a7171c654b712f31e9a7748f56d9133b6840206656"],
  ["pointerlockchange", 4, "baff3998a96a1f2bbc8e14741e1aca9d1a79c28c198bb0e9e90e16444a2c7f2d"],
  ["Checking the shared night watch with Lakebed…", 2, "02026b0b6255683ce9c3d95e5f726330caa35818a39b02e92878c664ddcc2ed8"],
  ["stack_full", 6, "eb117deda3781b75d8de282d0e555a5b8cf10261db288fec3af678d6d09f0d2c"],
  ["take_input", 6, "8e695e709204a384572288ac2fb4bd15e877c172355d53031c21c392842fdef6"],
  ["budget_exhausted", 4, "8534fd9365def5b0cf9e2cf1eae9e5b6316fdcb89c4f69c1a5c733b4c20b0e4c"],
  ["blockPlace", 6, "6b6f0b3ded63a7bf690615eb11016faef00ef0489e33277cbd4c22923563f3ed"],
  ["invalid_registry", 4, "672c3e956dc03c9c2109a131d0e456612c95e106476a1a233855398cb7415d3b"],
  ["deposit_fuel", 5, "d411a6c0f289b0889838f5129a7c1c2686af884938865567b092e1aa953fb63e"],
  ["break", 12, "a4b68658c407453205393c052cebe12cab7fe63eaa440fb192f2dd383f49bde8"],
  ["ControlRight", 5, "b7f80ae55ba2cc71fdc27f9aeccfb1a189ee8747fa9fcaad5adc1d79184304d8"],
  ["singleplayer", 5, "607f2c02cf5570e68ae2a48818db9f7b066b146691b23ac9cad0fe1e515cfa18"],
  ["authentication_required", 3, "827c4fd7fb08e8243b03727f59677617312583edd31c96145f884192ab489cae"],
  ["leather", 8, "f55c7ab5f11a72976e1fbe8039774577d41d92038141ffad27e4c0d1e45a1d8d"],
  ["version", 8, "2a50348ae1a08b167307fffff56aad4f716b3f20dc4a2d4f428a6686eaf27628"],
  ["readback_failed", 4, "66bd61cd67c19ebd46dd61c9f6694bab166f817a101b9a9aa94fb8dadf6e3452"],
  ["world_not_found", 4, "62c98b9e5ac2354ca44fd2e8c44ea5f3fd0eec6493ae11255651dbd3c6198190"],
  ["Respawn not authorized", 3, "6a6d334b09fc4e5384519cabd838cacabf407d1cf9d12c531839dacbc3cea8d7"],
  ["Input and fuel are shared through Lakebed.", 2, "0a2d4ffd50b5a251485253eed0d59743138849dd93ccac386e38b5730440a844"],
  ["player", 9, "903076e25d5b8eff51bffb094599c54c86eb8c5fde598c808ab0c1bd86764ea9"],
  ["strong", 9, "7e6d2897a30baf4652f8e969b74f5ef23e2f679c81a30aced46f75d40327612c"],
  [" is-error", 6, "e9260a527caeede62743ed26aef1e404c1a7f9a68b0dfb14a27649c011a419f2"],
  ["no_capacity", 5, "5ec4870f7faf70b0b367b54d33ce73a7c7c742a58e8b220f3706e0d1e9131bbf"],
  ["chest", 11, "ee161b88287370364d9b45b1147688e42339895a199129f2d06ede11d4b935fa"],
  ["take_fuel", 6, "93fb76a939d43fa537e298bf39b92756c5cddc436b3eddd841618b873c4b5b95"],
  ["grass", 11, "cdc22e680229e17647ba1301b90b7cb93e24d22cc7a9bde3269e9f76527b05a7"],
  ["sneak", 11, "e830654e6d177768bcb9a9900aba974944d63c564de5502ff6c8ee9eda14ee85"],
  ["ControlLeft", 5, "5cf024f40009511c56722af29022c4cbc6095430516773fa76225ff1d5cbefd9"],
  ["creeperFuse", 5, "1e658e8e72856632be303fed53b853eca0c63900ebe7b8e9051a083aa88208ab"],
  ["Lakebed returned a damaged chest payload.", 2, "e7ed4ff2838b56ffbe5d78fc58cfe7953e92b88f6c6e3ad23fd4be0fcb9feea3"],
  ["cursor_blocked", 4, "7a6ce7f98f7a690865a5c98fd9b17252992288d9be10f64fe6909b32212facdf"],
  ["needs_username", 4, "2cae5a9bb4298a722d2956949dfd94ef3cdd440cf422f9f49f0f4f119850475a"],
  ["stale_registry", 4, "af6ee029acfb6e2bf4ca83eb5e09156434c1a1a8fec00ce24574467a89604c5e"],
].map(([value, count, contextFingerprint]) => Object.freeze({ value, count, contextFingerprint })));

export function compactClientStaticStrings(source, manifest = COMPACT_CLIENT_STATIC_STRING_MANIFEST) {
  if (typeof source !== "string" || !Array.isArray(manifest) || !manifest.length) {
    throw new TypeError("Compact client static-string transform requires source text and a manifest.");
  }
  if (source.includes(SHARED_NAME_PREFIX)) {
    throw new Error("Compact client static-string identifier collides with staged source.");
  }
  const values = manifest.map((row) => row.value);
  if (new Set(values).size !== values.length) {
    throw new Error("Compact client static-string manifest contains duplicate values.");
  }
  const actual = analyzeClientStaticStrings(source, values);
  for (let index = 0; index < manifest.length; index += 1) {
    const expected = manifest[index];
    const observed = actual[index];
    if (!Number.isSafeInteger(expected.count) || expected.count < 2
      || !/^[0-9a-f]{64}$/.test(expected.contextFingerprint)
      || observed.count !== expected.count
      || observed.contextFingerprint !== expected.contextFingerprint) {
      throw new Error(`Compact client static-string corpus drifted for ${JSON.stringify(expected.value)}.`);
    }
  }

  let compacted = source;
  const declarations = [];
  for (let index = 0; index < manifest.length; index += 1) {
    const literal = JSON.stringify(manifest[index].value);
    const name = `${SHARED_NAME_PREFIX}${index}`;
    declarations.push(`${name}=${literal}`);
    compacted = compacted.split(literal).join(`(${name})`);
  }
  if (manifest.some(({ value }) => compacted.includes(JSON.stringify(value)))) {
    throw new Error("Compact client static-string transform left a reviewed literal behind.");
  }
  return `const ${declarations.join(",")};${compacted}`;
}
