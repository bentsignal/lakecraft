import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createInitializedPlayerState,
  type InventoryAction,
  type InventoryActionMutationResult,
} from "../../../shared/inventoryActions.ts";
import { validatePlayerStateJson, type CanonicalPlayerState } from "../../../shared/chestTransfers.ts";
import { createItemStack, type ItemStack } from "../../../shared/game.ts";

type Envelope = Record<string, unknown> & { type: string };
const token = "transactional-qa-token";
const port = 32_000 + Math.floor(Math.random() * 1_000);
const dataDir = mkdtempSync(`${tmpdir()}/lakecraft-gameplay-qa-`);
const root = resolve(import.meta.dir, "../../..");
const server = Bun.spawn(["bun", "run", "apps/game-server/src/index.ts"], {
  cwd: root,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    SERVER_ID: "transactional-qa",
    AUTH_MODE: "local-demo",
    LOCAL_DEMO_TOKEN: token,
    DATA_DIR: dataDir,
    MAX_PLAYERS: "4",
    MAX_PERSISTED_BLOCKS: "100",
    TICK_HZ: "20",
    SNAPSHOT_HZ: "10",
  },
  stdout: "pipe",
  stderr: "pipe",
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`);
      if (response.ok && (await response.json() as { ok?: unknown }).ok === true) return;
    } catch {
      // The isolated process is still starting.
    }
    await sleep(50);
  }
  throw new Error("temporary game server did not become ready");
}

class Bot {
  readonly socket: WebSocket;
  readonly messages: Envelope[] = [];
  private cursor = 0;
  private inventory: CanonicalPlayerState = createInitializedPlayerState();
  private revision = "1";
  private editSequence = 0;
  private chunkRevision = 0;

  constructor(readonly userId: string, readonly name: string,initial?:CanonicalPlayerState) {
    if(initial)this.inventory=initial;
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.socket.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(String(event.data)) as Envelope);
    });
  }

  async join(): Promise<void> {
    await new Promise<void>((resolveOpen, reject) => {
      this.socket.addEventListener("open", () => resolveOpen(), { once:true });
      this.socket.addEventListener("error", () => reject(new Error(`${this.name} socket failed`)), { once:true });
    });
    this.send({
      v:1,type:"join",capabilities:["world-chunks-v2"],demo:{
        token,userId:this.userId,name:this.name,inventoryJson:JSON.stringify(this.inventory),
      },
    });
    await this.next("welcome");
    const message = await this.next("inventory_state");
    this.acceptInventory(message.inventory);
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  async next(type: string, predicate: (message: Envelope) => boolean = () => true): Promise<Envelope> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      for (let index = this.cursor; index < this.messages.length; index += 1) {
        const message = this.messages[index];
        if (message.type === type && predicate(message)) {
          this.cursor = index + 1;
          return message;
        }
      }
      await sleep(5);
    }
    throw new Error(`${this.name} timed out waiting for ${type}`);
  }

  async nextAny(types: readonly string[], predicate: (message: Envelope) => boolean): Promise<Envelope> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      for (let index = this.cursor; index < this.messages.length; index += 1) {
        const message = this.messages[index];
        if (types.includes(message.type) && predicate(message)) {
          this.cursor = index + 1;
          return message;
        }
      }
      await sleep(5);
    }
    throw new Error(`${this.name} timed out waiting for ${types.join("/")}`);
  }

  async inventoryAction(operationId: string, action: InventoryAction): Promise<InventoryActionMutationResult> {
    const requestJson = JSON.stringify({ operationId,expectedRevision:this.revision,...action });
    this.send({ v:1,type:"inventory_action",requestJson });
    const envelope = await this.next("inventory_result", (message) => message.operationId === operationId);
    const result = envelope.result as InventoryActionMutationResult;
    if (!result.ok) throw new Error(`${this.name} inventory ${action.kind} failed: ${result.reason}`);
    this.acceptInventory(result.inventory);
    return result;
  }

  async edit(
    operationId: string, x: number, y: number, z: number, block: number,
    expectedBlock: "air" | "dirt",
  ): Promise<{ patch:Envelope; drop?:Envelope }> {
    this.editSequence += 1;
    const requestJson = JSON.stringify(block === 0 ? {
      operationId,kind:"mine",x,y,z,expectedBlock,selectedHotbar:2,expectedHeldItem:"dirt",
      expectedInventoryRevision:this.revision,expectedChunkRevision:String(this.chunkRevision),
    } : {
      operationId,kind:"place",x,y,z,expectedBlock,placedBlock:"dirt",selectedHotbar:2,expectedHeldItem:"dirt",
      expectedInventoryRevision:this.revision,expectedChunkRevision:String(this.chunkRevision),
    });
    this.send({ v:1,type:"block_edit",operationId,seq:this.editSequence,x,y,z,block,requestJson });
    const inventory = await this.next("inventory_state");
    this.acceptInventory(inventory.inventory);
    let drop: Envelope | undefined;
    if (block === 0) {
      const snapshot = await this.next("drop_snapshot", (message) => Array.isArray(message.drops)
        && message.drops.some((candidate) => (candidate as Envelope).dropId === `drop:mine:${operationId}`));
      drop = (snapshot.drops as Envelope[]).find((candidate) => candidate.dropId === `drop:mine:${operationId}`);
    }
    const patch = await this.next("block_patch", (message) => message.operationId === operationId);
    this.chunkRevision = Number((patch.edit as Envelope).revision);
    return {patch,drop};
  }

  async drop(operationId: string, stack: ItemStack, position: {x:number;y:number;z:number}, sourceSlot?: number): Promise<Envelope> {
    this.send({v:1,type:"drop_item",operationId,...stack,...position,...(sourceSlot === undefined ? {} : {sourceSlot})});
    const inventory = await this.next("inventory_state");
    this.acceptInventory(inventory.inventory);
    return this.next("drop_result", (message) => message.operationId === operationId);
  }

  async pickup(operationId: string, dropId: string): Promise<Envelope> {
    this.send({v:1,type:"pickup_item",operationId,dropId});
    const inventory = await this.next("inventory_state");
    this.acceptInventory(inventory.inventory);
    return this.next("drop_result", (message) => message.operationId === operationId);
  }

  state(): CanonicalPlayerState { return this.inventory; }
  currentRevision(): string { return this.revision; }
  syncInventory(value:unknown):void { this.acceptInventory(value); }

  private acceptInventory(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("missing inventory envelope");
    const row = value as { inventoryJson?: unknown; revision?: unknown };
    if (typeof row.inventoryJson !== "string" || typeof row.revision !== "string") throw new Error("invalid inventory envelope");
    const parsed = validatePlayerStateJson(row.inventoryJson);
    if (!parsed.ok) throw new Error(`invalid server inventory: ${parsed.reason}`);
    this.inventory = parsed.state;
    this.revision = row.revision;
  }
}

function stackKey(stack: ItemStack): string {
  return `${stack.itemId}@${stack.durability ?? ""}`;
}

function ledger(players: readonly Bot[], drops: readonly Envelope[]): string {
  const counts = new Map<string, number>();
  for (const player of players) for (const stack of player.state().inventory) {
    if (stack) counts.set(stackKey(stack), (counts.get(stackKey(stack)) ?? 0) + stack.count);
  }
  for (const drop of drops) {
    const itemId = String(drop.itemId ?? "");
    const count = Number(drop.count ?? 0);
    const durability = drop.durability === undefined ? "" : String(drop.durability);
    counts.set(`${itemId}@${durability}`, (counts.get(`${itemId}@${durability}`) ?? 0) + count);
  }
  return JSON.stringify([...counts].sort(([left],[right]) => left.localeCompare(right)));
}

function log(step: string, detail: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ok:true,step,...detail })}\n`);
}

try {
  await waitForServer();
  const alex = new Bot("qa_alex", "QA Alex");
  const steveState=createInitializedPlayerState();
  steveState.selectedHotbar=0;steveState.inventory[0]=createItemStack("iron_sword");
  const steve = new Bot("qa_steve", "QA Steve",steveState);
  await Promise.all([alex.join(),steve.join()]);
  const startingLedger = ledger([alex,steve],[]);
  log("joined",{ alexRevision:alex.currentRevision(),steveRevision:steve.currentRevision(),startingLedger });

  await alex.edit("qa_place_world_0001",0,69,1,2,"air");
  const mined = await alex.edit("qa_break_world_0001",0,69,1,0,"dirt");
  const minedDrop = mined.drop!;
  await sleep(1_050);
  const pickedMine = await steve.pickup("qa_pickup_mined_001",String(minedDrop.dropId));
  log("place-break-pickup",{ alexRevision:alex.currentRevision(),steveRevision:steve.currentRevision(),dropId:(pickedMine.drop as Envelope).dropId });

  const tossed = await alex.drop("qa_toss_drop_00001",{itemId:"dirt",count:1},{x:0.5,y:69.45,z:-0.7},2);
  const tossedDrop = tossed.drop as Envelope;
  await sleep(1_050);
  await steve.pickup("qa_pickup_toss_001",String(tossedDrop.dropId));
  const afterTransfers = ledger([alex,steve],[]);
  if (afterTransfers !== startingLedger) throw new Error(`item conservation failed after transfers: ${afterTransfers}`);
  log("q-drop-transfer",{ conserved:true,ledger:afterTransfers });

  steve.send({ v:1,type:"input",seq:1,dtMs:50,moveX:0,moveZ:0,yaw:Math.PI,pitch:0,jump:false,sprint:false,heldItem:"iron_sword",x:0.5,y:69.02,z:-1.2 });
  await sleep(100);
  for (let hit = 1; hit <= 4; hit += 1) {
    const operationId = `qa_fatal_attack_000${hit}`;
    steve.send({ v:1,type:"player_attack",operationId,targetId:"qa_alex" });
    const weaponInventory=await steve.next("inventory_state");
    steve.syncInventory(weaponInventory.inventory);
    const result = await steve.nextAny(["player_hit","error"], (message) => message.operationId === operationId);
    if (result.type === "error") throw new Error(`PvP step rejected: ${String(result.code)} ${String(result.message)}`);
    if (hit === 4 && result.killed !== true) throw new Error("fourth deterministic sword hit did not kill target");
    if (hit < 4) await sleep(410);
  }
  const preDeathLedger=ledger([alex,steve],[]);
  await alex.inventoryAction("qa_death_settle_0001",{ kind:"death_settle",eventId:"qa_fatal_attack_0004" });
  const deathSnapshot = await alex.next("drop_snapshot",(message)=>Array.isArray(message.drops)
    && message.drops.some((drop)=>(drop as Envelope).ownerUserId === "qa_alex"));
  const deathDrops = (deathSnapshot.drops as Envelope[]).filter((drop)=>drop.ownerUserId === "qa_alex");
  if (deathDrops.length === 0) throw new Error("Railway did not publish the authoritative death pack");
  const settledLedger = ledger([alex,steve],deathDrops);
  if (settledLedger !== preDeathLedger) throw new Error(`death conservation failed: ${settledLedger}`);
  alex.send({ v:1,type:"pickup_item",operationId:"qa_dead_pickup_0001",dropId:deathDrops[0].dropId });
  const deadPickup = await alex.next("error", (message) => message.operationId === "qa_dead_pickup_0001");
  if (deadPickup.code !== "bad_message") throw new Error("dead player unexpectedly consumed a death drop");
  alex.send({ v:1,type:"respawn",operationId:"qa_respawn_operation" });
  await alex.next("respawned", (message) => message.operationId === "qa_respawn_operation");
  log("death-respawn",{ conserved:true,deathDropRows:deathDrops.length,deadPickupRejected:true,ledger:settledLedger });
  log("complete",{ scenarios:4,isolatedDataDir:true });
  alex.socket.close();
  steve.socket.close();
} finally {
  server.kill("SIGINT");
  const stoppedCleanly = await Promise.race([
    server.exited.then(() => true, () => true),
    sleep(2_000).then(() => false),
  ]);
  if (!stoppedCleanly) {
    // A closing WebSocket must never strand the aggregate test process. The
    // isolated server has already received its graceful SQLite flush signal;
    // force only this disposable child down if Bun keeps a handle alive.
    server.kill("SIGKILL");
    await server.exited.catch(() => undefined);
  }
  rmSync(dataDir,{ recursive:true,force:true });
}

// This file is an executable process-level harness, never an imported test
// helper. Bun's client WebSocket can retain an internal handle after both peers
// and the isolated server have closed, so exit explicitly only after the whole
// successful scenario and cleanup have completed. Thrown failures skip here
// and retain their non-zero exit status and stack.
process.exit(0);
