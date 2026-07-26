export function decodeStaticBytes(source: string, size: number): Uint8Array {
  const packed = atob(source);
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
