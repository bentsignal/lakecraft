export const CSS_DICTIONARY_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const CSS_DICTIONARY_PREFIX = "~";
const CSS_INTERNAL_TOKEN_PREFIX = "\uE000";
const CSS_INTERNAL_TOKEN_SUFFIX = "\uE001";
export const CSS_BUNDLE_SEPARATOR = "\u0001";
export const CSS_BUNDLE_MAX_DISTANCE = 262_144;
const CSS_BUNDLE_TOKEN_PREFIXES = "~^`";
const CSS_BUNDLE_MIN_LENGTH = 5;
const CSS_BUNDLE_MAX_LENGTH = 67;
const CSS_BUNDLE_MAX_CANDIDATES = 256;

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

function cssBundleTokenSize(distance) {
  return distance <= 64 ? 3 : distance <= 4_096 ? 4 : 5;
}

function cssBundleToken(distance, length) {
  const encodedDistance = distance - 1;
  const encodedLength = CSS_DICTIONARY_ALPHABET[length - CSS_BUNDLE_MIN_LENGTH];
  if (distance <= 64) return `~${CSS_DICTIONARY_ALPHABET[encodedDistance]}${encodedLength}`;
  if (distance <= 4_096) {
    return `^${CSS_DICTIONARY_ALPHABET[encodedDistance >> 6]}${CSS_DICTIONARY_ALPHABET[encodedDistance & 63]}${encodedLength}`;
  }
  return `\`${CSS_DICTIONARY_ALPHABET[encodedDistance >> 12]}${CSS_DICTIONARY_ALPHABET[(encodedDistance >> 6) & 63]}${CSS_DICTIONARY_ALPHABET[encodedDistance & 63]}${encodedLength}`;
}

/** Long-window packing shared by every staged stylesheet, never development source. */
export function bundleCompressCss(css) {
  if (typeof css !== "string" || [...CSS_BUNDLE_TOKEN_PREFIXES].some((token) => css.includes(token))) {
    return null;
  }
  const positionsByPrefix = new Map();
  let compressed = "";
  let tokenCount = 0;
  for (let cursor = 0; cursor < css.length;) {
    let bestLength = 0;
    let bestDistance = 0;
    let bestGain = 0;
    if (cursor + CSS_BUNDLE_MIN_LENGTH <= css.length) {
      const prefix = css.slice(cursor, cursor + CSS_BUNDLE_MIN_LENGTH);
      const positions = positionsByPrefix.get(prefix) ?? [];
      let candidatesChecked = 0;
      for (let index = positions.length - 1; index >= 0; index -= 1) {
        const source = positions[index];
        const distance = cursor - source;
        if (distance > CSS_BUNDLE_MAX_DISTANCE) break;
        candidatesChecked += 1;
        let length = CSS_BUNDLE_MIN_LENGTH;
        const maximum = Math.min(CSS_BUNDLE_MAX_LENGTH, css.length - cursor);
        while (length < maximum && css[source + length] === css[cursor + length]) length += 1;
        const gain = length - cssBundleTokenSize(distance);
        if (gain > bestGain) {
          bestLength = length;
          bestDistance = distance;
          bestGain = gain;
          if (length === CSS_BUNDLE_MAX_LENGTH) break;
        }
        if (candidatesChecked >= CSS_BUNDLE_MAX_CANDIDATES) break;
      }
    }
    const consumed = bestGain > 0 ? bestLength : 1;
    if (bestGain > 0) {
      compressed += cssBundleToken(bestDistance, bestLength);
      tokenCount += 1;
    } else {
      compressed += css[cursor];
    }
    for (let offset = 0; offset < consumed; offset += 1) {
      const position = cursor + offset;
      if (position + CSS_BUNDLE_MIN_LENGTH > css.length) break;
      const prefix = css.slice(position, position + CSS_BUNDLE_MIN_LENGTH);
      const positions = positionsByPrefix.get(prefix) ?? [];
      positions.push(position);
      while (positions.length && position - positions[0] > CSS_BUNDLE_MAX_DISTANCE) positions.shift();
      positionsByPrefix.set(prefix, positions);
    }
    cursor += consumed;
  }
  return tokenCount ? { compressed, tokenCount } : null;
}

export function bundleDecompressCss(packed) {
  if (!packed || typeof packed.compressed !== "string") throw new TypeError("Invalid CSS bundle payload.");
  const source = packed.compressed;
  let output = "";
  for (let cursor = 0; cursor < source.length;) {
    const prefix = source[cursor];
    const digits = prefix === "~" ? 1 : prefix === "^" ? 2 : prefix === "`" ? 3 : 0;
    if (!digits) {
      output += prefix;
      cursor += 1;
      continue;
    }
    if (cursor + digits + 2 > source.length) throw new Error("Truncated CSS bundle token.");
    let encodedDistance = 0;
    for (let digit = 0; digit < digits; digit += 1) {
      const value = CSS_DICTIONARY_ALPHABET.indexOf(source[cursor + digit + 1]);
      if (value < 0) throw new Error("Malformed CSS bundle token.");
      encodedDistance = encodedDistance * 64 + value;
    }
    const encodedLength = CSS_DICTIONARY_ALPHABET.indexOf(source[cursor + digits + 1]);
    if (encodedLength < 0 || encodedLength > CSS_BUNDLE_MAX_LENGTH - CSS_BUNDLE_MIN_LENGTH) {
      throw new Error("Malformed CSS bundle token.");
    }
    const distance = encodedDistance + 1;
    if (distance > output.length) throw new Error("CSS bundle token references unavailable output.");
    let length = encodedLength + CSS_BUNDLE_MIN_LENGTH;
    while (length > 0) {
      output += output[output.length - distance];
      length -= 1;
    }
    cursor += digits + 2;
  }
  return output;
}

/** Dependency-free decoder emitted once in the compact staged client. */
export function cssBundleRuntimeExpression(packed) {
  const payload = JSON.stringify(packed.compressed);
  const alphabet = JSON.stringify(CSS_DICTIONARY_ALPHABET);
  return `(()=>{let o="",s=${payload},a=${alphabet};for(let i=0;i<s.length;){let p=s[i],n=p=="~"?1:p=="^"?2:p=="\`"?3:0;if(!n){o+=p;i++;continue}let d=0,j=0;for(;j<n;j++)d=d*64+a.indexOf(s[i+j+1]);d++;let l=a.indexOf(s[i+n+1])+5;i+=n+2;for(;l--;)o+=o[o.length-d]}return o})()`;
}
