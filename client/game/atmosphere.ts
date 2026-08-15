import type { DayNightState } from "./dayNight.ts";

export type AtmosphereVec3 = readonly [number, number, number];

/** One fullscreen triangle keeps the entire sky treatment to a single draw call. */
export const ATMOSPHERE_SCREEN_TRIANGLE = new Float32Array([
  -1, -1,
  3, -1,
  -1, 3,
]);

export const ATMOSPHERE_VERTEX_SHADER = `attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,.9999,1.);}`;

/**
 * Dependency-free WebGL 1 sky: a Minecraft-like square sun and moon, sparse
 * fixed stars, a brighter horizon, and broad block clouds anchored in world
 * coordinates so looking around never makes the sky slide with the camera.
 */
export const ATMOSPHERE_FRAGMENT_SHADER = `precision mediump float;
uniform float A,Q,T,S,M,R;uniform vec3 E,F,X,Y,K,G,D,N;varying vec2 v;
float h(vec2 p){vec3 v=fract(vec3(p.xyx)*.1031);v+=dot(v,v.yzx+33.33);return fract((v.x+v.y)*v.z);}
float j(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float b(vec3 r,vec3 c,float s){vec3 d=abs(r-c);return step(max(d.x,max(d.y,d.z)),s);}
void main(){
vec3 r=normalize(F+X*v.x*A*Q+Y*v.y*Q);
vec3 z=K*vec3(.78,.9,1.08),c=mix(min(vec3(1.),G*vec3(1.12,1.09,1.05)),z,smoothstep(-.16,.58,r.y));
float g=smoothstep(.975,.998,dot(r,D))*S;c+=vec3(1.,.57,.2)*g*.26;float s=b(r,D,.043)*step(.01,S);c=mix(c,vec3(1.,.94,.54),s);
float m=b(r,N,.039)*step(.01,M);c=mix(c,vec3(.84,.88,.74),m);c=mix(c,z,m*b(r,normalize(N+vec3(.025,.014,0.)),.027)*.88);
float a=step(.9965,j(floor(r*250.)))*step(.025,r.y)*R*(1.-s);c=mix(c,vec3(.88,.91,1.),a*.86);
float i=abs(r.y);if(i>.035){float d=(96.-E.y)/r.y;if(d>0.){vec2 w=E.xz+r.xz*d+vec2(T*.38,0.);vec2 q=floor(w/4.),k=floor(q/4.);float o=step(.43,h(k))*step(.39,h(q+k*7.));o*=smoothstep(.035,.12,i);float l=(.48+S*.48+M*.08)*mix(1.,.72,step(0.,r.y));c=mix(c,vec3(l,l,l*.96),o*.76);}}
gl_FragColor=vec4(c,1.);}`;

/** Sun and moon follow one fixed east-west arc shared by every client. */
export function celestialDirection(angle: number): AtmosphereVec3 {
  const out = new Float32Array(3);
  writeCelestialDirection(angle, out);
  return [out[0], out[1], out[2]];
}

/** Allocation-free variant for the render loop. */
export function writeCelestialDirection(angle: number, out: Float32Array): Float32Array {
  const finiteAngle = Number.isFinite(angle) ? angle : 0;
  const x = Math.cos(finiteAngle);
  const y = Math.sin(finiteAngle);
  // Tilting the entire orbital plane preserves exact sun/moon opposition.
  const z = x * 0.24;
  const magnitude = Math.hypot(x, y, z) || 1;
  out[0] = x / magnitude;
  out[1] = y / magnitude;
  out[2] = z / magnitude;
  return out;
}

/** Sky uniforms are normalized and reusable without changing day/night state. */
export function atmosphereLightLevels(state: Readonly<DayNightState>): {
  sun: number;
  moon: number;
  stars: number;
} {
  const bound = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return {
    sun: bound(state.sunIntensity),
    moon: bound(state.moonIntensity),
    stars: bound(state.starIntensity),
  };
}
