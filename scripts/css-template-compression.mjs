export const CSS_DICTIONARY_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const CSS_DICTIONARY_PREFIX = "~";

export function cssDictionaryToken(index) {
  return `${CSS_DICTIONARY_PREFIX}${CSS_DICTIONARY_ALPHABET[index]}${CSS_DICTIONARY_PREFIX}`;
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
      const gain = occurrences * (Buffer.byteLength(candidate) - 3) - Buffer.byteLength(candidate) - 3;
      if (!best || gain > best.gain) best = { candidate, gain };
    }
    if (!best || best.gain <= 0) break;
    candidates.delete(best.candidate);
    const token = cssDictionaryToken(dictionary.length);
    dictionary.push(best.candidate);
    compressed = compressed.split(best.candidate).join(token);
  }
  return dictionary.length ? { compressed, dictionary } : null;
}

export function dictionaryDecompressCss(packed) {
  return packed.compressed.replace(/~([0-9A-Za-z_$])~/g, (token, suffix) => {
    const entry = packed.dictionary[CSS_DICTIONARY_ALPHABET.indexOf(suffix)];
    return entry ?? token;
  });
}

export function compactClientIdentifiers(source) {
  return source.replaceAll("lakecraft-", "y").replaceAll("lc-", "x");
}
