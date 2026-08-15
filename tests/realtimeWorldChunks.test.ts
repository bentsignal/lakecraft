import {describe,expect,test} from "bun:test";
import {decodeRealtimeChunkEdits,encodeRealtimeChunkEdits,realtimeChunkCoordinate,realtimeChunkWindow} from "../shared/realtimeWorldChunks";

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
    expect(encoded.length).toBeLessThan(20);
  });

  test("rejects edits owned by another chunk and corrupt payloads",()=>{
    expect(()=>encodeRealtimeChunkEdits(0,0,[{x:8,y:1,z:0,block:1}])).toThrow();
    expect(decodeRealtimeChunkEdits(0,0,"not-base64" )).toBeNull();
  });
});
