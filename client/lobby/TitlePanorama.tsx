import { useEffect, useRef } from "preact/hooks";
import { textureAtlasUv, type TextureUvBounds } from "../game/blockTextures.ts";
import {
  TEXTURE_ATLAS_COLUMNS,
  TEXTURE_ATLAS_RGBA,
  TEXTURE_ATLAS_ROWS,
  TEXTURE_TILE_SIZE,
  type TextureAtlasName,
} from "../game/generated/textureAtlas.ts";

const VERTEX_SHADER = `attribute vec3 p;attribute vec2 u;attribute float l;uniform float a,r;varying vec2 v;varying float s;void main(){float c=cos(r),d=sin(r);vec3 q=p-vec3(9.,2.5,9.);vec3 w=vec3(c*q.x-d*q.z,q.y-1.2,d*q.x+c*q.z+18.);gl_Position=vec4(w.x*1.32/a,w.y*1.32,w.z-.16,w.z);v=u;s=l;}`;
const FRAGMENT_SHADER = `precision mediump float;uniform sampler2D t;varying vec2 v;varying float s;void main(){vec4 c=texture2D(t,v);if(c.a<.08)discard;gl_FragColor=vec4(c.rgb*s,c.a);}`;
type Point = readonly [number, number, number];

function shader(gl: WebGLRenderingContext, kind: number, source: string) {
  const value = gl.createShader(kind);
  if (!value) throw new Error("Panorama shader unavailable.");
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value) || "Panorama shader failed.");
  return value;
}

function quad(out: number[], points: readonly [Point, Point, Point, Point], uv: TextureUvBounds, shade: number) {
  const tex = [[uv.left, uv.bottom], [uv.right, uv.bottom], [uv.right, uv.top], [uv.left, uv.top]] as const;
  for (const index of [0, 1, 2, 0, 2, 3]) out.push(...points[index], ...tex[index], shade);
}

function cube(out: number[], x: number, y: number, z: number, side: TextureAtlasName, top = side, bottom = side) {
  const a = textureAtlasUv(side), b = textureAtlasUv(top), c = textureAtlasUv(bottom);
  quad(out, [[x,y+1,z],[x+1,y+1,z],[x+1,y+1,z+1],[x,y+1,z+1]],b,1);
  quad(out, [[x+1,y,z],[x,y,z],[x,y,z+1],[x+1,y,z+1]],c,.56);
  quad(out, [[x,y,z+1],[x+1,y,z+1],[x+1,y+1,z+1],[x,y+1,z+1]],a,.76);
  quad(out, [[x+1,y,z],[x,y,z],[x,y+1,z],[x+1,y+1,z]],a,.62);
  quad(out, [[x,y,z],[x,y,z+1],[x,y+1,z+1],[x,y+1,z]],a,.68);
  quad(out, [[x+1,y,z+1],[x+1,y,z],[x+1,y+1,z],[x+1,y+1,z+1]],a,.86);
}

/** Compact title renderer: real WebGL voxels and the exact block atlas used by gameplay. */
export function createTitlePanoramaRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: true, powerPreference: "low-power" });
  if (!gl) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const vertices: number[] = [];
  const heights: number[][] = [];
  for (let x = 0; x < 18; x += 1) {
    heights[x] = [];
    for (let z = 0; z < 18; z += 1) {
      const height = Math.max(0, Math.min(3, Math.floor(1.7 + Math.sin(x * .55) * .6 + Math.cos(z * .47) * .55)));
      heights[x][z] = height;
      for (let y = -1; y <= height; y += 1) cube(vertices, x, y, z, y === height ? "grass_side" : "dirt", y === height ? "grass_top" : "dirt");
    }
  }
  for (const [x, z] of [[3,4],[13,5],[5,13],[14,14]] as const) {
    const ground = heights[x][z] + 1;
    for (let y = 0; y < 3; y += 1) cube(vertices, x, ground + y, z, "oak_log", "oak_log_end");
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) cube(vertices, x + dx, ground + 3, z + dz, "leaves");
    cube(vertices, x, ground + 4, z, "leaves");
  }
  const buffer = gl.createBuffer(), texture = gl.createTexture();
  if (!buffer || !texture) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEXTURE_TILE_SIZE * TEXTURE_ATLAS_COLUMNS, TEXTURE_TILE_SIZE * TEXTURE_ATLAS_ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, TEXTURE_ATLAS_RGBA);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.useProgram(program);
  const stride = 24;
  const position = gl.getAttribLocation(program, "p"), uv = gl.getAttribLocation(program, "u"), light = gl.getAttribLocation(program, "l");
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(light); gl.vertexAttribPointer(light, 1, gl.FLOAT, false, stride, 20);
  const aspectUniform = gl.getUniformLocation(program, "a"), rotationUniform = gl.getUniformLocation(program, "r");
  gl.uniform1i(gl.getUniformLocation(program, "t"), 0);
  gl.enable(gl.DEPTH_TEST);

  const render = (rotation: number) => {
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio)), height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(aspectUniform, width / height);
    gl.uniform1f(rotationUniform, rotation);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
  };
  const destroy = () => { gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteProgram(program); };
  return { render, destroy, vertexCount: vertices.length / 6 };
}

export function TitlePanorama() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const renderer = createTitlePanoramaRenderer(canvas);
    if (!renderer) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0, start = performance.now(), lastDraw = start - 34;
    const draw = (now: number) => {
      if (reduced || now - lastDraw >= 33) {
        renderer.render(reduced ? .72 : .55 + (now - start) * .000025);
        lastDraw = now;
      }
      if (!reduced && !document.hidden) frame = requestAnimationFrame(draw);
    };
    draw(start);
    const visibility = () => { if (!document.hidden && !reduced) { cancelAnimationFrame(frame); start = performance.now(); frame = requestAnimationFrame(draw); } };
    document.addEventListener("visibilitychange", visibility);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", visibility); renderer.destroy(); };
  }, []);
  return <canvas aria-hidden="true" className="lc-title-panorama" ref={ref} />;
}
