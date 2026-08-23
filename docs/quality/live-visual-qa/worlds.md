# Visual QA disposable worlds and browser route

Return to [the visual-QA index](README.md) for run order and the
canonical case ledger. This guide covers the fixed browser-local fixtures,
persistence checks, fault isolation, and deletion accessibility route.

## Fixed disposable worlds

At 1280 × 720, create these worlds in this order. Record the storage ID assigned
to each world in the manifest.

| Role | Name | Seed | Initial mode |
| --- | --- | ---: | --- |
| survival | QA Survival | 41001 | Survival |
| creative | QA Creative | 41002 | Creative |
| fault | QA Fault | 41003 | Survival |

For every world, create three distinct persistent markers and write their exact
descriptions in the manifest:

- an edit marker: a conspicuous block pattern at a recorded coordinate;
- an inventory marker: a unique carried item/count;
- a container marker: a unique chest item/count.

Do not reuse a marker between worlds. Saving and reloading must prove all nine
markers remain associated only with their owning world.

## World-browser route

Run these checks first at 1280 × 720, then repeat the viewport-dependent
interactions at 800 × 720 without browser zoom.

1. On **Select World**, verify the search field sits left of
   **Create New World**, every compact row shows only its world name and last-played time,
   and each right-aligned **Delete** button fits without horizontal clipping or
   offset text shadows.
2. Search separately for `Survival`, `Creative`, and `Fault`. Each query must
   produce the expected world only. Clear search, single-click a row to select
   it, press Enter on a focused row to play it, then return and double-click
   another row to play it.
3. Enter QA Survival. Verify Survival restrictions, then use the command
   console to switch to Creative and back to Survival. Enter QA Creative and
   verify its initial mode, then switch to Survival and back to Creative.
4. Build and store that world's three markers. Continue active play until the
   pause menu's **Last autosaved** time advances, then use **Save and Quit to
   Title**. It must finalize another verified save and return to **Select
   World**, not the multiplayer directory or an empty gameplay shell.
5. Reopen every world and compare its edit, carried inventory, and container
   contents with the manifest. No marker from either sibling may appear.
6. Reload the browser between saves and repeat the three-world check. This is
   the crash-safe/restart boundary, not merely an in-memory world switch.

### Corrupt only the fault world

Before fault injection, create the sanitized storage summary required by the
manifest. Obtain the three IDs from the selected valid registry envelope, then
address storage only through those exact IDs and the two fixed registry slot
names. Never infer an ID from its display name, use browser-storage enumeration
APIs, copy a storage prefix, or inspect foreign origin data. Capture this
report while all three worlds are healthy or recovered and all nine persistence
markers have been confirmed; then keep it immutable.

The summary must contain exactly QA Survival, QA Creative, and QA Fault. For
each ID, read only these four expected keys:

```text
lakecraft.singleplayer.world.<ID>.v1
lakecraft.singleplayer.world.<ID>.save.head
lakecraft.singleplayer.world.<ID>.save.a
lakecraft.singleplayer.world.<ID>.save.b
```

The registry input is limited to `lakecraft.singleplayer.worlds.a` and
`lakecraft.singleplayer.worlds.b`; do not read the legacy transaction keys or
any discovered key. For each expected registry/save key, record only the exact
key name, value character length and SHA-256, UI-reported health state, and
booleans stating whether the edit, inventory, and container markers were
observed.

Use the validator template's binding values and this exact per-world topology,
in survival/creative/fault order:

```json
{
  "role": "survival",
  "worldId": "<exact-id>",
  "registered": true,
  "uiHealth": "healthy",
  "markers": {
    "editPersisted": true,
    "inventoryPersisted": true,
    "containerPersisted": true
  },
  "keys": [
    { "name": "<exact .v1 key>", "present": false, "length": 0, "sha256": null },
    { "name": "<exact .save.head key>", "present": true, "length": 1, "sha256": "<sha256>" },
    { "name": "<exact .save.a key>", "present": true, "length": 1, "sha256": "<sha256>" },
    { "name": "<exact .save.b key>", "present": false, "length": 0, "sha256": null }
  ]
}
```

`uiHealth` may be `healthy` or `recovered`. A present key has a positive
length and lowercase SHA-256; an absent key has exactly zero length and a null
hash. At least one crash-safe save slot must be present for each world.

Never record or export a raw localStorage value, parsed save payload, inventory
contents, player data, corrupt string, or unrelated key. A hash and length are
enough to bind the storage state without leaking its contents.

Set only these two values to invalid JSON, substituting the recorded ID:

```text
lakecraft.singleplayer.world.<QA_FAULT_ID>.save.a
lakecraft.singleplayer.world.<QA_FAULT_ID>.save.b
```

Reload. QA Fault must remain isolated and be unable to damage or hide QA
Survival and QA Creative. Open both healthy worlds and prove their six
surviving markers still match. Never save the corrupt values themselves or
overwrite the earlier bound healthy storage summary. Delete QA Fault through
the typed-confirmation flow, then recreate it with the original seed and mode
before continuing.

### Capacity boundary

After QA Fault is healthy again, replace one target save-slot value with more
than 150,000 characters and reload. Do not export that injected value.
Double-click and Enter must not open the unsafe fault world; the other two
worlds must remain searchable and playable. Delete and recreate QA Fault, then
confirm storage returns to a healthy state. Do not fill the entire origin
quota, because that would invalidate the isolation check.

### Delete modal keyboard, phrase, and focus

With QA Fault selected:

1. Open its right-aligned **Delete** control. The dialog must name QA Fault and
   initial focus must be in the confirmation input. Tab and Shift+Tab must
   remain trapped inside the modal; Escape must cancel and restore focus to that
   row's Delete trigger.
2. Reopen it. Enter near-matches, capitalization changes, leading/trailing
   whitespace, and partial text; **Delete World** must remain disabled.
3. Type exactly `yes, I want to delete this world`. **Delete World** must
   become enabled. Submit it and confirm QA Fault disappears while the other
   two rows and saves remain healthy; focus must fall back to the **Select
   World** heading because the opener was removed.

Use a continuous recording for these keyboard/focus checks at each viewport.
