export function localWorldDeleteState(issues: readonly string[]): readonly [string, boolean] {
  const has = (issue: string) => issues.includes(`delete:${issue}`);
  if (has("recovery_pending")) {
    return ["!Deletion committed; cleanup pending.", true];
  }
  if (has("invalid_transaction_pending")) {
    return ["!Invalid deletion marker; worlds unchanged.", true];
  }
  if (has("transaction_read_failed")) return ["", true];
  if (has("invalid_transaction_cleared")) {
    return ["!Invalid deletion ignored. Worlds remain available; orphaned data may remain.", false];
  }
  if (has("rollback_completed") || has("cleanup_completed")) {
    return ["Deletion recovered; other worlds unchanged.", false];
  }
  return ["", false];
}

interface DialogLike {
  open: boolean;
  close(): void;
  showModal(): void;
}

interface FocusLike {
  isConnected: boolean;
  disabled?: boolean;
  focus(): void;
}

export function localWorldDialogRef(
  restoreRef: { current: FocusLike | null },
  fallback: () => FocusLike | null,
): (dialog: DialogLike | null) => void {
  let opened: DialogLike | null;
  return (dialog) => {
    if (dialog) {
      opened = dialog;
      dialog.showModal();
      return;
    }
    const restore = restoreRef.current;
    const closing = opened;
    restoreRef.current = opened = null;
    if (closing?.open) closing.close();
    (restore?.isConnected && !restore.disabled ? restore : fallback())?.focus();
  };
}
