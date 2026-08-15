import type { ServerAccessEntry, ServerAccessMode, ServerAdministrationSettings, ServerRole } from "./database";
import type { RealtimeChatMessage, ServerGameMode } from "./protocol";

export type { ServerGameMode } from "./protocol";

export interface AdminPlayerSummary {
  id: string;
  name: string;
  gameMode: ServerGameMode;
  connected: boolean;
  role: ServerRole | null;
  health: number;
  x: number;
  y: number;
  z: number;
}

export interface AdminState {
  players: AdminPlayerSummary[];
  settings: Omit<ServerAdministrationSettings,"passwordHash"> & {passwordConfigured:boolean};
  access: ServerAccessEntry[];
  chat: RealtimeChatMessage[];
  revision: number;
  persistedBlocks: number;
  maxPersistedBlocks: number;
}

export interface AdminWorldControl {
  adminState(): AdminState;
  setPlayerGameMode(userId: string, gameMode: ServerGameMode): boolean;
  kickPlayer(userId: string): boolean;
  runAdminCommand(command: string): Promise<{ ok: boolean; message: string }>;
}

export interface AdminServerInfo { name:string; description:string; capacity:number }

const SECURITY_HEADERS = {
  "cache-control":"no-store", "content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cross-origin-opener-policy":"same-origin", "referrer-policy":"no-referrer", "x-content-type-options":"nosniff", "x-frame-options":"DENY",
} as const;

export async function handleAdminRequest(request:Request,url:URL,adminToken:string|undefined,info:AdminServerInfo,world:AdminWorldControl):Promise<Response|null>{
  if(url.pathname!=="/admin"&&!url.pathname.startsWith("/admin/"))return null;
  if(!adminToken)return new Response("Not found",{status:404});
  if(request.method==="GET"&&url.pathname==="/admin")return new Response(ADMIN_HTML,{headers:{...SECURITY_HEADERS,"content-type":"text/html; charset=utf-8"}});
  if(!authorized(request,adminToken))return Response.json({ok:false,error:"unauthorized"},{status:401,headers:{...SECURITY_HEADERS,"www-authenticate":"Bearer"}});
  if(request.method==="GET"&&url.pathname==="/admin/api/state")return Response.json({ok:true,server:info,...world.adminState()},{headers:SECURITY_HEADERS});
  if(request.method==="POST"&&url.pathname==="/admin/api/player-mode"){
    const body=await smallJson(request),userId=text(body?.userId,128),gameMode=body?.gameMode;
    if(!userId||(gameMode!=="survival"&&gameMode!=="creative"))return jsonError("invalid_request",400);
    const found=world.setPlayerGameMode(userId,gameMode);return Response.json({ok:found,error:found?undefined:"player_not_found"},{status:found?200:404,headers:SECURITY_HEADERS});
  }
  if(request.method==="POST"&&url.pathname==="/admin/api/kick"){
    const body=await smallJson(request),userId=text(body?.userId,128);if(!userId)return jsonError("invalid_request",400);
    const found=world.kickPlayer(userId);return Response.json({ok:found,error:found?undefined:"player_not_connected"},{status:found?200:404,headers:SECURITY_HEADERS});
  }
  if(request.method==="POST"&&url.pathname==="/admin/api/command"){
    const body=await smallJson(request),command=text(body?.command,512);if(!command)return jsonError("invalid_command",400);
    const result=await world.runAdminCommand(command);return Response.json(result,{status:result.ok?200:400,headers:SECURITY_HEADERS});
  }
  return new Response("Not found",{status:404,headers:SECURITY_HEADERS});
}

function jsonError(error:string,status:number){return Response.json({ok:false,error},{status,headers:SECURITY_HEADERS})}
function authorized(request:Request,expected:string){const h=request.headers.get("authorization")??"",s=h.startsWith("Bearer ")?h.slice(7):"",n=Math.max(s.length,expected.length);let d=s.length^expected.length;for(let i=0;i<n;i++)d|=(s.charCodeAt(i)||0)^(expected.charCodeAt(i)||0);return d===0}
async function smallJson(request:Request):Promise<Record<string,unknown>|null>{const declared=Number(request.headers.get("content-length")??"0");if(Number.isFinite(declared)&&declared>4096)return null;try{const source=await request.text();if(source.length>4096)return null;const value:unknown=JSON.parse(source);return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null}catch{return null}}
function text(value:unknown,max:number){return typeof value==="string"&&value.trim().length>0&&value.length<=max?value.trim():""}

const ADMIN_HTML=String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lakecraft Command Deck</title><style>
:root{color-scheme:dark;--ink:#e7eedb;--muted:#8f9b87;--coal:#0c100d;--panel:#1b211c;--edge:#060806;--moss:#77a84d;--amber:#e3ac49;--red:#bc5145;font-family:"Courier New",monospace;background:var(--coal);color:var(--ink)}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 76% -20%,#395031 0,transparent 42%),repeating-linear-gradient(0deg,#101611 0 2px,#0c100d 2px 4px)}button,input,select{font:700 13px/1.1 inherit}.shell{width:min(1240px,calc(100% - 24px));margin:20px auto 60px}.top{display:flex;justify-content:space-between;gap:20px;align-items:end;border-bottom:4px solid #313a31;padding:0 2px 14px}.eyebrow{color:var(--amber);font-size:11px;letter-spacing:2px;font-weight:900}.top h1{font-size:clamp(28px,5vw,48px);line-height:.9;margin:7px 0 0;letter-spacing:-3px;text-transform:uppercase;text-shadow:3px 3px #000}.signal{display:flex;align-items:center;gap:9px;font-weight:900}.lamp{width:12px;height:12px;background:#626962;border:2px solid #020302;box-shadow:0 0 0 2px #293029}.online .lamp{background:#93d35e;box-shadow:0 0 13px #93d35e}.bad .lamp{background:#e86756}.lock{margin:18px 0;display:flex;gap:8px;flex-wrap:wrap}.lock input{flex:1;min-width:250px}.control{background:#101511;color:#fff;border:2px solid var(--edge);padding:11px;box-shadow:inset 2px 2px #293329}.btn{cursor:pointer;color:white;background:#646b64;border:2px solid #050705;padding:11px 14px;box-shadow:inset 2px 2px #9ca49c,inset -2px -2px #343a34;text-transform:uppercase}.btn:hover,.btn:focus-visible{background:#628b44;outline:2px solid #dcebd0}.btn.red:hover{background:#9b4238}.grid{display:grid;grid-template-columns:1.45fr .8fr;gap:14px}.panel{background:linear-gradient(145deg,#222923,#181d19);border:3px solid var(--edge);box-shadow:inset 2px 2px #3d473e,inset -2px -2px #0e110e,0 10px 30px #0007;padding:15px}.panel h2{font-size:13px;letter-spacing:2px;color:var(--amber);margin:0 0 14px;text-transform:uppercase}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.metric{background:#101511;border:2px solid #090b09;padding:12px}.metric b{display:block;font-size:23px}.metric small,.sub{color:var(--muted)}.settings{display:grid;grid-template-columns:1fr 1fr;gap:9px}.setting{background:#121713;padding:10px;border-left:3px solid #435343}.setting b{display:block;margin-top:4px}.commands{display:flex;gap:8px;margin-top:12px}.commands input{flex:1}.output{min-height:36px;color:#b8c5b0;padding-top:9px}.chat{height:280px;overflow:auto;background:#0c110d;border:2px solid #080a08;padding:10px}.line{padding:5px 0;border-bottom:1px solid #202820}.line b{color:#9ac96d}.players{display:grid;gap:7px;max-height:470px;overflow:auto}.player{display:grid;grid-template-columns:1fr auto auto;gap:7px;align-items:center;background:#111612;border:2px solid #090b09;padding:9px}.player strong{overflow:hidden;text-overflow:ellipsis}.tag{font-size:10px;padding:4px 6px;background:#3b483c;color:#dce7d5}.off{opacity:.58}.access{max-height:240px;overflow:auto}.entry{display:flex;justify-content:space-between;border-bottom:1px solid #333b33;padding:7px 2px}.quick{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.quick .btn{padding:8px 10px;font-size:11px}.empty{color:var(--muted);padding:22px;text-align:center}@media(max-width:850px){.grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr 1fr}.top{align-items:start;flex-direction:column}.settings{grid-template-columns:1fr}.player{grid-template-columns:1fr auto}.player .red{grid-column:2}}
</style></head><body><main class="shell"><header class="top"><div><div class="eyebrow">RAILWAY WORLD AUTHORITY</div><h1>Command Deck</h1></div><div id="signal" class="signal"><span class="lamp"></span><span id="signalText">LOCKED</span></div></header><section class="lock"><input id="token" class="control" type="password" autocomplete="current-password" placeholder="Admin token"><button id="unlock" class="btn">Unlock</button><button id="remember" class="btn">Remember device</button><button id="forget" class="btn red">Lock</button></section><div class="grid"><section class="panel"><h2 id="serverName">Server telemetry</h2><div class="metrics"><div class="metric"><b id="online">-</b><small>online</small></div><div class="metric"><b id="blocks">-</b><small>world edits</small></div><div class="metric"><b id="revision">-</b><small>revision</small></div><div class="metric"><b id="accessMode">-</b><small>access</small></div></div><h2 style="margin-top:18px">World controls</h2><div id="settings" class="settings"></div><div class="quick"><button class="btn" data-cmd="/time set day">Set day</button><button class="btn" data-cmd="/gamerule doDaylightCycle false">Freeze daylight</button><button class="btn" data-cmd="/gamerule doDaylightCycle true">Run daylight</button><button class="btn" data-cmd="/access whitelist">Whitelist only</button><button class="btn red" data-cmd="/access closed">Close server</button></div><h2 style="margin-top:18px">Server chat & console</h2><div id="chat" class="chat"><div class="empty">Console locked.</div></div><div class="commands"><input id="command" class="control" placeholder="/say Welcome, /whitelist add Shawn, /setworldspawn 0 0 0"><button id="run" class="btn">Run</button></div><div id="output" class="output"></div></section><aside><section class="panel"><h2>Players</h2><div id="players" class="players"><div class="empty">Console locked.</div></div></section><section class="panel" style="margin-top:14px"><h2>Access ledger</h2><div id="access" class="access"><div class="empty">No entries.</div></div></section></aside></div></main><script>
const q=s=>document.querySelector(s),token=q('#token'),players=q('#players'),chat=q('#chat'),access=q('#access'),signal=q('#signal'),out=q('#output');let secret=sessionStorage.getItem('lakecraft_admin_token')||localStorage.getItem('lakecraft_admin_token')||'';token.value=secret;const headers=()=>({'authorization':'Bearer '+secret,'content-type':'application/json'});function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}async function api(path,opt={}){const r=await fetch(path,{...opt,headers:headers()});const body=await r.json().catch(()=>({}));if(r.status===401)throw Error('unauthorized');if(!r.ok)throw Error(body.message||body.error||'command_failed');return body}function command(value){if(!value)return;out.textContent='TRANSMITTING…';return api('/admin/api/command',{method:'POST',body:JSON.stringify({command:value})}).then(r=>{out.textContent=r.message;q('#command').value='';return refresh()}).catch(e=>{out.textContent=e.message;signal.className='signal bad'})}
function render(d){q('#serverName').textContent=d.server.name;q('#online').textContent=d.players.filter(p=>p.connected).length+'/'+d.server.capacity;q('#blocks').textContent=d.persistedBlocks.toLocaleString();q('#revision').textContent=d.revision.toLocaleString();q('#accessMode').textContent=d.settings.accessMode.toUpperCase();q('#settings').replaceChildren(setting('Spawn',fmt(d.settings.spawnX)+', '+fmt(d.settings.spawnZ)),setting('Daylight cycle',d.settings.daylightCycle?'RUNNING':'FROZEN'),setting('Day phase',Math.round(d.settings.dayPhase*100)+'%'),setting('World capacity',d.persistedBlocks.toLocaleString()+' / '+d.maxPersistedBlocks.toLocaleString()));players.replaceChildren();if(!d.players.length)players.append(el('div','No player records yet.','empty'));for(const p of d.players){const row=el('div',undefined,'player'+(p.connected?'':' off')),id=el('strong',p.name);id.append(el('small',' · '+(p.role||p.gameMode)+' · '+Math.round(p.x)+','+Math.round(p.y)+','+Math.round(p.z),'sub'));const mode=el('button',p.gameMode==='creative'?'Creative':'Survival','btn');mode.onclick=()=>api('/admin/api/player-mode',{method:'POST',body:JSON.stringify({userId:p.id,gameMode:p.gameMode==='creative'?'survival':'creative'})}).then(refresh);const kick=el('button','Kick','btn red');kick.disabled=!p.connected;kick.onclick=()=>api('/admin/api/kick',{method:'POST',body:JSON.stringify({userId:p.id})}).then(refresh);row.append(id,mode,kick);players.append(row)}chat.replaceChildren();for(const m of d.chat){const line=el('div',undefined,'line');line.append(el('b',m.username+' '),document.createTextNode(m.message));chat.append(line)}chat.scrollTop=chat.scrollHeight;access.replaceChildren();if(!d.access.length)access.append(el('div','Whitelist, roles, and bans are empty.','empty'));for(const a of d.access){access.append(el('div',a.username+' · '+(a.banned?'BANNED':a.role||'WHITELISTED'),'entry'))}}
function setting(a,b){const n=el('div',undefined,'setting');n.append(el('span',a,'sub'),el('b',b));return n}function fmt(n){return Number(n).toFixed(1)}async function refresh(){if(!secret)return locked();try{const d=await api('/admin/api/state');signal.className='signal online';q('#signalText').textContent='ONLINE';render(d)}catch(e){signal.className='signal bad';q('#signalText').textContent=e.message==='unauthorized'?'INVALID TOKEN':'OFFLINE'}}function locked(){signal.className='signal';q('#signalText').textContent='LOCKED';players.replaceChildren(el('div','Console locked.','empty'))}q('#unlock').onclick=()=>{secret=token.value.trim();sessionStorage.setItem('lakecraft_admin_token',secret);refresh()};q('#remember').onclick=()=>{secret=token.value.trim();localStorage.setItem('lakecraft_admin_token',secret);sessionStorage.setItem('lakecraft_admin_token',secret);refresh()};q('#forget').onclick=()=>{secret='';token.value='';localStorage.removeItem('lakecraft_admin_token');sessionStorage.removeItem('lakecraft_admin_token');locked()};q('#run').onclick=()=>command(q('#command').value.trim());q('#command').onkeydown=e=>{if(e.key==='Enter')command(e.currentTarget.value.trim())};document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>command(b.dataset.cmd));refresh();setInterval(()=>{if(secret)refresh()},2500);
</script></body></html>`;
