import assert from "node:assert/strict";
import {
  MOB_FULL_GAIT_SPEED_BLOCKS_PER_SECOND,
  MOB_GAIT_RADIANS_PER_BLOCK,
  MOB_VERTEX_STRIDE,
  advanceMobGaitPhase,
  createMobRenderer,
  mobGaitAmplitude,
  mobTravelYaw,
  mobVertexCountForKind,
} from "../client/game/mobRenderer.ts";
import type { MobKind, MobPoseSnapshot } from "../client/game/mobs.ts";

assert.ok(Math.abs(advanceMobGaitPhase(0, .25)-MOB_GAIT_RADIANS_PER_BLOCK*.25)<1e-12);
assert.equal(mobGaitAmplitude(0),0);
assert.equal(mobGaitAmplitude(MOB_FULL_GAIT_SPEED_BLOCKS_PER_SECOND*2),.46);
assert.ok(Math.abs(mobTravelYaw(1,0,0)+Math.PI/2)<1e-12);

class FakeWebGl {
  readonly ARRAY_BUFFER=0x8892; readonly DYNAMIC_DRAW=0x88e8;
  readonly buffer={kind:"mob-batch"}; allocationBytes=0; uploadCalls=0;
  uploaded:Float32Array|null=null; deleted=false;
  createBuffer(){return this.buffer;}
  bindBuffer(_target:number,buffer:unknown){assert.equal(buffer,this.buffer);}
  bufferData(_target:number,bytes:number,_usage:number){this.allocationBytes=bytes;}
  bufferSubData(_target:number,_offset:number,data:Float32Array){this.uploadCalls+=1;this.uploaded=data;}
  deleteBuffer(buffer:unknown){assert.equal(buffer,this.buffer);this.deleted=true;}
}

function pose(kind:MobKind,index=0):MobPoseSnapshot{return {
  id:`${kind}-${index}`,kind,x:index*.3,y:7,z:6+index*.2,yaw:0,
  previousX:index*.3-.12,previousY:7,previousZ:6+index*.2,previousYaw:0,
  behavior:"wander",health:10,maxHealth:10,hostileActive:false,sheared:false,
  fuseProgress:kind==="creeper"?.82:0,sunBurning:false,deathFall:0,
};}
const kinds:MobKind[]=["pig","cow","sheep","chicken","zombie","skeleton","creeper","spider"];
const gl=new FakeWebGl();
const renderer=createMobRenderer(gl as unknown as WebGLRenderingContext);
assert.equal(gl.allocationBytes,1_090_560,"one fixed 1.04 MiB retained batch covers 64 textured mobs, projectiles, and TNT");
assert.ok(gl.allocationBytes<1.1*1024*1024);
const stats=renderer.rebuild(kinds.map(pose),0,0,0,1,1,2);
assert.equal(stats.visibleMobCount,8);
assert.equal(stats.vertexCount,kinds.reduce((sum,kind)=>sum+mobVertexCountForKind(kind),0));
assert.equal(gl.uploadCalls,1);
const geometry=gl.uploaded!;
for(let offset=0;offset<stats.vertexCount*MOB_VERTEX_STRIDE;offset+=MOB_VERTEX_STRIDE){
  for(let field=0;field<MOB_VERTEX_STRIDE;field+=1)assert.ok(Number.isFinite(geometry[offset+field]));
  assert.ok(geometry[offset+3]>=0&&geometry[offset+3]<=1,"atlas U stays normalized");
  assert.ok(geometry[offset+4]>=0&&geometry[offset+4]<=1,"atlas V stays normalized");
  assert.ok(geometry[offset+5]>=0&&geometry[offset+5]<=1,"red tint stays normalized");
}
const expectedVertices:Record<MobKind,number>={pig:252,cow:324,sheep:288,chicken:288,zombie:252,skeleton:228,creeper:216,spider:396};
for(const kind of kinds)assert.equal(mobVertexCountForKind(kind),expectedVertices[kind],`${kind} uses its fixed exact-model budget`);

const skeleton=pose("skeleton",10);skeleton.x=skeleton.previousX=0;skeleton.y=skeleton.previousY=0;skeleton.z=skeleton.previousZ=6;
renderer.rebuild([skeleton],0,8,0,-1,1,2.5);
const skeletonGeometry=gl.uploaded!.slice(0,mobVertexCountForKind("skeleton")*MOB_VERTEX_STRIDE);
const bowStart=(mobVertexCountForKind("skeleton")-12)*MOB_VERTEX_STRIDE;
const bowVertex=(index:number)=>[
  skeletonGeometry[bowStart+index*MOB_VERTEX_STRIDE],
  skeletonGeometry[bowStart+index*MOB_VERTEX_STRIDE+1],
  skeletonGeometry[bowStart+index*MOB_VERTEX_STRIDE+2],
] as const;
// The first two triangles expose the four front-face corners as 0, 1, 2, 5.
const bowCorners=[bowVertex(0),bowVertex(1),bowVertex(2),bowVertex(5)] as const;
const distance=(a:readonly number[],b:readonly number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const bowU=distance(bowCorners[0],bowCorners[1]),bowV=distance(bowCorners[0],bowCorners[3]);
assert.ok(bowU>.7&&bowU<.85&&bowV>.7&&bowV<.85,"the installed 16x16 bow rides a substantial square item plane");
assert.ok(Math.max(bowU,bowV)/Math.min(bowU,bowV)<1.05,"the bow sprite cannot regress to the former 8:1 ribbon");
const edgeU=bowCorners[1].map((value,index)=>value-bowCorners[0][index]);
const edgeV=bowCorners[3].map((value,index)=>value-bowCorners[0][index]);
assert.ok(Math.abs(edgeU.reduce((sum,value,index)=>sum+value*edgeV[index],0))<1e-5,"square bow edges remain perpendicular in world space");
const grip=bowCorners[0].map((value,index)=>value+edgeU[index]*3/16+edgeV[index]*8/16);
assert.ok(distance(grip,[-.31,1.05,6.58])<.015,"the bow's opaque grip socket stays attached to the skeleton's forward right hand");
const camera=[0,1.2,8] as const;
const projected=bowCorners.map(([worldX,worldY,worldZ])=>[(worldX-camera[0])/(camera[2]-worldZ),(worldY-camera[1])/(camera[2]-worldZ)] as const);
const screenXs=projected.map(([screenX])=>screenX),screenYs=projected.map(([,screenY])=>screenY);
const projectedWidth=Math.max(...screenXs)-Math.min(...screenXs),projectedHeight=Math.max(...screenYs)-Math.min(...screenYs);
let projectedArea=0;
for(let index=0;index<4;index+=1){const next=(index+1)%4;projectedArea+=projected[index][0]*projected[next][1]-projected[next][0]*projected[index][1];}
projectedArea=Math.abs(projectedArea)*.5;
assert.ok(projectedWidth/projectedHeight>.9&&projectedWidth/projectedHeight<1.1,"a front gameplay camera sees the bow's balanced square carrier");
assert.ok(projectedArea/(projectedWidth*projectedHeight)>.45,"the projected bow plane keeps enough area to reveal its sprite instead of a ribbon silhouette");

const zombie=pose("zombie",20);zombie.previousX=zombie.x;zombie.behavior="idle";
renderer.rebuild([zombie],0,0,0,1,1,3);
const upright=gl.uploaded!.slice(0,mobVertexCountForKind("zombie")*MOB_VERTEX_STRIDE);
renderer.rebuild([{...zombie,health:0,deathFall:1}],0,0,0,1,1,3.1);
const fallen=gl.uploaded!.slice(0,upright.length);
const yRange=(data:Float32Array)=>{let low=Infinity,high=-Infinity;for(let i=1;i<data.length;i+=MOB_VERTEX_STRIDE){low=Math.min(low,data[i]);high=Math.max(high,data[i]);}return high-low;};
assert.ok(yRange(fallen)<yRange(upright),"death progress lays the exact textured model down");

const sheep=pose("sheep",30);sheep.previousX=sheep.x;sheep.behavior="idle";
renderer.rebuild([sheep],0,0,0,1,1,4);
const woolly=gl.uploaded!.slice(0,mobVertexCountForKind("sheep")*MOB_VERTEX_STRIDE);
renderer.rebuild([{...sheep,sheared:true}],0,0,0,1,1,4.1);
const sheared=gl.uploaded!.slice(0,woolly.length);
assert.notDeepEqual(sheared,woolly,"shearing degenerates the two wool-layer cuboids while retaining base skin");
assert.equal(sheared.length,woolly.length);

renderer.rebuild([sheep],0,0,0,1,1,5);
const calm=gl.uploaded!.slice(0,woolly.length);sheep.health-=1;
renderer.rebuild([sheep],0,0,0,1,1,5.1);
const hurt=gl.uploaded!.slice(0,woolly.length);
assert.equal(hurt[0],calm[0]);
assert.ok(hurt[5]>calm[5]&&hurt[6]<calm[6]&&hurt[7]<calm[7],"hurt flash tints texture toward red without moving it");

const stillCow=pose("cow",40);stillCow.previousX=stillCow.x;stillCow.behavior="wander";
renderer.rebuild([stillCow],0,0,0,1,1,6);
const still=gl.uploaded!.slice(0,mobVertexCountForKind("cow")*MOB_VERTEX_STRIDE);
renderer.rebuild([{...stillCow,id:"cow-idle",behavior:"idle"}],0,0,0,1,1,6.1);
assert.deepEqual(gl.uploaded!.slice(0,still.length),still,"a blocked wander label cannot animate in place");

const far=pose("pig",50);far.x=far.previousX=100;far.z=far.previousZ=100;
assert.equal(renderer.rebuild([far],0,0,0,1,1,7).visibleMobCount,0);
renderer.destroy();assert.equal(gl.deleted,true);
console.log("lakecraft exact textured mob renderer tests: ok");
