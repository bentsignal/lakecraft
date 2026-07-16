export const CSS_DICTIONARY_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const CSS_DICTIONARY_PREFIX = "~";
const CSS_INTERNAL_TOKEN_PREFIX = "\uE000";
const CSS_INTERNAL_TOKEN_SUFFIX = "\uE001";

// These names exist only in Lakecraft-owned client markup and CSS. Rewriting
// whole families before the generic namespace pass saves the repeated readable
// suffixes in production without touching shared wire fields or development
// builds. Keep longer families before their prefixes.
export const COMPACT_CLIENT_IDENTIFIER_FAMILIES = Object.freeze([
  ["lc-player-preview", "xd"],
  ["lc-inventory", "xe"],
  ["lc-first-person", "xb"],
  ["lc-held-voxel", "xa"],
  ["lc-player-list", "xg"],
  ["lc-game-menu", "xh"],
  ["lc-username", "xo"],
  ["lc-survival", "xu"],
  ["lc-crafting", "xv"],
  ["lc-account", "xn"],
  ["lc-furnace", "xc"],
  ["lc-server", "xq"],
  ["lc-recipe", "xf"],
  ["lc-death", "xk"],
  ["lc-meter", "xl"],
  ["lc-armor", "xm"],
  ["lc-chest", "xr"],
  ["lc-drawer", "xs"],
  ["lc-hotbar", "xz"],
  ["lc-title", "xp"],
  ["lc-toast", "xt"],
  ["lc-chat", "xi"],
  ["lc-item", "xj"],
  ["lc-menu", "xw"],
]);

export function cssDictionaryToken(index) {
  return `${CSS_DICTIONARY_PREFIX}${CSS_DICTIONARY_ALPHABET[index]}`;
}

function cssInternalDictionaryToken(index) {
  return `${CSS_INTERNAL_TOKEN_PREFIX}${CSS_DICTIONARY_ALPHABET[index]}${CSS_INTERNAL_TOKEN_SUFFIX}`;
}

export function minifyCssText(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

export function dictionaryCompressCss(css) {
  if (css.includes(CSS_DICTIONARY_PREFIX)) return null;
  const candidates = new Set();
  for (const match of css.matchAll(/[a-z-]{4,}:|\.[a-z][a-z0-9_-]*|var\(--[a-z0-9-]+|rgba\(|calc\(/g)) {
    candidates.add(match[0]);
  }
  const tokens = [...css.matchAll(/[.#]?-?[_a-zA-Z][\w-]*|#[0-9a-fA-F]+|-?\d*\.?\d+(?:%|px|em|rem|vh|vw|dvh|s)?|[{}:;,()]/g)];
  const repeatedSequences = new Map();
  for (let start = 0; start < tokens.length; start += 1) {
    for (let count = 2; count <= 16 && start + count <= tokens.length; count += 1) {
      const last = tokens[start + count - 1];
      const sequence = css.slice(tokens[start].index, last.index + last[0].length);
      if (sequence.length >= 5 && sequence.length <= 180) {
        repeatedSequences.set(sequence, (repeatedSequences.get(sequence) ?? 0) + 1);
      }
    }
  }
  for (const [sequence, count] of repeatedSequences) if (count >= 2) candidates.add(sequence);

  const dictionary = [];
  let compressed = css;
  while (dictionary.length < CSS_DICTIONARY_ALPHABET.length) {
    let best = null;
    for (const candidate of candidates) {
      const occurrences = compressed.split(candidate).length - 1;
      const gain = occurrences * (Buffer.byteLength(candidate) - 2) - Buffer.byteLength(candidate) - 2;
      if (!best || gain > best.gain) best = { candidate, gain };
    }
    if (!best || best.gain <= 0) break;
    candidates.delete(best.candidate);
    const token = cssInternalDictionaryToken(dictionary.length);
    dictionary.push(best.candidate);
    compressed = compressed.split(best.candidate).join(token);
  }
  for (let index = 0; index < dictionary.length; index += 1) {
    compressed = compressed.replaceAll(cssInternalDictionaryToken(index), cssDictionaryToken(index));
  }
  return dictionary.length ? { compressed, dictionary } : null;
}

export function dictionaryDecompressCss(packed) {
  return packed.compressed.replace(/~([0-9A-Za-z_$])/g, (token, suffix) => {
    const entry = packed.dictionary[CSS_DICTIONARY_ALPHABET.indexOf(suffix)];
    return entry ?? token;
  });
}

export function compactClientIdentifiers(source) {
  let compacted = source;
  for (const [readable, compact] of COMPACT_CLIENT_IDENTIFIER_FAMILIES) {
    compacted = compacted.replaceAll(readable, compact);
  }
  return compacted.replaceAll("lakecraft-", "y").replaceAll("lc-", "x");
}
