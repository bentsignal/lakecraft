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
