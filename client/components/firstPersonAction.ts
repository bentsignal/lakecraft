/** Returns true only for a newly observed action while first-person feedback is visible. */
export function shouldAnimateFirstPersonAction(
  previousToken: number,
  actionToken: number,
  hidden: boolean,
  paused = false,
): boolean {
  return actionToken !== previousToken && !hidden && !paused;
}
