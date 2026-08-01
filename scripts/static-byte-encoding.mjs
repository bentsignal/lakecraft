export const STATIC_BYTE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX.-:+=^!/*?&<>()[]{}@%$#_,";

export function encodeStaticBytes(bytes) {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 4) {
    let value = 0;
    for (let index = 0; index < 4; index += 1) value = value * 256 + (bytes[offset + index] ?? 0);
    const digits = new Array(5);
    for (let index = 4; index >= 0; index -= 1) {
      digits[index] = STATIC_BYTE_ALPHABET[value % 85];
      value = Math.floor(value / 85);
    }
    encoded += digits.join("");
  }
  return encoded;
}

export function decodeStaticEncoding(source) {
  if (source.length % 5) throw new Error("Invalid static byte encoding.");
  const bytes = [];
  for (let offset = 0; offset < source.length; offset += 5) {
    let value = 0;
    for (let index = 0; index < 5; index += 1) {
      const digit = STATIC_BYTE_ALPHABET.indexOf(source[offset + index]);
      if (digit < 0) throw new Error("Invalid static byte encoding.");
      value = value * 85 + digit;
    }
    if (value > 4_294_967_295) throw new Error("Invalid static byte encoding.");
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push(value >>> shift & 255);
  }
  return new Uint8Array(bytes);
}
