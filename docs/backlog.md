# Project backlog

This is the bounded local source of open work recovered during the UAV
migration on 2026-08-21. It intentionally omits 328 completed/canceled records,
five stale implementation records already represented by merged work, and five
tasks superseded by the Railway architecture. Git and 99 existing pull requests
preserve that history.

GitHub currently has no issues. If the owner adopts GitHub Issues as the task
system, convert the confirmed items below and delete this file rather than
maintaining two copies.

## Needs confirmation or execution

- **Verify inventory-close pointer capture in real Chrome.** The held viewmodel
  path is implemented, but the imported task never obtained a conclusive
  click-free Escape retest in the owner's browser. Reproduce before changing
  code.
- **Run repeatable two-client Railway QA.** Exercise two distinct Lakebed
  identities through ticket redemption, movement/nameplates, chat, item
  sharing, PvP, disconnect/reconnect, and server restart. Do not reuse the old
  Lakebed transport/quota acceptance criteria.
- **Review Railway mob ecology authority.** Confirm restart persistence,
  deterministic targets and drops, locality transitions, duplicate-event
  safety, and Creative's default-disabled population.
- **Audit remaining visual-catalog gaps.** First identify concrete production
  surfaces still using fallback or improvised art; create narrow tasks only for
  verified gaps. Do not revive the old blanket migration task unchanged.

## Deferred product decision

- **Signed-in backup for browser-local worlds.** A prior prototype was closed
  without shipping. Revisit only with a fresh storage, quota, privacy, conflict,
  deletion, and recovery design. The native cloud-delete-dialog cleanup depends
  on this feature returning.
