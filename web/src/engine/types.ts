import type { Gpu, Target } from './gl.ts';

/** A slider in the effects panel. Shaders read it as `uniform float u_<key>`. */
export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  default: number;
  /** False for rates a shader multiplies by u_time (spin, speed): an audio link would make them jump. */
  linkable?: boolean;
}

export interface FrameContext {
  /** Seconds since the engine started. */
  time: number;
  resolution: readonly [number, number];
}

export interface EffectRuntime {
  render(input: Target, params: Record<string, number>, ctx: FrameContext): Target;
  dispose(): void;
}

interface EffectBase {
  id: string;
  name: string;
  params: ParamDef[];
}

/**
 * Stateless effect. `glsl` must define `vec4 effect(vec2 uv)` and may read
 * `u_input` (sampler2D), `u_time`, `u_resolution` and one `u_<key>` float per param.
 */
export interface ShaderEffectDef extends EffectBase {
  kind: 'shader';
  glsl: string;
}

/** Stateful effect (e.g. frame delay): owns GPU resources for one effect instance. */
export interface CustomEffectDef extends EffectBase {
  kind: 'custom';
  create(gpu: Gpu): EffectRuntime;
}

export type EffectDef = ShaderEffectDef | CustomEffectDef;

/**
 * `glsl` must define `vec4 transition(vec2 uv)` and may read
 * `u_from`, `u_to` (sampler2D), `u_progress` (0→1), `u_time`, `u_resolution`.
 */
export interface TransitionDef {
  id: string;
  name: string;
  glsl: string;
}
