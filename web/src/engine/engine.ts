import { Gpu, HEIGHT, WIDTH } from './gl.ts';
import type { Target } from './gl.ts';
import { effects, transitions } from './registry.ts';
import {
  BLACK,
  OPACITY_PARAM,
  SILENCE,
  SLATE,
  cloneScene,
  modulate,
  newScene,
  sourcesOf,
} from './scene.ts';
import type { EffectInstance, Scene, Signals } from './scene.ts';
import { BLEND, BLEND_MODES, NORMALIZE, effectSource, transitionSource } from './shaders.ts';
import type { EffectRuntime, FrameContext } from './types.ts';

/** A source with no new frame for this long is "lost"; on Program it triggers the fail-safe. */
export const LOST_AFTER_MS = 2000;
const RUNTIME_TTL_FRAMES = 90;
const MIN_FRAME_MS = 1000 / 61;

interface Source {
  id: string;
  video: HTMLVideoElement;
  raw: WebGLTexture;
  norm: Target;
  mirror: boolean;
  dirty: boolean;
  addedAt: number;
  lastFrameAt: number;
  decodedFrames: number;
}

interface ActiveTransition {
  from: Scene;
  to: Scene;
  transitionId: string;
  start: number;
  duration: number;
  /** Fail-safe transitions replace Program without moving it into Preview. */
  swapPreview: boolean;
}

export interface EngineOutput {
  preview: Target;
  program: Target;
}

export class Engine {
  readonly gpu: Gpu;
  preview: Scene = newScene(SLATE);
  program: Scene = newScene(SLATE);
  outputFx: EffectInstance[] = [];
  transitionId = 'crossfade';
  transitionSeconds = 0.8;
  /** Current audio signals; the director updates them before each tick. */
  signals: Signals = { ...SILENCE };
  /** Provides the scene to fall back to when a Program source is lost. */
  safeScene: () => Scene = () => newScene(SLATE);
  onChange: () => void = () => {};
  /** Called with the lost source ids when the fail-safe takes Program to the safe scene. */
  onFailSafe: (lost: string[]) => void = () => {};
  onError: (error: Error) => void = (error) => console.error(error);

  #sources = new Map<string, Source>();
  #rotations = new Map<string, number>();
  #slate: Target;
  #black: Target;
  #active: ActiveTransition | null = null;
  #runtimes = new Map<string, { runtime: EffectRuntime; lastFrame: number }>();
  #frame = 0;
  #startedAt = performance.now();
  #lastTick = -Infinity;
  #last: EngineOutput | null = null;
  #failedShaders = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    this.gpu = new Gpu(canvas);
    this.#black = this.gpu.createTarget();
    this.#slate = this.gpu.createTarget();
    this.#drawSlate();
  }

  // ---- sources -------------------------------------------------------------

  setSource(id: string, video: HTMLVideoElement, mirror: boolean): void {
    const existing = this.#sources.get(id);
    if (existing) {
      existing.video = video;
      existing.mirror = mirror;
      existing.dirty = true;
      this.#watchFrames(existing);
      return;
    }
    const source: Source = {
      id,
      video,
      raw: this.gpu.createTexture(),
      norm: this.gpu.createTarget(),
      mirror,
      dirty: false,
      addedAt: performance.now(),
      lastFrameAt: 0,
      decodedFrames: 0,
    };
    this.#sources.set(id, source);
    this.#watchFrames(source);
  }

  setMirror(id: string, mirror: boolean): void {
    const source = this.#sources.get(id);
    if (source && source.mirror !== mirror) {
      source.mirror = mirror;
      source.dirty = true;
    }
  }

  /** Quarter turns clockwise (0–3); kept even before the source has video. */
  setRotation(id: string, quarterTurns: number): void {
    this.#rotations.set(id, ((quarterTurns % 4) + 4) % 4);
    const source = this.#sources.get(id);
    if (source) source.dirty = true;
  }

  rotation(id: string): number {
    return this.#rotations.get(id) ?? 0;
  }

  removeSource(id: string): void {
    const source = this.#sources.get(id);
    if (!source) return;
    this.gpu.gl.deleteTexture(source.raw);
    this.gpu.deleteTarget(source.norm);
    this.#sources.delete(id);
  }

  /** Milliseconds since the source last produced a frame (0 for built-in sources). */
  staleness(id: string, now = performance.now()): number {
    if (id === SLATE || id === BLACK) return 0;
    const source = this.#sources.get(id);
    if (!source) return Infinity;
    return now - (source.lastFrameAt || source.addedAt);
  }

  isLost(id: string, now = performance.now()): boolean {
    return this.staleness(id, now) > LOST_AFTER_MS;
  }

  sourceTarget(id: string): Target {
    if (id === SLATE) return this.#slate;
    return this.#sources.get(id)?.norm ?? this.#black;
  }

  // ---- switching -----------------------------------------------------------

  get transitioning(): boolean {
    return this.#active !== null;
  }

  get transitionProgress(): number {
    const active = this.#active;
    if (!active) return 0;
    return Math.min(1, (performance.now() - active.start) / (active.duration * 1000));
  }

  /** Scenes currently visible on the output (both sides during a transition). */
  get onAir(): Scene[] {
    return this.#active ? [this.#active.from, this.#active.to] : [this.program];
  }

  cut(): void {
    if (this.#active) this.#finishTransition();
    [this.preview, this.program] = [this.program, this.preview];
    this.onChange();
  }

  auto(): void {
    if (this.#active) return;
    this.#startTransition(this.preview, true);
  }

  /** Puts a scene straight on Program, leaving Preview untouched. */
  take(scene: Scene): void {
    if (this.#active) this.#finishTransition();
    this.program = cloneScene(scene);
    this.onChange();
  }

  // ---- rendering -----------------------------------------------------------

  /** Renders one frame; returns null when called faster than ~60 fps. */
  tick(now = performance.now()): EngineOutput | null {
    if (now - this.#lastTick < MIN_FRAME_MS) return null;
    this.#lastTick = now;
    this.#frame++;
    const ctx: FrameContext = { time: (now - this.#startedAt) / 1000, resolution: [WIDTH, HEIGHT] };
    const gpu = this.gpu;
    gpu.resetPool();
    this.#updateSources(now);
    this.#failSafe(now);

    const rendered = new Map<Scene, Target>();
    const render = (scene: Scene) => {
      let target = rendered.get(scene);
      if (!target) rendered.set(scene, (target = this.#renderScene(scene, ctx)));
      return target;
    };

    const preview = this.#applyEffects(render(this.preview), this.outputFx, ctx, 'pv:');
    let program: Target;
    const active = this.#active;
    if (active) {
      const progress = Math.min(1, (now - active.start) / (active.duration * 1000));
      program = this.#runTransition(active, render(active.from), render(active.to), progress, ctx);
      if (progress >= 1) this.#finishTransition();
    } else {
      program = render(this.program);
    }
    program = this.#applyEffects(program, this.outputFx, ctx, 'pg:');
    this.#collectRuntimes();
    this.#last = { preview, program };
    return this.#last;
  }

  get lastOutput(): EngineOutput | null {
    return this.#last;
  }

  #renderScene(scene: Scene, ctx: FrameContext): Target {
    const gpu = this.gpu;
    let acc = this.#black;
    for (const layer of scene.layers) {
      const layerOut = this.#applyEffects(
        this.sourceTarget(layer.sourceId),
        layer.effects,
        ctx,
        '',
      );
      const out = gpu.alloc();
      gpu.draw(BLEND, out, {
        u_base: { tex: acc.tex },
        u_layer: { tex: layerOut.tex },
        u_opacity: modulate(layer.opacity, OPACITY_PARAM, layer.opacityMod, this.signals),
        u_mode: Math.max(0, BLEND_MODES.indexOf(layer.blend)),
      });
      acc = out;
    }
    return acc;
  }

  #applyEffects(
    input: Target,
    list: EffectInstance[],
    ctx: FrameContext,
    keyPrefix: string,
  ): Target {
    let current = input;
    for (const instance of list) {
      if (!instance.enabled) continue;
      const def = effects.get(instance.type);
      if (!def || this.#failedShaders.has(def.id)) continue;
      const params: Record<string, number> = {};
      for (const p of def.params) {
        params[p.key] = modulate(
          instance.params[p.key] ?? p.default,
          p,
          instance.mods?.[p.key],
          this.signals,
        );
      }
      try {
        if (def.kind === 'shader') {
          const out = this.gpu.alloc();
          const uniforms: Record<string, number | readonly number[] | { tex: WebGLTexture }> = {
            u_input: { tex: current.tex },
            u_time: ctx.time,
            u_resolution: ctx.resolution,
          };
          for (const [key, value] of Object.entries(params)) uniforms[`u_${key}`] = value;
          this.gpu.draw(effectSource(def), out, uniforms);
          current = out;
        } else {
          const key = keyPrefix + instance.uid;
          let entry = this.#runtimes.get(key);
          if (!entry)
            this.#runtimes.set(key, (entry = { runtime: def.create(this.gpu), lastFrame: 0 }));
          entry.lastFrame = this.#frame;
          current = entry.runtime.render(current, params, ctx);
        }
      } catch (error) {
        this.#failedShaders.add(def.id);
        this.onError(new Error(`Effect "${def.name}" failed and was disabled: ${String(error)}`));
      }
    }
    return current;
  }

  #runTransition(
    active: ActiveTransition,
    from: Target,
    to: Target,
    progress: number,
    ctx: FrameContext,
  ): Target {
    const def = transitions.get(active.transitionId);
    if (!def || this.#failedShaders.has(def.id)) return progress < 0.5 ? from : to;
    const out = this.gpu.alloc();
    try {
      this.gpu.draw(transitionSource(def), out, {
        u_from: { tex: from.tex },
        u_to: { tex: to.tex },
        u_progress: progress,
        u_time: ctx.time,
        u_resolution: ctx.resolution,
      });
    } catch (error) {
      this.#failedShaders.add(def.id);
      this.onError(new Error(`Transition "${def.name}" failed and was disabled: ${String(error)}`));
      return to;
    }
    return out;
  }

  #startTransition(to: Scene, swapPreview: boolean): void {
    this.#active = {
      from: this.program,
      to,
      transitionId: this.transitionId,
      start: performance.now(),
      duration: Math.max(0.05, this.transitionSeconds),
      swapPreview,
    };
    this.onChange();
  }

  #finishTransition(): void {
    const active = this.#active;
    if (!active) return;
    this.#active = null;
    if (active.swapPreview) this.preview = active.from;
    this.program = active.to;
    this.onChange();
  }

  /** Only when every camera in the shot is gone; a single dead layer just stays frozen. */
  #failSafe(now: number): void {
    if (this.#active) return;
    const cameras = sourcesOf(this.program).filter((id) => id !== SLATE && id !== BLACK);
    if (!cameras.length || !cameras.every((id) => this.isLost(id, now))) return;
    this.onFailSafe(cameras);
    let safe = cloneScene(this.safeScene());
    if (sourcesOf(safe).some((id) => this.isLost(id, now))) safe = newScene(SLATE);
    this.#startTransition(safe, false);
    this.#active!.transitionId = 'crossfade';
  }

  #updateSources(now: number): void {
    for (const source of this.#sources.values()) {
      const video = source.video;
      const decoded = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      if (decoded !== source.decodedFrames) {
        source.decodedFrames = decoded;
        source.dirty = true;
        source.lastFrameAt = now;
      }
      if (!source.dirty || video.readyState < 2 || !video.videoWidth) continue;
      source.dirty = false;
      this.gpu.upload(source.raw, video);
      this.gpu.draw(NORMALIZE, source.norm, {
        u_input: { tex: source.raw },
        u_srcAspect: video.videoWidth / video.videoHeight,
        u_mirror: source.mirror ? 1 : 0,
        u_rotation: this.rotation(source.id),
        u_resolution: [WIDTH, HEIGHT],
      });
    }
  }

  #watchFrames(source: Source): void {
    const video = source.video;
    if (!('requestVideoFrameCallback' in video)) return;
    const onFrame = () => {
      if (this.#sources.get(source.id) !== source || source.video !== video) return;
      source.dirty = true;
      source.lastFrameAt = performance.now();
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  #collectRuntimes(): void {
    for (const [key, entry] of this.#runtimes) {
      if (this.#frame - entry.lastFrame > RUNTIME_TTL_FRAMES) {
        entry.runtime.dispose();
        this.#runtimes.delete(key);
      }
    }
  }

  #drawSlate(): void {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, '#1e1b4b');
    gradient.addColorStop(1, '#4c0519');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 120px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('STAGECAM', WIDTH / 2, HEIGHT / 2 - 20);
    ctx.font = '500 36px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('the show goes on…', WIDTH / 2, HEIGHT / 2 + 80);
    const tex = this.gpu.createTexture();
    this.gpu.upload(tex, canvas);
    this.gpu.draw(NORMALIZE, this.#slate, {
      u_input: { tex },
      u_srcAspect: WIDTH / HEIGHT,
      u_mirror: 0,
      u_rotation: 0,
      u_resolution: [WIDTH, HEIGHT],
    });
    this.gpu.gl.deleteTexture(tex);
  }
}
