import {describe,expect,test} from "bun:test";
import {BLOCK_TYPES} from "../shared/protocol";
import {REALTIME_BLOCK_ID_MAX,REALTIME_LEGACY_BLOCK_ID_MAX,decodeRealtimeChunkEdits,encodeRealtimeChunkEdits,realtimeChunkCoordinate,realtimeChunkWindow} from "../shared/realtimeWorldChunks";

describe("realtime coordinate chunk stream",()=>{
  test("uses mathematical floor chunks across the origin",()=>{
    expect([-9,-8,-1,0,7,8].map(realtimeChunkCoordinate)).toEqual([-2,-1,-1,0,0,1]);
    const window=realtimeChunkWindow(-1,2,1);
    expect(window).toHaveLength(9);
    expect(window[0]).toEqual({x:-1,z:2});
  });

  test("round trips a compact, stable sparse chunk without editor metadata",()=>{
    const encoded=encodeRealtimeChunkEdits(-1,0,[
      {x:-1,y:320,z:7,block:33},{x:-8,y:-64,z:0,block:0},{x:-1,y:320,z:7,block:5},
    ]);
    expect(encoded).toBe(encodeRealtimeChunkEdits(-1,0,[
      {x:-8,y:-64,z:0,block:0},{x:-1,y:320,z:7,block:5},
    ]));
    expect(decodeRealtimeChunkEdits(-1,0,encoded)).toEqual([
      {x:-8,y:-64,z:0,block:0},{x:-1,y:320,z:7,block:5},
    ]);
    expect(encoded.startsWith("v2:")).toBe(true);
    expect(encoded.length).toBeLessThan(24);
  });

  test("widens block ids while retaining deployed three-byte snapshots",()=>{
    const widened=encodeRealtimeChunkEdits(0,0,[{x:7,y:320,z:7,block:REALTIME_BLOCK_ID_MAX}]);
    expect(decodeRealtimeChunkEdits(0,0,widened)).toEqual([{x:7,y:320,z:7,block:65_535}]);
    const coordinate=1|(2<<3)|((20+64)<<6),block=511,packed=coordinate+block*0x8000;
    const legacy=Buffer.from([packed,packed>>>8,packed>>>16]).toString("base64");
    expect(decodeRealtimeChunkEdits(0,0,legacy)).toEqual([{x:1,y:20,z:2,block:511}]);
    const negotiatedLegacy=encodeRealtimeChunkEdits(0,0,[
      {x:1,y:20,z:2,block:REALTIME_LEGACY_BLOCK_ID_MAX},
      {x:2,y:20,z:2,block:REALTIME_LEGACY_BLOCK_ID_MAX+1},
    ],1);
    expect(negotiatedLegacy.startsWith("v2:")).toBe(false);
    expect(REALTIME_LEGACY_BLOCK_ID_MAX).toBe(498);
    expect(decodeRealtimeChunkEdits(0,0,negotiatedLegacy)).toEqual([
      {x:1,y:20,z:2,block:REALTIME_LEGACY_BLOCK_ID_MAX},
    ]);
  });

  test("round trips every append-only catalog id through one v2 Railway chunk",()=>{
    const edits=BLOCK_TYPES.map((_,block)=>({
      x:block&7,z:(block>>>3)&7,y:-64+Math.floor(block/64),block,
    }));
    expect(decodeRealtimeChunkEdits(0,0,encodeRealtimeChunkEdits(0,0,edits))).toEqual(edits);
  });

  test("rejects edits owned by another chunk and corrupt payloads",()=>{
    expect(()=>encodeRealtimeChunkEdits(0,0,[{x:8,y:1,z:0,block:1}])).toThrow();
    expect(()=>encodeRealtimeChunkEdits(0,0,[{x:0,y:1,z:0,block:REALTIME_BLOCK_ID_MAX+1}])).toThrow();
    expect(decodeRealtimeChunkEdits(0,0,"not-base64" )).toBeNull();
    expect(decodeRealtimeChunkEdits(0,0,"v2:not-base64" )).toBeNull();
  });
});
