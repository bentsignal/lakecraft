import type { ServerGameMode } from "./protocol";

export type { ServerGameMode } from "./protocol";

export interface AdminPlayerSummary {
  id: string;
  name: string;
  gameMode: ServerGameMode;
  connected: boolean;
}

export interface AdminWorldControl {
  adminPlayers(): AdminPlayerSummary[];
  setPlayerGameMode(userId: string, gameMode: ServerGameMode): boolean;
  kickPlayer(userId: string): boolean;
}

export interface AdminServerInfo {
  name: string;
  description: string;
  capacity: number;
}

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

/** Handles the server-local admin surface. Returns null for non-admin paths. */
export async function handleAdminRequest(
  request: Request,
  url: URL,
  adminToken: string | undefined,
  info: AdminServerInfo,
  world: AdminWorldControl,
): Promise<Response | null> {
  if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return null;
  if (!adminToken) return new Response("Not found", { status: 404 });

  if (request.method === "GET" && url.pathname === "/admin") {
    return new Response(ADMIN_HTML, {
      headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8" },
    });
  }

  if (!authorized(request, adminToken)) {
    return Response.json({ ok: false, error: "unauthorized" }, {
      status: 401,
      headers: { ...SECURITY_HEADERS, "www-authenticate": "Bearer" },
    });
  }

  if (request.method === "GET" && url.pathname === "/admin/api/state") {
    return Response.json({
      ok: true,
      server: info,
      players: world.adminPlayers(),
    }, { headers: SECURITY_HEADERS });
  }

  if (request.method === "POST" && url.pathname === "/admin/api/player-mode") {
    const body = await smallJson(request);
    const userId = text(body?.userId, 128);
    const gameMode = body?.gameMode;
    if (!userId || (gameMode !== "survival" && gameMode !== "creative")) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers: SECURITY_HEADERS });
    }
    const found = world.setPlayerGameMode(userId, gameMode);
    return Response.json({ ok: found, error: found ? undefined : "player_not_found" }, {
      status: found ? 200 : 404,
      headers: SECURITY_HEADERS,
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/api/kick") {
    const body = await smallJson(request);
    const userId = text(body?.userId, 128);
    if (!userId) {
      return Response.json({ ok: false, error: "invalid_request" }, { status: 400, headers: SECURITY_HEADERS });
    }
    const found = world.kickPlayer(userId);
    return Response.json({ ok: found, error: found ? undefined : "player_not_connected" }, {
      status: found ? 200 : 404,
      headers: SECURITY_HEADERS,
    });
  }

  return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
}

function authorized(request: Request, expected: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const length = Math.max(supplied.length, expected.length);
  let difference = supplied.length ^ expected.length;
  for (let index = 0; index < length; index++) {
    difference |= (supplied.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function smallJson(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 2_048) return null;
  try {
    const source = await request.text();
    if (source.length > 2_048) return null;
    const value: unknown = JSON.parse(source);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : "";
}

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lakecraft Server Console</title><style>
:root{color-scheme:dark;font-family:"Courier New",monospace;background:#101713;color:#eef5e8}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(#18251cdd,#101713ee),repeating-linear-gradient(0deg,#18271d 0 2px,#142018 2px 4px)}main{width:min(920px,calc(100% - 28px));margin:36px auto}.mast{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:18px}h1{font-size:clamp(24px,5vw,42px);line-height:1;margin:0;text-transform:uppercase;letter-spacing:-2px;text-shadow:3px 3px #000}p{color:#aebaaa;margin:8px 0 0}.panel{background:#262b27;border:3px solid #080b09;box-shadow:inset 2px 2px #4a514b,inset -2px -2px #151815,0 8px 24px #0008;padding:16px;margin-top:14px}.login{display:flex;gap:10px;flex-wrap:wrap}input,button{font:700 14px/1 "Courier New",monospace;border:2px solid #090b09;min-height:42px}input{flex:1;min-width:240px;background:#0e120f;color:#fff;padding:10px;outline:none;box-shadow:inset 2px 2px #050705}input:focus{border-color:#d9f3c9}button{cursor:pointer;background:#707070;color:#fff;padding:10px 15px;text-shadow:2px 2px #303030;box-shadow:inset 2px 2px #aaa,inset -2px -2px #424242}button:hover,button:focus-visible{background:#5b8e3e;outline:2px solid #fff}.danger:hover{background:#9e3f35}.status{font-weight:700}.ok{color:#9bd46e}.bad{color:#ff8d7e}.server{display:flex;justify-content:space-between;gap:14px;align-items:center}.count{font-size:26px;font-weight:900}.players{display:grid;gap:8px;margin-top:14px}.player{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;background:#161b17;border:2px solid #0a0c0a;padding:10px}.name{font-weight:900;overflow:hidden;text-overflow:ellipsis}.id{display:block;color:#849084;font-size:11px;font-weight:400}.mode{min-width:112px}.empty{text-align:center;color:#8f998d;padding:28px}@media(max-width:620px){.mast,.server{align-items:start;flex-direction:column}.player{grid-template-columns:1fr 1fr}.name{grid-column:1/-1}}
</style></head><body><main><div class="mast"><div><h1>Lakecraft Console</h1><p>Private controls for this Railway world.</p></div><div id="connection" class="status">LOCKED</div></div>
<section class="panel login"><input id="token" type="password" autocomplete="current-password" placeholder="Admin token" aria-label="Admin token"><button id="unlock">UNLOCK</button><button id="forget">LOCK</button></section>
<section class="panel"><div class="server"><div><strong id="serverName">SERVER</strong><p id="description">Enter the private admin token.</p></div><div id="count" class="count">- / -</div></div><div id="players" class="players"><div class="empty">Console locked.</div></div></section>
</main><script>
const q=s=>document.querySelector(s),token=q('#token'),players=q('#players'),connection=q('#connection');let secret=sessionStorage.getItem('lakecraft_admin_token')||'';token.value=secret;
const headers=()=>({'authorization':'Bearer '+secret,'content-type':'application/json'});function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
async function request(path,options={}){const response=await fetch(path,{...options,headers:headers()});if(response.status===401)throw Error('unauthorized');if(!response.ok)throw Error('request_failed');return response.json()}
function render(data){q('#serverName').textContent=data.server.name;q('#description').textContent=data.server.description;q('#count').textContent=data.players.filter(p=>p.connected).length+' / '+data.server.capacity;players.replaceChildren();if(!data.players.length){players.append(node('div','No players have joined this world yet.','empty'));return}for(const p of data.players){const row=node('div',undefined,'player'),identity=node('div',undefined,'name');identity.append(node('span',p.name),node('small',p.id,'id'));const mode=node('button',p.gameMode==='creative'?'CREATIVE':'SURVIVAL','mode');mode.onclick=()=>act('/admin/api/player-mode',{userId:p.id,gameMode:p.gameMode==='creative'?'survival':'creative'});const kick=node('button','KICK','danger');kick.disabled=!p.connected;kick.onclick=()=>act('/admin/api/kick',{userId:p.id});row.append(identity,mode,kick);players.append(row)}}
async function refresh(){if(!secret)return locked();try{const data=await request('/admin/api/state');connection.textContent='ONLINE';connection.className='status ok';render(data)}catch(error){connection.textContent=error.message==='unauthorized'?'INVALID TOKEN':'OFFLINE';connection.className='status bad'}}
async function act(path,body){try{await request(path,{method:'POST',body:JSON.stringify(body)});await refresh()}catch{connection.textContent='COMMAND FAILED';connection.className='status bad'}}
function locked(){connection.textContent='LOCKED';connection.className='status';players.replaceChildren(node('div','Console locked.','empty'))}q('#unlock').onclick=()=>{secret=token.value.trim();sessionStorage.setItem('lakecraft_admin_token',secret);refresh()};q('#forget').onclick=()=>{secret='';token.value='';sessionStorage.removeItem('lakecraft_admin_token');locked()};refresh();setInterval(()=>{if(secret)refresh()},3000);
</script></body></html>`;
