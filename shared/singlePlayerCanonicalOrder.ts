/** Locale-independent UTF-16 ordering used by every canonical single-player collection. */
export function compareSinglePlayerCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
