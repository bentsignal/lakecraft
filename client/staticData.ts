export function decodeStaticBytes(source: string, size: number, packedSize: number, extended = false): Uint8Array {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX.-:+=^!/*?&<>()[]{}@%$#_,";
  const invalid = (): never => { throw new Error("Invalid static data."); };
  if (size < 0 || size % 1 || source.length % 5) invalid();
  let packed = "";
  for (let cursor = 0; cursor < source.length; cursor += 5) {
    let value = 0;
    for (let digit = 0; digit < 5; digit += 1) {
      const index = alphabet.indexOf(source[cursor + digit]);
      if (index < 0) invalid();
      value = value * 85 + index;
    }
    if (value > 4_294_967_295) invalid();
    for (let shift = 24; shift >= 0; shift -= 8) packed += String.fromCharCode(value >>> shift & 255);
  }
  if (packedSize < 0 || packedSize % 1 || packedSize > packed.length || packedSize < packed.length - 3) invalid();
  for (let cursor = packedSize; cursor < packed.length; cursor += 1) if (packed.charCodeAt(cursor)) invalid();
  packed = packed.slice(0, packedSize);
  const data = new Uint8Array(size);
  let target = 0;
  let cursor = 0;
  while (target < size) {
    if (cursor >= packed.length) invalid();
    const flags = packed.charCodeAt(cursor++);
    let bit = 0;
    for (; bit < 8 && target < size; bit += 1) {
      if (flags & 1 << bit) {
        if (cursor + 2 > packed.length) invalid();
        const value = packed.charCodeAt(cursor++) * 256 + packed.charCodeAt(cursor++);
        let length = (value >> 12) + 3;
        if (extended && length === 18) {
          if (cursor >= packed.length) invalid();
          length += packed.charCodeAt(cursor++);
        }
        const distance = value & 4_095;
        if (!distance || distance > target || target + length > size) invalid();
        for (let copy = 0; copy < length; copy += 1) data[target] = data[target++ - distance];
      } else {
        if (cursor >= packed.length) invalid();
        data[target++] = packed.charCodeAt(cursor++);
      }
    }
    if (flags >> bit) invalid();
  }
  if (cursor !== packed.length) invalid();
  return data;
}
