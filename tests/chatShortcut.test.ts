import assert from "node:assert/strict";
import { gameplayChatShortcutDraft } from "../client/gameplay/chatShortcut.ts";
import { localCommandShortcutDraft } from "../client/singleplayer/localCommands.ts";

for (const event of [{code:"Slash",key:"/"},{code:"Slash",key:"?"},{code:"",key:"/"}]) {
  assert.equal(gameplayChatShortcutDraft({...event,repeat:false}), "/");
  assert.equal(localCommandShortcutDraft({...event,repeat:false}), "/");
}
assert.equal(gameplayChatShortcutDraft({code:"KeyT",key:"t",repeat:false}), "");
assert.equal(gameplayChatShortcutDraft({code:"Enter",key:"Enter",repeat:false}), "");
assert.equal(gameplayChatShortcutDraft({code:"Slash",key:"/",repeat:true}), null);
assert.equal(gameplayChatShortcutDraft({code:"KeyW",key:"w",repeat:false}), null);
console.log("shared single-player and multiplayer chat shortcuts passed");
