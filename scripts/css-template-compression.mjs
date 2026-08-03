export const CSS_DICTIONARY_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
const CSS_DICTIONARY_PREFIX = "~";
const CSS_INTERNAL_TOKEN_PREFIX = "\uE000";
const CSS_INTERNAL_TOKEN_SUFFIX = "\uE001";
export const CSS_BUNDLE_SEPARATOR = "\u0001";
export const CSS_BUNDLE_MAX_DISTANCE = 262_144;
const CSS_BUNDLE_TOKEN_PREFIXES = "~^`";
const CSS_BUNDLE_MIN_LENGTH = 5;
const CSS_BUNDLE_MAX_LENGTH = 68;
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
  ["lc-creative", "xy"],
]);

const CSS_PRIVATE_IDENTIFIER_ALPHABET = CSS_DICTIONARY_ALPHABET.replace("$", "");

function parsePrivateIdentifierRows(rows) {
  return Object.freeze(rows.trim().split(/\s+/).map((row) => {
    const separator = row.lastIndexOf("|");
    return Object.freeze([row.slice(0, separator), Number(row.slice(separator + 1))]);
  }));
}

// This fixed, reviewed live set contains only Lakecraft-owned CSS/DOM names.
// Order is stable and assigns the shortest outputs to the most frequent names.
const COMPACT_CLIENT_PRIVATE_IDENTIFIER_ROWS = parsePrivateIdentifierRows(`
xe-window|21 xi-peek|18 xi-compose|14 xi-message|13 xw-button|15
xc-inventory-slot|11 xj-glyph|12 xo-menu|11 xe-grid__slot|13 xj-icon__svg|10 xn-panel|10
xlocal-world-dialog|9 xoptions|9 ysleep|9 xslot|15 xunsupported|8 xg__signal|8 xc-slot|8
xm-slot|10 xp-logo|9 xq-icon|8 xr-slot|8 xclose|9 yquery-recovery|7 xq-population|7
xworld-line|7 xc__header|7 xk-screen|7 xp-cloud|9 xe-grid|11 xlocal-world-header|6
xlocal-world-search|6 xlocal-world-select|6 xoptions__slider|7 xpointer-capture|6
xe-titlebar|7 xcrosshair|6 xq-browser|6 xp-footer|7 xs-layer|7 xlocal-world-browser|5
xlocal-world-delete|5 xq-browser__content|5 xselected-item-name|5 xi-dialog|5 xv-result|5
xe-upper|5 xo-layer|5 xz__slot|5 xo-help|5 xp-tree|7 xq-copy|5 xq-row|5 xlocal-world-titlebar|5
xingredient__icon|4 xlocal-world-row|4 xcursor-stack|5 xs__heading|4 xf__output|4
xj-tooltip|4 xq-actions|4 xc__arrow|4 xh__reset|4 xp-screen|5 xk-layer|4 xw-layer|4
xm-rack|4 xp-menu|5 xq-hint|6 yerror|4 xhud|4 xlocal-world-back|4 xc-inventory-grid|3
xk-screen__status|3 xdirt-background|3 xequipment-panel|3 xk-screen__score|3
xoptions-dialog|3 xoptions__done|3 xoptions__grid|3 xc__inventory|3 xr-status-row|3
xsection-rule|3 xsingleplayer|3 xv-workspace|3 ysleep-layer|3 xc__station|3 xdurability|3
xingredient|3 xlocal-perf|3 xp-panorama|4 xc__status|3 xp-content|4 xc__flame|3
xr-status|3 xc-layer|3 xd__head|3 xl__icon|3 xp-hills|5 xr-layer|3 xs__body|3 xlocal-world-feedback|3
xv-panel|3 xd__arm|3 xd__leg|3 xu-wrap|3 xv-slot|3 xw-link|3 yperf|3
xc-inventory-grid--hotbar|2 xsingleplayer-coordinates|2 xlocal-world-delete-copy|3
xh__autosave-status|2 xunsupported__stamp|2 xc-inventory-title|2 xh__last-autosaved|2
xh-autosave-status|2 xk-screen__buttons|2 xlocal-world-empty|3 xlocal-world-retry|2
xunsupported__card|2 xunsupported__icon|2 xunsupported__topo|2 xunsupported-title|2 xlocal-world-feedback-copy|2 xlocal-world-stage|2
xlocal-world-list|2 xk-screen__cause|2 xf__ingredients|2 xj-glyph__count|2
xr-grid--player|2 ysleep__actions|2 xd__arm--right|2 xd__leg--right|2 xl__fill-layer|2
xm-slot__label|3 xoptions-layer|2 xoptions-title|2 xd__arm--left|2 xd__leg--left|2
xl__highlight|2 ysleep-title|2 xh__buttons|2 xl__outline|2 xpack-panel|2 xpack-title|2
xc__source|2 xf__action|2 xh-options|2 xi-history|2 xp-options|2 xi-unread|2
xl__empty|2 xm-column|2 xp-ground|3 xc-title|2 xd__body|2 xe-title|4 xg__head|2
xh-title|2 xi-input|2 xk-cause|2 xk-score|2 xk-title|2 xl__fill|2 xp-error|2
xp-shade|3 xr-retry|2 xr-title|2 xv-arrow|2 xv-title|2 xkicker|2 xn-head|2
xq-list|2 xr-grid|2 xv-grid|2 xp-sun|3 yshell|2 yworld|2 xt-in|2
xworld-browser-title|1 xworld-dialog-title|1 xh__disconnect|1 xpencil-note|1
xf__number|1 xp-loading|1 xf__arrow|1 xe-error|3 xf-list|1 xj-icon|1 xw-row|1
xy-grid|8 xy-tabs|4 xy-search|3 xy-empty|2 xy-window|11 xy-workspace|3 xy-pane|7
xy-pane--player|3 xy-pane--catalog|1 xy-switch|6 xy-grid-wrap|3 xy-armor|3
xy-catalog|2 xy-help|2 xy-player|2 xsilent-recapture|2
`);

const COMPACT_CLIENT_PRIVATE_CUSTOM_PROPERTY_ROWS = parsePrivateIdentifierRows(`
xpixel-font|52 xnote|16 xc-slot|10 xr-slot|6 xpaper|6 xmoss|6 xink|6 xamber|5
xrust|5 xt-edge|4 xcharcoal|2 xdisplay|2 xmoss-bright|1 xpaper-deep|1 xshadow|1 xline|1 xy-slot|13
`);

function privateIdentifierCode(index) {
  let remaining = index;
  let code = "Z";
  do {
    code += CSS_PRIVATE_IDENTIFIER_ALPHABET[remaining % CSS_PRIVATE_IDENTIFIER_ALPHABET.length];
    remaining = Math.floor(remaining / CSS_PRIVATE_IDENTIFIER_ALPHABET.length) - 1;
  } while (remaining >= 0);
  return code;
}

export const COMPACT_CLIENT_PRIVATE_IDENTIFIERS = Object.freeze([
  ...COMPACT_CLIENT_PRIVATE_IDENTIFIER_ROWS.map(([readable, expectedCount], index) => (
    Object.freeze([readable, privateIdentifierCode(index), expectedCount])
  )),
  ...COMPACT_CLIENT_PRIVATE_CUSTOM_PROPERTY_ROWS.map(([readable, expectedCount], index) => (
    Object.freeze([`--${readable}`, `--${privateIdentifierCode(index)}`, expectedCount])
  )),
]);

// These are the only runtime-composed class prefixes in the client corpus.
// Prefix replacement also covers their concrete stylesheet variants.
export const COMPACT_CLIENT_PRIVATE_IDENTIFIER_PREFIXES = Object.freeze([
  Object.freeze(["xc-slot--", "Yq0", 1]),
  Object.freeze(["xj-glyph--", "Yq1", 3]),
  Object.freeze(["xl--", "Yq2", 7]),
  Object.freeze(["xt--", "Yq3", 3]),
]);

const REVIEWED_COMPACT_IDENTIFIER_EXEMPTIONS = Object.freeze([
  "xr", "xc", "xz", "xu", "xl", "xf", "xg", "xh", "xts", "xt", "xs", "xd",
  // Generated texture-atlas provenance comment; never a DOM or CSS identifier.
  "ymaterials-v1",
]);

function isCssIdentifierCharacter(character) {
  return character !== undefined && /[A-Za-z0-9_-]/.test(character);
}

function replaceBoundedIdentifier(source, readable, compact, prefix = false) {
  let cursor = 0;
  let output = "";
  let count = 0;
  while (cursor < source.length) {
    const index = source.indexOf(readable, cursor);
    if (index < 0) {
      output += source.slice(cursor);
      break;
    }
    const before = source[index - 1];
    const after = source[index + readable.length];
    if (!isCssIdentifierCharacter(before) && (prefix || !isCssIdentifierCharacter(after))) {
      output += source.slice(cursor, index) + compact;
      cursor = index + readable.length;
      count += 1;
    } else {
      output += source.slice(cursor, index + readable.length);
      cursor = index + readable.length;
    }
  }
  return { source: output, count };
}

function compactClientIdentifierNamespace(source) {
  let compacted = source;
  for (const [readable, compact] of COMPACT_CLIENT_IDENTIFIER_FAMILIES) {
    compacted = compacted.replaceAll(readable, compact);
  }
  return compacted.replaceAll("lakecraft-", "y").replaceAll("lc-", "x");
}

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
  let compacted = compactClientIdentifierNamespace(source);
  for (const [readable, compact] of COMPACT_CLIENT_PRIVATE_IDENTIFIER_PREFIXES) {
    compacted = replaceBoundedIdentifier(compacted, readable, compact, true).source;
  }
  for (const [readable, compact] of COMPACT_CLIENT_PRIVATE_IDENTIFIERS) {
    compacted = replaceBoundedIdentifier(compacted, readable, compact).source;
  }
  return compacted;
}

export function auditCompactClientIdentifierCorpus(sources) {
  if (!Array.isArray(sources) || sources.some((source) => typeof source !== "string")) {
    throw new TypeError("Compact client identifier audit requires a source string array.");
  }
  const source = sources.map(compactClientIdentifierNamespace).join("\n");
  const compactTargets = new Set();
  for (const [readable, compact, expectedCount] of COMPACT_CLIENT_PRIVATE_IDENTIFIERS) {
    const actualCount = replaceBoundedIdentifier(source, readable, compact).count;
    if (actualCount !== expectedCount) {
      throw new Error(`Compact client identifier live set changed for ${readable}: expected ${expectedCount}, found ${actualCount}.`);
    }
    if (compactTargets.has(compact)) throw new Error(`Duplicate compact client identifier target: ${compact}.`);
    compactTargets.add(compact);
    if (replaceBoundedIdentifier(source, compact, compact).count !== 0) {
      throw new Error(`Compact client identifier target already exists in source: ${compact}.`);
    }
  }
  for (const [readable, compact, expectedCount] of COMPACT_CLIENT_PRIVATE_IDENTIFIER_PREFIXES) {
    const actualCount = replaceBoundedIdentifier(source, readable, compact, true).count;
    if (actualCount !== expectedCount) {
      throw new Error(`Compact client identifier prefix live set changed for ${readable}: expected ${expectedCount}, found ${actualCount}.`);
    }
    if (compactTargets.has(compact)) throw new Error(`Duplicate compact client identifier target: ${compact}.`);
    compactTargets.add(compact);
    if (replaceBoundedIdentifier(source, compact, compact, true).count !== 0) {
      throw new Error(`Compact client identifier prefix target already exists in source: ${compact}.`);
    }
  }

  const reviewedNames = new Set([
    ...COMPACT_CLIENT_PRIVATE_IDENTIFIERS.map(([readable]) => readable),
    ...REVIEWED_COMPACT_IDENTIFIER_EXEMPTIONS,
  ]);
  for (const rawSource of sources) {
    for (const match of rawSource.matchAll(/--(?:lc|lakecraft)-[A-Za-z0-9_-]+|(?:lc|lakecraft)-[A-Za-z0-9_-]+/g)) {
      const readable = compactClientIdentifierNamespace(match[0]);
      if (
        reviewedNames.has(readable)
        || COMPACT_CLIENT_PRIVATE_IDENTIFIER_PREFIXES.some(([prefix]) => readable.startsWith(prefix))
      ) continue;
      throw new Error(`Unreviewed Lakecraft-private client identifier: ${match[0]}.`);
    }
  }

  const compacted = compactClientIdentifiers(source);
  for (const [readable] of COMPACT_CLIENT_PRIVATE_IDENTIFIERS) {
    if (replaceBoundedIdentifier(compacted, readable, readable).count !== 0) {
      throw new Error(`Readable client identifier survived compaction: ${readable}.`);
    }
  }
  for (const [readable] of COMPACT_CLIENT_PRIVATE_IDENTIFIER_PREFIXES) {
    if (replaceBoundedIdentifier(compacted, readable, readable, true).count !== 0) {
      throw new Error(`Readable client identifier prefix survived compaction: ${readable}.`);
    }
  }
  return true;
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
  const matches = new Array(css.length);
  for (let cursor = 0; cursor < css.length; cursor += 1) {
    const bestByTokenSize = [];
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
        const tokenSize = cssBundleTokenSize(distance);
        const prior = bestByTokenSize[tokenSize];
        if (!prior || length > prior.length || (length === prior.length && distance < prior.distance)) {
          bestByTokenSize[tokenSize] = { distance, length, tokenSize };
        }
        if (candidatesChecked >= CSS_BUNDLE_MAX_CANDIDATES) break;
      }
    }
    matches[cursor] = bestByTokenSize.filter(Boolean);
    if (cursor + CSS_BUNDLE_MIN_LENGTH > css.length) continue;
    const prefix = css.slice(cursor, cursor + CSS_BUNDLE_MIN_LENGTH);
    const positions = positionsByPrefix.get(prefix) ?? [];
    positions.push(cursor);
    while (positions.length && cursor - positions[0] > CSS_BUNDLE_MAX_DISTANCE) positions.shift();
    positionsByPrefix.set(prefix, positions);
  }

  const costs = new Uint32Array(css.length + 1);
  const choices = new Array(css.length);
  for (let cursor = css.length - 1; cursor >= 0; cursor -= 1) {
    let best = { cost: 1 + costs[cursor + 1], distance: 0, length: 1 };
    for (const match of matches[cursor]) {
      for (let length = CSS_BUNDLE_MIN_LENGTH; length <= match.length; length += 1) {
        const cost = match.tokenSize + costs[cursor + length];
        if (cost < best.cost || (cost === best.cost && length > best.length)) {
          best = { cost, distance: match.distance, length };
        }
      }
    }
    costs[cursor] = best.cost;
    choices[cursor] = best;
  }

  let compressed = "";
  let tokenCount = 0;
  for (let cursor = 0; cursor < css.length;) {
    const choice = choices[cursor];
    if (choice.distance) {
      compressed += cssBundleToken(choice.distance, choice.length);
      tokenCount += 1;
    } else compressed += css[cursor];
    cursor += choice.length;
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
