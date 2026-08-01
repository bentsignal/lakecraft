export function decodeStaticBytes(source: string, size: number): Uint8Array {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX.-:+=^!/*?&<>()[]{}@%$#_,";
  let packed = "";
  for (let cursor = 0; cursor < source.length; cursor += 5) {
    let value = 0;
    for (let digit = 0; digit < 5; digit += 1) value = value * 85 + alphabet.indexOf(source[cursor + digit]);
    for (let shift = 24; shift >= 0; shift -= 8) packed += String.fromCharCode(value >>> shift & 255);
  }
  const data = new Uint8Array(size);
  let target = 0;
  for (let cursor = 0; cursor < packed.length;) {
    const flags = packed.charCodeAt(cursor++);
    for (let bit = 0; bit < 8 && cursor < packed.length; bit += 1) {
      if (flags & 1 << bit) {
        const value = packed.charCodeAt(cursor++) * 256 + packed.charCodeAt(cursor++);
        const length = (value >> 12) + 3;
        const distance = value & 4_095;
        for (let copy = 0; copy < length; copy += 1) data[target] = data[target++ - distance];
      } else {
        data[target++] = packed.charCodeAt(cursor++);
      }
    }
  }
  return data;
}
