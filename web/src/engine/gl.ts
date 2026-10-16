export const WIDTH = 1280;
export const HEIGHT = 720;

export interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

export type Uniform = number | readonly number[] | { tex: WebGLTexture };
export type Uniforms = Record<string, Uniform>;

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const COPY = `#version 300 es
precision highp float;
uniform sampler2D u_input;
in vec2 v_uv;
out vec4 outColor;
void main() { outColor = texture(u_input, v_uv); }`;

interface Program {
  program: WebGLProgram;
  locations: Map<string, WebGLUniformLocation | null>;
}

/** Thin WebGL2 wrapper: fullscreen passes between 16:9 render targets. UV origin is bottom-left. */
export class Gpu {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  #programs = new Map<string, Program>();
  #pool: Target[] = [];
  #poolIndex = 0;
  #vao: WebGLVertexArrayObject;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.#vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.#vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  createTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  createTarget(w = WIDTH, h = HEIGHT): Target {
    const gl = this.gl;
    const tex = this.createTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const target = { tex, fb, w, h };
    this.clear(target);
    return target;
  }

  deleteTarget(target: Target): void {
    this.gl.deleteTexture(target.tex);
    this.gl.deleteFramebuffer(target.fb);
  }

  /** Scratch target valid until the next `resetPool()` (called once per frame). */
  alloc(): Target {
    if (this.#poolIndex === this.#pool.length) this.#pool.push(this.createTarget());
    return this.#pool[this.#poolIndex++];
  }

  resetPool(): void {
    this.#poolIndex = 0;
  }

  /** Uploads an image source; Y is flipped so textures share the bottom-left UV origin. */
  upload(tex: WebGLTexture, source: TexImageSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  program(fragment: string): WebGLProgram {
    return this.#compile(fragment).program;
  }

  draw(
    fragment: string,
    target: Target | null,
    uniforms: Uniforms,
    viewport?: [number, number],
  ): void {
    const gl = this.gl;
    const { program, locations } = this.#compile(fragment);
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    const [w, h] =
      viewport ?? (target ? [target.w, target.h] : [this.canvas.width, this.canvas.height]);
    gl.viewport(0, 0, w, h);
    let unit = 0;
    for (const [name, value] of Object.entries(uniforms)) {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      const location = locations.get(name);
      if (!location) continue;
      if (typeof value === 'number') gl.uniform1f(location, value);
      else if ('tex' in value) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, value.tex);
        gl.uniform1i(location, unit++);
      } else if (value.length === 2) gl.uniform2f(location, value[0], value[1]);
      else if (value.length === 3) gl.uniform3f(location, value[0], value[1], value[2]);
      else if (value.length === 4) gl.uniform4f(location, value[0], value[1], value[2], value[3]);
    }
    gl.bindVertexArray(this.#vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  copy(source: Target, target: Target): void {
    this.draw(COPY, target, { u_input: { tex: source.tex } });
  }

  clear(target: Target): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Draws a target into the bottom-left `w`×`h` corner of the canvas, ready for `drawImage`. */
  present(source: Target, w: number, h: number): void {
    this.draw(COPY, null, { u_input: { tex: source.tex } }, [w, h]);
  }

  #compile(fragment: string): Program {
    const cached = this.#programs.get(fragment);
    if (cached) return cached;
    const gl = this.gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, this.#shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, this.#shader(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
    }
    const entry = { program, locations: new Map() };
    this.#programs.set(fragment, entry);
    return entry;
  }

  #shader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const numbered = source
        .split('\n')
        .map((line, i) => `${String(i + 1).padStart(3)} ${line}`)
        .join('\n');
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}\n${numbered}`);
    }
    return shader;
  }
}
