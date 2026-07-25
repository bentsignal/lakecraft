export const CSS_LZ_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
export const CSS_LZ_PREFIX = "~";
export const CSS_LZ_MAX_DISTANCE = 4_096;
export const CSS_LZ_MIN_LENGTH = 5;
export const CSS_LZ_MAX_LENGTH = 67;

const MAX_CANDIDATES_PER_POSITION = 96;

function cssLzToken(distance, length) {
  const encodedDistance = distance - 1;
  return CSS_LZ_PREFIX
    + CSS_LZ_ALPHABET[encodedDistance >> 6]
    + CSS_LZ_ALPHABET[encodedDistance & 63]
    + CSS_LZ_ALPHABET[length - CSS_LZ_MIN_LENGTH];
}

/**
 * Deterministically packs repeated CSS text into four-ASCII-character tokens:
 * `~`, two base64 digits for a 1..4096 back-reference, and one digit for a
 * 5..67-character match. A literal `~` is deliberately unsupported so the
 * decoder never has an ambiguous escape path.
 */
export function lzCompressCss(css) {
  if (typeof css !== "string" || css.includes(CSS_LZ_PREFIX)) return null;

  const positionsByPrefix = new Map();
  let compressed = "";
  let tokenCount = 0;

  for (let cursor = 0; cursor < css.length;) {
    let bestLength = 0;
    let bestDistance = 0;
    if (cursor + CSS_LZ_MIN_LENGTH <= css.length) {
      const prefix = css.slice(cursor, cursor + CSS_LZ_MIN_LENGTH);
      const positions = positionsByPrefix.get(prefix) ?? [];
      let candidatesChecked = 0;
      for (let index = positions.length - 1; index >= 0; index -= 1) {
        const source = positions[index];
        const distance = cursor - source;
        if (distance > CSS_LZ_MAX_DISTANCE) break;
        candidatesChecked += 1;
        let length = CSS_LZ_MIN_LENGTH;
        const maximum = Math.min(CSS_LZ_MAX_LENGTH, css.length - cursor);
        while (length < maximum && css[source + length] === css[cursor + length]) length += 1;
        if (length > bestLength) {
          bestLength = length;
          bestDistance = distance;
          if (length === CSS_LZ_MAX_LENGTH) break;
        }
        if (candidatesChecked >= MAX_CANDIDATES_PER_POSITION) break;
      }
    }

    const consumed = bestLength >= CSS_LZ_MIN_LENGTH ? bestLength : 1;
    if (bestLength >= CSS_LZ_MIN_LENGTH) {
      compressed += cssLzToken(bestDistance, bestLength);
      tokenCount += 1;
    } else {
      compressed += css[cursor];
    }

    for (let offset = 0; offset < consumed; offset += 1) {
      const position = cursor + offset;
      if (position + CSS_LZ_MIN_LENGTH > css.length) break;
      const prefix = css.slice(position, position + CSS_LZ_MIN_LENGTH);
      const positions = positionsByPrefix.get(prefix) ?? [];
      positions.push(position);
      while (positions.length && position - positions[0] > CSS_LZ_MAX_DISTANCE) positions.shift();
      positionsByPrefix.set(prefix, positions);
    }
    cursor += consumed;
  }

  return tokenCount ? { compressed, tokenCount } : null;
}

export function lzDecompressCss(packed) {
  if (!packed || typeof packed.compressed !== "string") {
    throw new TypeError("Invalid CSS LZ payload.");
  }
  const source = packed.compressed;
  let output = "";
  for (let cursor = 0; cursor < source.length;) {
    if (source[cursor] !== CSS_LZ_PREFIX) {
      output += source[cursor];
      cursor += 1;
      continue;
    }
    if (cursor + 4 > source.length) throw new Error("Truncated CSS LZ token.");
    const distanceHigh = CSS_LZ_ALPHABET.indexOf(source[cursor + 1]);
    const distanceLow = CSS_LZ_ALPHABET.indexOf(source[cursor + 2]);
    const encodedLength = CSS_LZ_ALPHABET.indexOf(source[cursor + 3]);
    if (distanceHigh < 0 || distanceLow < 0 || encodedLength < 0 || encodedLength > 62) {
      throw new Error("Malformed CSS LZ token.");
    }
    const distance = (distanceHigh << 6 | distanceLow) + 1;
    const length = encodedLength + CSS_LZ_MIN_LENGTH;
    if (distance > output.length) throw new Error("CSS LZ token references unavailable output.");
    for (let remaining = length; remaining > 0; remaining -= 1) {
      output += output[output.length - distance];
    }
    cursor += 4;
  }
  return output;
}

/** Returns the compact, dependency-free expression embedded in staged client code. */
export function cssLzRuntimeExpression(packed) {
  const payload = JSON.stringify(packed.compressed);
  const alphabet = JSON.stringify(CSS_LZ_ALPHABET);
  return `(()=>{let o="",s=${payload},a=${alphabet};for(let i=0;i<s.length;){if(s[i]!="~"){o+=s[i++];continue}let d=(a.indexOf(s[i+1])<<6|a.indexOf(s[i+2]))+1,l=a.indexOf(s[i+3])+5;i+=4;for(;l--;)o+=o[o.length-d]}return o})()`;
}
