const IDENTIFIER = "__lakecraftSharedBundleStrings";

const REGEX_PREFIX_KEYWORDS = new Set([
  "await", "case", "delete", "do", "else", "in", "instanceof", "new",
  "return", "throw", "typeof", "void", "yield",
]);
const EXPRESSION_PREFIX_KEYWORDS = new Set([
  "await", "case", "in", "instanceof", "return", "throw", "typeof", "void", "yield",
]);
const EXPRESSION_PREFIX_PUNCTUATORS = new Set([
  "(", "[", ",", ":", "?", "=", "=>",
  "+", "-", "*", "/", "%", "**", "!", "~", "&", "|", "^",
  "==", "===", "!=", "!==", "<", "<=", ">", ">=",
  "&&", "||", "??", "+=", "-=", "*=", "/=", "%=", "**=",
  "&=", "|=", "^=", "&&=", "||=", "??=", "<<", ">>", ">>>",
  "<<=", ">>=", ">>>=", "...",
]);
const PUNCTUATORS = [
  ">>>=", "===", "!==", "**=", "&&=", "||=", "??=", "<<=", ">>=", ">>>",
  "=>", "==", "!=", "<=", ">=", "++", "--", "**", "&&", "||", "??", "?.",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "...",
];

function isIdentifierStart(character) {
  return character === "$" || character === "_" || /[A-Za-z]/.test(character)
    || (character && character.charCodeAt(0) >= 0x80);
}

function isIdentifierPart(character) {
  return isIdentifierStart(character) || /[0-9]/.test(character);
}

function skipQuoted(source, offset, quote) {
  let cursor = offset + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
    if (source[cursor] === "\n" || source[cursor] === "\r") {
      throw new Error("Unterminated JavaScript string while hoisting bundle literals.");
    }
    cursor += 1;
  }
  throw new Error("Unterminated JavaScript string while hoisting bundle literals.");
}

function skipRegex(source, offset) {
  let cursor = offset + 1;
  let inClass = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === "[") inClass = true;
    else if (character === "]") inClass = false;
    else if (character === "/" && !inClass) {
      cursor += 1;
      while (isIdentifierPart(source[cursor])) cursor += 1;
      return cursor;
    } else if (character === "\n" || character === "\r") {
      throw new Error("Unterminated JavaScript regex while hoisting bundle literals.");
    }
    cursor += 1;
  }
  throw new Error("Unterminated JavaScript regex while hoisting bundle literals.");
}

function regexCanStartAfter(previous) {
  if (!previous) return true;
  if (previous.type === "identifier") return REGEX_PREFIX_KEYWORDS.has(previous.value);
  if (previous.type !== "punctuator") return false;
  return ![")", "]", "}", "++", "--", ".", "?."].includes(previous.value);
}

function skipTemplateExpression(source, offset) {
  let cursor = offset;
  let depth = 1;
  let previous = null;
  while (cursor < source.length) {
    const character = source[cursor];
    if (/\s/.test(character)) {
      cursor += 1;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "/") {
      const newline = source.indexOf("\n", cursor + 2);
      cursor = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "*") {
      const end = source.indexOf("*/", cursor + 2);
      if (end < 0) throw new Error("Unterminated JavaScript comment while hoisting bundle literals.");
      cursor = end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      cursor = skipQuoted(source, cursor, character);
      previous = { type: "string", value: character };
      continue;
    }
    if (character === "`") {
      cursor = skipTemplate(source, cursor);
      previous = { type: "template", value: "`" };
      continue;
    }
    if (character === "{") {
      depth += 1;
      cursor += 1;
      previous = { type: "punctuator", value: "{" };
      continue;
    }
    if (character === "}") {
      depth -= 1;
      cursor += 1;
      if (depth === 0) return cursor;
      previous = { type: "punctuator", value: "}" };
      continue;
    }
    if (character === "/" && regexCanStartAfter(previous)) {
      cursor = skipRegex(source, cursor);
      previous = { type: "regex", value: "/" };
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = cursor++;
      while (isIdentifierPart(source[cursor])) cursor += 1;
      previous = { type: "identifier", value: source.slice(start, cursor) };
      continue;
    }
    if (/[0-9]/.test(character)) {
      cursor += 1;
      while (source[cursor] && /[0-9A-Fa-f_xXoObBeE.]/.test(source[cursor])) cursor += 1;
      previous = { type: "number", value: "" };
      continue;
    }
    const punctuator = PUNCTUATORS.find((value) => source.startsWith(value, cursor)) ?? character;
    cursor += punctuator.length;
    previous = { type: "punctuator", value: punctuator };
  }
  throw new Error("Unterminated JavaScript template expression while hoisting bundle literals.");
}

function skipTemplate(source, offset) {
  let cursor = offset + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source[cursor] === "`") return cursor + 1;
    if (source[cursor] === "$" && source[cursor + 1] === "{") {
      cursor = skipTemplateExpression(source, cursor + 2);
      continue;
    }
    cursor += 1;
  }
  throw new Error("Unterminated JavaScript template while hoisting bundle literals.");
}

function tokenizeJavaScript(source) {
  const tokens = [];
  let cursor = 0;
  if (source.startsWith("#!")) {
    const newline = source.indexOf("\n", 2);
    cursor = newline < 0 ? source.length : newline + 1;
  }
  while (cursor < source.length) {
    const character = source[cursor];
    if (/\s/.test(character)) {
      cursor += 1;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "/") {
      const newline = source.indexOf("\n", cursor + 2);
      cursor = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "*") {
      const end = source.indexOf("*/", cursor + 2);
      if (end < 0) throw new Error("Unterminated JavaScript comment while hoisting bundle literals.");
      cursor = end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const start = cursor;
      cursor = skipQuoted(source, cursor, character);
      tokens.push({ type: "string", value: source.slice(start, cursor), start, end: cursor });
      continue;
    }
    if (character === "`") {
      const start = cursor;
      cursor = skipTemplate(source, cursor);
      tokens.push({ type: "template", value: "`", start, end: cursor });
      continue;
    }
    const previous = tokens[tokens.length - 1] ?? null;
    if (character === "/" && regexCanStartAfter(previous)) {
      const start = cursor;
      cursor = skipRegex(source, cursor);
      tokens.push({ type: "regex", value: "/", start, end: cursor });
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = cursor++;
      while (isIdentifierPart(source[cursor])) cursor += 1;
      tokens.push({ type: "identifier", value: source.slice(start, cursor), start, end: cursor });
      continue;
    }
    if (/[0-9]/.test(character)) {
      const start = cursor++;
      while (source[cursor] && /[0-9A-Fa-f_xXoObBeE.]/.test(source[cursor])) cursor += 1;
      tokens.push({ type: "number", value: source.slice(start, cursor), start, end: cursor });
      continue;
    }
    const punctuator = PUNCTUATORS.find((value) => source.startsWith(value, cursor)) ?? character;
    tokens.push({ type: "punctuator", value: punctuator, start: cursor, end: cursor + punctuator.length });
    cursor += punctuator.length;
  }
  return tokens;
}

function directiveInsertion(source, tokens) {
  let offset = source.startsWith("#!") ? (source.indexOf("\n", 2) + 1 || source.length) : 0;
  let tokenIndex = 0;
  while (tokens[tokenIndex]?.start < offset) tokenIndex += 1;
  let needsSemicolon = false;
  while (tokens[tokenIndex]?.type === "string") {
    const directive = tokens[tokenIndex];
    const next = tokens[tokenIndex + 1];
    if (next?.value === ";") {
      offset = next.end;
      needsSemicolon = false;
      tokenIndex += 2;
      continue;
    }
    if (!next || /[\n\r]/.test(source.slice(directive.end, next.start))) {
      offset = directive.end;
      needsSemicolon = true;
      tokenIndex += 1;
      continue;
    }
    break;
  }
  return { offset, needsSemicolon };
}

function isModuleSpecifier(tokens, index) {
  const previous = tokens[index - 1];
  const beforePrevious = tokens[index - 2];
  if (previous?.type === "identifier" && (previous.value === "from" || previous.value === "import")) return true;
  if (previous?.value !== "(" || beforePrevious?.type !== "identifier") return false;
  if (beforePrevious.value === "import" || beforePrevious.value === "require") return true;
  if (beforePrevious.value !== "resolve" || tokens[index - 3]?.value !== ".") return false;
  const receiver = tokens.slice(Math.max(0, index - 8), index - 3).map(({ value }) => value).join("");
  return receiver.endsWith("require") || receiver.endsWith("import.meta");
}

function isSafeExpressionString(tokens, index) {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  if (!previous || !next || isModuleSpecifier(tokens, index)) return false;
  if ([":", "(", "=", "=>"].includes(next.value)) return false;
  if (previous.type === "identifier") return EXPRESSION_PREFIX_KEYWORDS.has(previous.value);
  return previous.type === "punctuator" && EXPRESSION_PREFIX_PUNCTUATORS.has(previous.value);
}

/**
 * Hoist exact allowlisted string-expression tokens from valid bundled JS.
 * The lexer skips comments, regexes, and complete templates; the context gate
 * excludes directives, imports, property names, and quoted methods/fields.
 */
export function hoistRepeatedBundleStrings(source, candidates) {
  if (source.includes(IDENTIFIER)) throw new Error("Reserved bundle string identifier already exists.");
  const tokens = tokenizeJavaScript(source);
  const chosen = [];
  const replacements = [];
  for (const candidate of [...new Set(candidates)]) {
    if (typeof candidate !== "string" || candidate.length < 8 || /["\\\n\r]/.test(candidate)) continue;
    const literal = JSON.stringify(candidate);
    const matches = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token, index }) => token.type === "string"
        && token.value === literal
        && isSafeExpressionString(tokens, index));
    const reference = `${IDENTIFIER}[${chosen.length}]`;
    if (matches.length < 3 || matches.length * (literal.length - 4) <= literal.length + 4) continue;
    for (const { token } of matches) replacements.push({ ...token, value: reference });
    chosen.push(candidate);
  }
  if (!chosen.length) return source;
  const insertion = directiveInsertion(source, tokens);
  replacements.push({
    start: insertion.offset,
    end: insertion.offset,
    value: `${insertion.needsSemicolon ? ";" : ""}const ${IDENTIFIER}=${JSON.stringify(chosen)};`,
  });
  replacements.sort((left, right) => left.start - right.start);
  let cursor = 0;
  let output = "";
  for (const replacement of replacements) {
    output += source.slice(cursor, replacement.start) + replacement.value;
    cursor = replacement.end;
  }
  return output + source.slice(cursor);
}

export const CLIENT_BUNDLE_SHARED_STRINGS = Object.freeze([
  "crafting_table", "invalid_snapshot", "invalid_coordinate", "stone_bricks",
  "stone_brick_slab", "cobblestone", "invalid_inventory", "inventory_action_pending",
  "invalid_slot", "no_capacity", "oak_fence_gate", "invalid_state", "iron_ingot",
  "flint_and_steel", "invalid_action", "diamond_ore", "gunpowder", "empty_source",
  "storage_read_failed", "incompatible_stack", "visibilitychange", "aria-labelledby",
  "aria-hidden", "aria-label", "aria-modal", "aria-live",
  "durability", "oak_fence_gate_open", "gold_ingot", "oak_fence_gate_closed",
  "cooked_chicken", "selectedHotbar", "iron_ore", "gold_ore", "coal_ore",
  "oak_fence", "inventory", "previousX", "previousY", "previousZ", "door_open",
  "raw_iron", "raw_gold", "door_closed",
]);

export const SERVER_BUNDLE_SHARED_STRINGS = Object.freeze([
  "operation_id_reused", "authentication_required", "active_presence_required",
  "conservation_failure", "invalid_request", "duplicate_state", "inventory_required",
  "invalid_server_state", "invalid_world_state", "invalid_receipt", "invalid_operation_id",
  "authority_unavailable", "invalid_chunk_keys", "combat_revision_exhausted",
  "invalid_player_state", "inventory_invalid", "replay_state_unavailable",
  "invalid_growth_plan", "invalid_checkpoint", "invalid_coordinate", "invalid_shape",
  "stone_brick_slab", "oak_fence_gate_closed", "oak_fence_gate_open", "oak_fence_gate",
  "crafting_table", "cobblestone", "stone_bricks",
  "receiptCreatedAt", "operationId", "by_user_created", "expectedRevision",
  "expectedInventoryUpdatedAt", "door_open", "selectedHotbar", "by_user_operation",
  "playerStateJson", "diamond_ore", "coordKey", "expiresAt", "iron_ingot",
  "gold_ingot", "coal_ore", "iron_ore", "gold_ore", "cooked_chicken",
  "sourceSlot", "out_of_reach",
]);
