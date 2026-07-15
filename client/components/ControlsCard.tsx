export type ControlsCardProps = { visible?: boolean; onDismiss?: () => void };

/**
 * Kept as a compatibility export for older callers. Controls belong in the
 * pause menu; the in-game HUD intentionally never renders tutorial chrome.
 */
export function ControlsCard(_props: ControlsCardProps) {
  return null;
}
