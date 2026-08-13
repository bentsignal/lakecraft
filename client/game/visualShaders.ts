export const SKIN_VERTEX_SHADER = `
attribute vec3 aPosition;attribute vec2 aUv;attribute float aShade;
uniform mat4 uMvp;varying vec2 vUv;varying float vShade;
void main(){gl_Position=uMvp*vec4(aPosition,1.0);vUv=aUv;vShade=aShade;}
`;
export const SKIN_FRAGMENT_SHADER = `
precision mediump float;uniform sampler2D uSkin;uniform vec3 uLight;
varying vec2 vUv;varying float vShade;
void main(){vec4 c=texture2D(uSkin,vUv);if(c.a<0.02)discard;float s=abs(vShade);vec3 rgb=c.rgb;if(vShade<0.0)rgb=mix(rgb,vec3(1.0,0.08,0.08),0.58);gl_FragColor=vec4(rgb*uLight*s,c.a);}
`;
export const COLOR_VERTEX_SHADER = `
attribute vec3 aPosition;attribute vec3 aColor;uniform mat4 uMvp;uniform vec3 uLight;varying vec3 vColor;
void main(){gl_Position=uMvp*vec4(aPosition,1.0);vColor=aColor*uLight;}
`;
export const COLOR_FRAGMENT_SHADER = `precision mediump float;varying vec3 vColor;void main(){gl_FragColor=vec4(vColor,1.0);}`;
export const MOB_VERTEX_SHADER = `attribute vec3 aPosition;attribute vec2 aUv;attribute vec3 aTint;uniform mat4 uMvp;uniform vec3 uLight;varying vec2 vUv;varying vec3 vLight;void main(){gl_Position=uMvp*vec4(aPosition,1.);vUv=aUv;vLight=aTint*uLight;}`;
export const MOB_FRAGMENT_SHADER = `precision mediump float;uniform sampler2D uAtlas;varying vec2 vUv;varying vec3 vLight;void main(){vec4 t=texture2D(uAtlas,vUv);if(t.a<.02)discard;gl_FragColor=vec4(t.rgb*vLight,t.a);}`;

export function createVisualProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to allocate a visual shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Visual shader compilation failed.";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  };
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to allocate a visual program.");
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Visual program link failed.";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}
