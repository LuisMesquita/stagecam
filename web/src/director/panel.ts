import { effectList, effects } from '../engine/registry.ts';
import { newEffect, newLayer } from '../engine/scene.ts';
import type { BlendMode, EffectInstance, Layer, Scene } from '../engine/scene.ts';
import { BLEND_MODES } from '../engine/shaders.ts';
import type { ParamDef } from '../engine/types.ts';
import { h, select } from './dom.ts';

export interface PanelOptions {
  scene: Scene;
  outputFx: EffectInstance[];
  live: boolean;
  sources: { value: string; label: string }[];
  /** Called after a structural edit (add/remove/reorder) so the panel can be rebuilt. */
  onStructure: () => void;
}

/** Editor for the bus being edited. Sliders mutate the scene in place, so changes show on the next frame. */
export function renderPanel(root: HTMLElement, options: PanelOptions): void {
  const { scene, outputFx, live, onStructure } = options;
  root.replaceChildren(
    h(
      'h2',
      { className: live ? 'panel-title live' : 'panel-title' },
      live ? 'Editing PROGRAM (live)' : 'Editing PREVIEW',
    ),
    ...scene.layers.map((layer, index) => layerCard(scene, layer, index, options)),
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
      effectChain(outputFx, onStructure),
    ),
  );
}

function layerCard(scene: Scene, layer: Layer, index: number, options: PanelOptions): HTMLElement {
  const { onStructure } = options;
  const base = index === 0;
  const head = h(
    'header',
    { className: 'card-head' },
    h('strong', {}, base ? 'Base layer' : `Layer ${index + 1}`),
    select(options.sources, layer.sourceId, (value) => {
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
    { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, default: 1 },
    () => layer.opacity,
    (value) => (layer.opacity = value),
  );
  return h(
    'section',
    { className: 'card' },
    head,
    blend,
    opacity,
    effectChain(layer.effects, onStructure),
  );
}

function effectChain(list: EffectInstance[], onStructure: () => void): HTMLElement {
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

function slider(param: ParamDef, get: () => number, set: (value: number) => void): HTMLElement {
  const input = h('input', {
    type: 'range',
    min: String(param.min),
    max: String(param.max),
    step: String(param.step ?? (param.max - param.min) / 100),
    value: String(get()),
    title: 'Double-click to reset',
  });
  const readout = h('output', {}, format(get()));
  input.oninput = () => {
    set(Number(input.value));
    readout.textContent = format(Number(input.value));
  };
  input.ondblclick = () => {
    input.value = String(param.default);
    input.dispatchEvent(new Event('input'));
  };
  return h('label', { className: 'slider' }, h('span', {}, param.label), input, readout);
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
