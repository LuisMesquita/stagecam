import { effectList, effects } from '../engine/registry.ts';
import { OPACITY_PARAM, SIGNALS, modulate, newEffect, newLayer } from '../engine/scene.ts';
import type {
  AudioMod,
  BlendMode,
  EffectInstance,
  Layer,
  Scene,
  SignalName,
  Signals,
} from '../engine/scene.ts';
import { BLEND_MODES } from '../engine/shaders.ts';
import type { ParamDef } from '../engine/types.ts';
import { h, select } from './dom.ts';

export interface PanelOptions {
  scene: Scene;
  outputFx: EffectInstance[];
  live: boolean;
  sources: { value: string; label: string }[];
  /** Current audio signals, read when live readouts refresh. */
  signals: () => Signals;
  /** Called after a structural edit (add/remove/reorder/audio link) so the panel can be rebuilt. */
  onStructure: () => void;
}

interface ModAccess {
  get(): AudioMod | undefined;
  set(mod: AudioMod | undefined): void;
}

interface Context {
  options: PanelOptions;
  refreshers: (() => void)[];
}

/**
 * Editor for the bus being edited. Sliders mutate the scene in place, so changes show on the next
 * frame. Returns a function that refreshes the live (audio-modulated) readouts.
 */
export function renderPanel(root: HTMLElement, options: PanelOptions): () => void {
  const { scene, outputFx, live, onStructure } = options;
  const ctx: Context = { options, refreshers: [] };
  root.replaceChildren(
    h(
      'h2',
      { className: live ? 'panel-title live' : 'panel-title' },
      live ? 'Editing PROGRAM (live)' : 'Editing PREVIEW',
    ),
    ...scene.layers.map((layer, index) => layerCard(scene, layer, index, ctx)),
    h('button', {
      className: 'ghost wide',
      textContent: '+ Add layer (superimpose)',
      onclick: () => {
        const second = options.sources.find((s) => s.value !== scene.layers[0]?.sourceId);
        const layer = newLayer(second?.value ?? scene.layers[0].sourceId, 'screen');
        layer.opacity = 0.6;
        scene.layers.push(layer);
        onStructure();
      },
    }),
    h(
      'section',
      { className: 'card output-fx' },
      h(
        'header',
        { className: 'card-head' },
        h('strong', {}, 'Output FX'),
        h('small', {}, 'on top of everything'),
      ),
      effectChain(outputFx, ctx),
    ),
  );
  return () => ctx.refreshers.forEach((refresh) => refresh());
}

function layerCard(scene: Scene, layer: Layer, index: number, ctx: Context): HTMLElement {
  const { onStructure, sources } = ctx.options;
  const base = index === 0;
  const head = h(
    'header',
    { className: 'card-head' },
    h('strong', {}, base ? 'Base layer' : `Layer ${index + 1}`),
    select(sources, layer.sourceId, (value) => {
      layer.sourceId = value;
      onStructure();
    }),
    h(
      'span',
      { className: 'tools' },
      iconButton('↑', 'Move down the stack', index === 0, () =>
        swap(scene.layers, index, index - 1, onStructure),
      ),
      iconButton('↓', 'Move up the stack', index === scene.layers.length - 1, () =>
        swap(scene.layers, index, index + 1, onStructure),
      ),
      iconButton('×', 'Remove layer', scene.layers.length === 1, () => {
        scene.layers.splice(index, 1);
        onStructure();
      }),
    ),
  );
  const blend = base
    ? null
    : h(
        'label',
        { className: 'row' },
        h('span', {}, 'Blend'),
        select(
          BLEND_MODES.map((mode) => ({ value: mode, label: mode })),
          layer.blend,
          (value: BlendMode) => (layer.blend = value),
        ),
      );
  const opacity = slider(
    OPACITY_PARAM,
    () => layer.opacity,
    (value) => (layer.opacity = value),
    { get: () => layer.opacityMod, set: (mod) => (layer.opacityMod = mod) },
    ctx,
  );
  return h('section', { className: 'card' }, head, blend, opacity, effectChain(layer.effects, ctx));
}

function effectChain(list: EffectInstance[], ctx: Context): HTMLElement {
  const { onStructure } = ctx.options;
  const container = h('div', { className: 'effects' });
  list.forEach((instance, index) => {
    const def = effects.get(instance.type);
    if (!def) return;
    const enabled = h('input', { type: 'checkbox', checked: instance.enabled, title: 'Enable' });
    enabled.onchange = () => (instance.enabled = enabled.checked);
    container.append(
      h(
        'div',
        { className: 'effect' },
        h(
          'div',
          { className: 'effect-head' },
          h('label', { className: 'effect-name' }, enabled, def.name),
          h(
            'span',
            { className: 'tools' },
            iconButton('↑', 'Earlier in the chain', index === 0, () =>
              swap(list, index, index - 1, onStructure),
            ),
            iconButton('↓', 'Later in the chain', index === list.length - 1, () =>
              swap(list, index, index + 1, onStructure),
            ),
            iconButton('×', 'Remove effect', false, () => {
              list.splice(index, 1);
              onStructure();
            }),
          ),
        ),
        ...def.params.map((param) =>
          slider(
            param,
            () => instance.params[param.key] ?? param.default,
            (value) => (instance.params[param.key] = value),
            {
              get: () => instance.mods?.[param.key],
              set: (mod) => {
                const mods = { ...instance.mods };
                if (mod) mods[param.key] = mod;
                else delete mods[param.key];
                instance.mods = Object.keys(mods).length ? mods : undefined;
              },
            },
            ctx,
          ),
        ),
      ),
    );
  });
  const add = select(
    [
      { value: '', label: '+ Add effect…' },
      ...effectList.map((def) => ({ value: def.id, label: def.name })),
    ],
    '',
    (id) => {
      const def = effects.get(id);
      if (!def) return;
      list.push(newEffect(def));
      onStructure();
    },
    'add-effect',
  );
  container.append(add);
  return container;
}

function slider(
  param: ParamDef,
  get: () => number,
  set: (value: number) => void,
  modAccess: ModAccess,
  ctx: Context,
): HTMLElement {
  const { onStructure, signals } = ctx.options;
  const input = h('input', {
    type: 'range',
    min: String(param.min),
    max: String(param.max),
    step: String(param.step ?? (param.max - param.min) / 100),
    value: String(get()),
    title: 'Double-click to reset',
  });
  const readout = h('output', {}, format(get()));
  const refresh = () => {
    readout.textContent = format(modulate(get(), param, modAccess.get(), signals()));
  };
  ctx.refreshers.push(refresh);
  input.oninput = () => {
    set(Number(input.value));
    refresh();
  };
  input.ondblclick = () => {
    input.value = String(param.default);
    input.dispatchEvent(new Event('input'));
  };
  const mod = modAccess.get();
  const link = h('button', {
    className: mod ? 'icon audio-link on' : 'icon audio-link',
    textContent: '♪',
    title: mod ? 'Remove the audio link' : 'Make this slider follow the music',
    onclick: () => {
      modAccess.set(mod ? undefined : { signal: 'beat', amount: 0.5 });
      onStructure();
    },
  });
  const row = h('label', { className: 'slider' }, h('span', {}, param.label), input, readout, link);
  if (!mod) return row;
  return h('div', { className: 'slider-group' }, row, modRow(mod, modAccess, ctx));
}

function modRow(mod: AudioMod, modAccess: ModAccess, ctx: Context): HTMLElement {
  const amount = h('input', {
    type: 'range',
    min: '-1',
    max: '1',
    step: '0.05',
    value: String(mod.amount),
    title: 'How far the music pushes the slider (negative pulls it down)',
  });
  const percent = h('output', {}, `${Math.round(mod.amount * 100)}%`);
  amount.oninput = () => {
    mod.amount = Number(amount.value);
    percent.textContent = `${Math.round(mod.amount * 100)}%`;
  };
  const signal = select(
    SIGNALS.map((name) => ({ value: name, label: name })),
    mod.signal,
    (value: SignalName) => {
      modAccess.set({ ...mod, signal: value });
      ctx.options.onStructure();
    },
  );
  return h('div', { className: 'mod-row' }, h('span', {}, '♪ follows'), signal, amount, percent);
}

function iconButton(
  text: string,
  title: string,
  disabled: boolean,
  onclick: () => void,
): HTMLButtonElement {
  return h('button', { className: 'icon', textContent: text, title, disabled, onclick });
}

function swap<T>(list: T[], a: number, b: number, done: () => void): void {
  [list[a], list[b]] = [list[b], list[a]];
  done();
}

const format = (value: number) => (Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(2));
