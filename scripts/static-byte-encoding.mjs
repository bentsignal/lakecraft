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
