import QRCode from 'qrcode';
import { Engine } from '../engine/engine.ts';
import { HEIGHT, WIDTH } from '../engine/gl.ts';
import type { Target } from '../engine/gl.ts';
import { effectList, transitionList } from '../engine/registry.ts';
import {
  BLACK,
  SIGNALS,
  SLATE,
  cloneEffects,
  cloneScene,
  newScene,
  sourcesOf,
} from '../engine/scene.ts';
import type { EffectInstance, Scene } from '../engine/scene.ts';
import type { Tally } from '../shared/protocol.ts';
import { Signal } from '../shared/signal.ts';
import { AudioAnalyzer, MUSIC_ON_MAC, listMics } from './audio.ts';
import { AutoDirector } from './auto.ts';
import type { AutoStyle } from './auto.ts';
import { CameraManager } from './cameras.ts';
import type { Camera } from './cameras.ts';
import { h } from './dom.ts';
import { renderPanel } from './panel.ts';

const SLOT_COUNT = 9;
const ROTATIONS_KEY = 'stagecam.rotations';
const AUDIO_KEY = 'stagecam.audioInput';
const SENSITIVITY_KEY = 'stagecam.sensitivity';
const MONITOR = { w: 640, h: 360 };
const TILE = { w: 320, h: 180 };

interface SavedState {
  slots: (Scene | null)[];
  safe: 'slate' | number;
  outputFx?: EffectInstance[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ctx2d = (canvas: HTMLCanvasElement) => canvas.getContext('2d', { alpha: false })!;

const glCanvas = document.createElement('canvas');
const engine = new Engine(glCanvas);
const cameras = new CameraManager(engine, $('videos'));
const analyzer = new AudioAnalyzer();
const autoDirector = new AutoDirector();
let autoLook = '';
const previewCtx = ctx2d($<HTMLCanvasElement>('preview'));
const programCtx = ctx2d($<HTMLCanvasElement>('program'));
const tiles = new Map<string, { el: HTMLElement; ctx: CanvasRenderingContext2D }>();

let live = false;
let saved: SavedState = { slots: Array(SLOT_COUNT).fill(null), safe: 'slate' };
let outputWindow: Window | null = null;
let outputCtx: CanvasRenderingContext2D | null = null;
const sentTally = new Map<string, Tally>();
let refreshPanel = () => {};
/** The scene the editor panel was last built for. */
let panelScene: Scene | null = null;

// ---- signaling --------------------------------------------------------------

const signal = new Signal({
  hello: () => ({ t: 'hello', role: 'director' }),
  onMessage: (msg) => {
    if (msg.t === 'error') return toast(msg.message);
    if (msg.t === 'camera-joined' || msg.t === 'cameras') sentTally.clear();
    cameras.handle(msg);
  },
  onStatus: (connected) => {
    $('link').textContent = connected ? 'Server connected' : 'Server offline – retrying';
    $('link').classList.toggle('bad', !connected);
    if (!connected) cameras.directorDisconnected();
  },
});
cameras.attach(signal);
cameras.onChange = () => {
  renderMultiview();
  renderPanelNow();
};

// ---- engine wiring ----------------------------------------------------------

engine.safeScene = () => {
  const slot = typeof saved.safe === 'number' ? saved.slots[saved.safe] : null;
  return slot ?? newScene(SLATE);
};
engine.onChange = () => {
  // Auto-director shots replace Program every beat or two; rebuilding an unchanged Preview editor
  // each time would cut off slider drags and close open pickers.
  if (live || !autoDirector.enabled || engine.preview !== panelScene) renderPanelNow();
  renderMultiview();
};
engine.onFailSafe = (lost) => {
  const names = lost.map((id) => (cameras.cameras.has(id) ? cameras.label(id) : 'an old camera'));
  toast(`No video from ${names.join(', ')} – switched to the safe scene`);
};
engine.onError = (error) => {
  console.error(error);
  toast(error.message.split('\n')[0]);
};

// ---- render loop ------------------------------------------------------------

let loopGeneration = 0;
let lastFrameAt = 0;

function schedule() {
  const generation = loopGeneration;
  const host = outputWindow && !outputWindow.closed ? outputWindow : window;
  host.requestAnimationFrame(() => {
    if (generation === loopGeneration) frame();
  });
}

// rAF of a just-closed output window never fires; restart the loop on this window.
setInterval(() => {
  if (performance.now() - lastFrameAt > 250) {
    loopGeneration++;
    schedule();
  }
}, 250);

function frame() {
  lastFrameAt = performance.now();
  try {
    engine.signals = analyzer.update(lastFrameAt);
    renderMeters();
    runAutoDirector(lastFrameAt);
    const out = engine.tick(lastFrameAt);
    if (out) draw(out.preview, out.program);
  } catch (error) {
    engine.onError(error instanceof Error ? error : new Error(String(error)));
  }
  schedule();
}

function draw(preview: Target, program: Target) {
  const gpu = engine.gpu;
  blit(preview, previewCtx, MONITOR);
  blit(program, programCtx, MONITOR);
  if (outputWindow?.closed) {
    outputWindow = null;
    outputCtx = null;
  }
  if (outputCtx) {
    gpu.present(program, WIDTH, HEIGHT);
    outputCtx.drawImage(glCanvas, 0, 0, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT);
  }
  for (const [id, tile] of tiles) blit(engine.sourceTarget(id), tile.ctx, TILE);
  const progress = engine.transitionProgress;
  $('progress-bar').style.width = `${engine.transitioning ? progress * 100 : 0}%`;
}

function blit(target: Target, ctx: CanvasRenderingContext2D, size: { w: number; h: number }) {
  engine.gpu.present(target, size.w, size.h);
  ctx.drawImage(
    glCanvas,
    0,
    HEIGHT - size.h,
    size.w,
    size.h,
    0,
    0,
    ctx.canvas.width,
    ctx.canvas.height,
  );
}

// ---- multiview --------------------------------------------------------------

function renderMultiview() {
  const list = cameras.sorted();
  $('camera-count').textContent =
    `${list.filter((c) => c.online).length} camera${list.length === 1 ? '' : 's'}`;
  $('empty').hidden = list.length > 0;
  const host = $('multiview');
  for (const id of tiles.keys()) {
    if (!cameras.cameras.has(id)) {
      tiles.get(id)!.el.remove();
      tiles.delete(id);
    }
  }
  for (const camera of list) {
    let tile = tiles.get(camera.info.id);
    if (!tile) {
      tile = createTile(camera);
      tiles.set(camera.info.id, tile);
    }
    host.append(tile.el);
    updateTile(camera, tile.el);
  }
}

function createTile(camera: Camera) {
  const id = camera.info.id;
  const canvas = h('canvas', { width: TILE.w, height: TILE.h });
  const el = h(
    'figure',
    { className: 'tile', title: 'Click: send to preview · double-click name: rename' },
    canvas,
    h(
      'figcaption',
      {},
      h('kbd', { className: 'num' }),
      h('span', { className: 'name' }),
      h('span', { className: 'state' }),
      h('button', {
        className: 'icon rotate',
        textContent: '↻',
        title: 'Rotate 90°',
        onclick: (event: MouseEvent) => {
          event.stopPropagation();
          rotate(id, engine.rotation(id) + 1);
        },
      }),
      h('button', {
        className: 'icon kick',
        textContent: '×',
        title: 'Remove camera',
        onclick: (event: MouseEvent) => {
          event.stopPropagation();
          if (confirm(`Remove ${cameras.label(id)}?`)) cameras.kick(id);
        },
      }),
    ),
  );
  el.onclick = () => setPreviewSource(id);
  el.querySelector<HTMLElement>('.name')!.ondblclick = (event) => {
    event.stopPropagation();
    const name = prompt('Camera name', cameras.cameras.get(id)?.info.name ?? '');
    if (name?.trim()) cameras.rename(id, name.trim());
  };
  return { el, ctx: ctx2d(canvas) };
}

function updateTile(camera: Camera, el: HTMLElement) {
  const id = camera.info.id;
  const lost = !camera.online || engine.isLost(id);
  el.querySelector('.num')!.textContent = String(camera.number);
  el.querySelector('.name')!.textContent = camera.info.name;
  const stats = camera.stats;
  const weak = !lost && !!stats && (stats.fps < 20 || stats.kbps < 600);
  el.querySelector('.state')!.textContent = !camera.online
    ? 'offline'
    : camera.link === 'connected'
      ? lost
        ? 'no video'
        : stats
          ? `${stats.fps} fps · ${(stats.kbps / 1000).toFixed(1)} Mb · ${stats.height}p`
          : ''
      : camera.link === 'waiting'
        ? 'joining…'
        : camera.link;
  el.classList.toggle('lost', lost);
  el.classList.toggle('weak', weak);
  el.classList.toggle(
    'on-program',
    engine.onAir.some((scene) => sourcesOf(scene).includes(id)),
  );
  el.classList.toggle('on-preview', sourcesOf(engine.preview).includes(id));
}

// Lost state and tally change without events, so refresh them on a timer.
setInterval(() => {
  for (const camera of cameras.sorted()) {
    const tile = tiles.get(camera.info.id);
    if (tile) updateTile(camera, tile.el);
  }
  sendTally();
}, 500);

function sendTally() {
  const program = new Set(engine.onAir.flatMap(sourcesOf));
  const preview = new Set(sourcesOf(engine.preview));
  for (const camera of cameras.sorted()) {
    if (!camera.online) continue;
    const id = camera.info.id;
    const state: Tally = program.has(id) ? 'program' : preview.has(id) ? 'preview' : 'off';
    if (sentTally.get(id) === state) continue;
    sentTally.set(id, state);
    signal.send({ t: 'tally', to: id, state });
  }
}

function loadRotations(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ROTATIONS_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function rotate(id: string, quarterTurns: number) {
  engine.setRotation(id, quarterTurns);
  const rotations = loadRotations();
  rotations[id] = engine.rotation(id);
  localStorage.setItem(ROTATIONS_KEY, JSON.stringify(rotations));
}

for (const [id, quarterTurns] of Object.entries(loadRotations()))
  engine.setRotation(id, quarterTurns);

// ---- editing ----------------------------------------------------------------

function setPreviewSource(id: string) {
  engine.preview.layers[0].sourceId = id;
  renderPanelNow();
  renderMultiview();
}

function renderPanelNow() {
  const sources = [
    ...cameras
      .sorted()
      .map((camera) => ({ value: camera.info.id, label: cameras.label(camera.info.id) })),
    { value: SLATE, label: 'Slate' },
    { value: BLACK, label: 'Black' },
  ];
  const scene = live ? engine.program : engine.preview;
  panelScene = scene;
  for (const layer of scene.layers) {
    if (!sources.some((s) => s.value === layer.sourceId))
      sources.unshift({ value: layer.sourceId, label: 'Missing camera' });
  }
  refreshPanel = renderPanel($('panel'), {
    scene,
    outputFx: engine.outputFx,
    live,
    sources,
    signals: () => engine.signals,
    onStructure: () => {
      renderPanelNow();
      renderMultiview();
      void persist();
    },
  });
}

function setLive(value: boolean) {
  live = value;
  const button = $('live-toggle');
  button.textContent = `LIVE edit: ${live ? 'ON' : 'off'}`;
  button.classList.toggle('on', live);
  document.body.classList.toggle('live-mode', live);
  renderPanelNow();
}

setInterval(() => refreshPanel(), 100);

// ---- audio ------------------------------------------------------------------

const audioSelect = $<HTMLSelectElement>('audio-input');
const sensitivity = $<HTMLInputElement>('sensitivity');
const meterBars = SIGNALS.map((name) => {
  const bar = h('i');
  $('meters').append(h('span', { className: `meter ${name}`, title: name }, bar));
  return bar;
});

function renderMeters() {
  SIGNALS.forEach((name, i) => {
    meterBars[i].style.transform = `scaleY(${engine.signals[name]})`;
  });
}

async function renderAudioInputs() {
  const mics = await listMics().catch(() => []);
  const current = audioSelect.value;
  audioSelect.replaceChildren(
    h('option', { value: '', textContent: '♪ Audio off' }),
    h('option', {
      value: MUSIC_ON_MAC,
      textContent: '♪ Music playing on this Mac (tab or screen)',
    }),
    ...mics.map((mic) => h('option', { value: mic.id, textContent: `🎤 ${mic.label}` })),
  );
  audioSelect.value = [...audioSelect.options].some((o) => o.value === current) ? current : '';
}

async function startAudio(input: string) {
  if (!input) {
    analyzer.stop();
    setBeatCut(0);
    localStorage.removeItem(AUDIO_KEY);
    return;
  }
  try {
    if (!(await analyzer.start(input))) return;
    if (input !== MUSIC_ON_MAC) localStorage.setItem(AUDIO_KEY, input);
    else toast('Capturing music – keep the shared tab or screen open');
    await renderAudioInputs();
    audioSelect.value = input;
  } catch (error) {
    // analyzer.start() already stopped the previous input, so audio is off now.
    audioSelect.value = '';
    setBeatCut(0);
    const name = error instanceof DOMException ? error.name : '';
    if (name !== 'NotAllowedError' && name !== 'AbortError')
      toast(String(error instanceof Error ? error.message : error));
  }
}

audioSelect.onchange = () => void startAudio(audioSelect.value);
analyzer.onEnded = () => {
  audioSelect.value = '';
  setBeatCut(0);
  toast('Audio input stopped');
};
sensitivity.value = localStorage.getItem(SENSITIVITY_KEY) ?? sensitivity.value;
analyzer.gain = Number(sensitivity.value);
sensitivity.oninput = () => {
  analyzer.gain = Number(sensitivity.value);
  localStorage.setItem(SENSITIVITY_KEY, sensitivity.value);
};
navigator.mediaDevices.addEventListener('devicechange', () => void renderAudioInputs());
// Keyboard-only directing is a user gesture too; without one a restored mic stays suspended.
for (const type of ['pointerdown', 'keydown'] as const) {
  document.addEventListener(type, () => analyzer.resume());
}

async function restoreAudio() {
  await renderAudioInputs();
  const savedMic = localStorage.getItem(AUDIO_KEY);
  if (savedMic && [...audioSelect.options].some((o) => o.value === savedMic))
    await startAudio(savedMic);
}

// ---- beat cut -----------------------------------------------------------------

const beatCutSelect = $<HTMLSelectElement>('beat-cut');
let beatEvery = 0;
let lastBeatEvery = 4;
let beatCounter = 0;

function setBeatCut(every: number) {
  if (every && !analyzer.active) {
    toast('Choose an audio input first (top right)');
    every = 0;
  }
  if (every && autoDirector.enabled) setAutoDirector(false);
  beatEvery = every;
  if (every) lastBeatEvery = every;
  beatCounter = 0;
  beatCutSelect.value = String(every);
  beatCutSelect.closest('label')!.classList.toggle('on', every > 0);
}

beatCutSelect.onchange = () => setBeatCut(Number(beatCutSelect.value));

/** Moves Program's base layer to the next camera that has video, keeping layers and effects. */
function beatCut() {
  const withVideo = camerasWithVideo();
  if (withVideo.length < 2 || engine.transitioning) return;
  const base = engine.program.layers[0];
  const index = withVideo.indexOf(base.sourceId);
  base.sourceId = withVideo[(index + 1) % withVideo.length];
  renderMultiview();
  // A full rebuild on every beat would cut off a slider drag in LIVE edit; sync only the source picker.
  if (live) {
    const picker = $('panel').querySelector<HTMLSelectElement>('.card-head select');
    if (picker) picker.value = base.sourceId;
  }
}

function camerasWithVideo(): string[] {
  return cameras
    .sorted()
    .filter((c) => c.online && !engine.isLost(c.info.id))
    .map((c) => c.info.id);
}

analyzer.onBeat = () => {
  autoDirector.onBeat();
  if (!beatEvery) return;
  beatCounter++;
  if (beatCounter % beatEvery === 0) beatCut();
};

// ---- auto director ------------------------------------------------------------

const autoButton = $('auto-director');
const autoStyle = $<HTMLSelectElement>('auto-style');

function setAutoDirector(on: boolean) {
  autoDirector.enabled = on;
  autoButton.classList.toggle('on', on);
  if (on) {
    setBeatCut(0);
    autoDirector.queueNow();
  } else {
    autoLook = '';
  }
  renderAutoStatus();
}

function runAutoDirector(now: number) {
  // Like beatCut(): let a running transition (a manual AUTO, the fail-safe) land before the next shot.
  if (engine.transitioning) return;
  const decision = autoDirector.update({
    cameras: camerasWithVideo(),
    program: engine.program,
    signals: engine.signals,
    audio: analyzer.active,
    now,
  });
  if (!decision) return;
  autoLook = decision.look;
  if (decision.transition)
    engine.transitionTo(decision.scene, decision.transition, decision.seconds);
  else engine.take(decision.scene);
  renderAutoStatus();
}

function renderAutoStatus() {
  $('auto-status').textContent = autoDirector.enabled
    ? `${autoLook || 'waiting for a camera'} · next in ${autoDirector.remaining({ audio: analyzer.active, now: performance.now() })} · ${autoDirector.energy}`
    : '';
}

/** A shot the director picked by hand gets a full shot length before the auto director moves on. */
function manual(action: () => void) {
  action();
  autoDirector.restart(performance.now());
}

autoButton.onclick = () => setAutoDirector(!autoDirector.enabled);
autoStyle.onchange = () => (autoDirector.style = autoStyle.value as AutoStyle);
setInterval(renderAutoStatus, 250);

// ---- switcher ---------------------------------------------------------------

const transitionSelect = $<HTMLSelectElement>('transition');
for (const def of transitionList)
  transitionSelect.append(h('option', { value: def.id, textContent: def.name }));
transitionSelect.value = engine.transitionId;
transitionSelect.onchange = () => (engine.transitionId = transitionSelect.value);

const duration = $<HTMLInputElement>('duration');
duration.oninput = () => {
  engine.transitionSeconds = Number(duration.value);
  $('duration-out').textContent = `${Number(duration.value).toFixed(1)} s`;
};

$('cut').onclick = () => manual(() => engine.cut());
$('auto').onclick = () => manual(() => engine.auto());
$('live-toggle').onclick = () => setLive(!live);

// ---- scene slots ------------------------------------------------------------

async function loadSaved() {
  try {
    const data = (await (await fetch('/api/scenes')).json()) as SavedState | null;
    if (data?.slots) {
      saved = {
        ...data,
        slots: Array.from({ length: SLOT_COUNT }, (_, i) => data.slots[i] ?? null),
      };
      if (data.outputFx) engine.outputFx = cloneEffects(data.outputFx);
    }
  } catch {
    toast('Could not load saved scenes');
  }
  renderSlots();
  renderPanelNow();
}

async function persist() {
  saved.outputFx = engine.outputFx;
  await fetch('/api/scenes', { method: 'PUT', body: JSON.stringify(saved) }).catch(() =>
    toast('Could not save scenes'),
  );
}

function loadSlot(index: number, target: 'program' | 'preview') {
  const slot = saved.slots[index];
  if (!slot) return toast(`Slot ${index + 1} is empty – shift-click to save the preview there`);
  if (target === 'program') manual(() => engine.take(slot));
  else engine.preview = cloneScene(slot);
  renderPanelNow();
  renderMultiview();
}

function saveSlot(index: number) {
  saved.slots[index] = cloneScene(engine.preview);
  renderSlots();
  void persist();
  toast(`Preview saved to slot ${index + 1}`);
}

function renderSlots() {
  const host = $('slots');
  host.replaceChildren(
    ...saved.slots.map((slot, i) =>
      h('button', {
        className: slot ? 'slot filled' : 'slot',
        innerHTML: `<b>${i + 1}</b><small>F${i + 1}</small>`,
        title: slot ? describe(slot) : 'Empty – shift-click to save the preview here',
        onclick: (event: MouseEvent) =>
          event.shiftKey ? saveSlot(i) : loadSlot(i, event.altKey ? 'preview' : 'program'),
      }),
    ),
  );
  const safe = $<HTMLSelectElement>('safe');
  safe.replaceChildren(
    h('option', { value: 'slate', textContent: 'Slate' }),
    ...saved.slots.map((slot, i) =>
      h('option', { value: String(i), textContent: `Slot ${i + 1}`, disabled: !slot }),
    ),
  );
  safe.value = String(saved.safe);
  safe.onchange = () => {
    saved.safe = safe.value === 'slate' ? 'slate' : Number(safe.value);
    void persist();
  };
}

function describe(scene: Scene): string {
  return scene.layers
    .map((layer) => {
      const fx = layer.effects.map((e) => effectList.find((d) => d.id === e.type)?.name ?? e.type);
      return `${cameras.cameras.has(layer.sourceId) ? cameras.label(layer.sourceId) : layer.sourceId}${fx.length ? ` + ${fx.join(', ')}` : ''}`;
    })
    .join('\n');
}

// ---- output window ----------------------------------------------------------

interface ScreenDetailed {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}
type WithScreens = Window & {
  getScreenDetails?: () => Promise<{ screens: ScreenDetailed[]; currentScreen: ScreenDetailed }>;
};

$('open-output').onclick = async () => {
  if (outputWindow && !outputWindow.closed) return outputWindow.focus();
  let features = 'popup,width=1280,height=720';
  try {
    const details = await (window as WithScreens).getScreenDetails?.();
    const other = details?.screens.find((s) => s !== details.currentScreen);
    if (other) {
      features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    }
  } catch {
    // Permission denied: open a normal popup and let the user drag it to the TV.
  }
  const win = window.open('/output.html', 'stagecam-output', features);
  if (!win) return toast('The popup was blocked – click "Open output window" again');
  outputWindow = win;
  const attach = () => {
    const canvas = win.document.getElementById('out') as HTMLCanvasElement | null;
    if (canvas) outputCtx = ctx2d(canvas);
  };
  if (win.document.readyState === 'complete' && win.location.pathname === '/output.html') attach();
  else win.addEventListener('load', attach);
};

// ---- QR ---------------------------------------------------------------------

$('add-cameras').onclick = async () => {
  const { camUrl } = (await (await fetch('/api/info')).json()) as { camUrl: string };
  $('cam-url').textContent = camUrl;
  await QRCode.toCanvas($<HTMLCanvasElement>('qr'), camUrl, { width: 280, margin: 1 });
  $<HTMLDialogElement>('qr-dialog').showModal();
};

// ---- keyboard ---------------------------------------------------------------

function handleKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.('input:not([type=range]):not([type=checkbox]), textarea, select, dialog'))
    return;
  if (event.metaKey || event.ctrlKey) return;
  const fKey = /^F([1-9])$/.exec(event.key);
  if (/^[1-9]$/.test(event.key)) {
    const camera = cameras.byNumber(Number(event.key));
    if (camera) setPreviewSource(camera.info.id);
  } else if (event.code === 'Space') {
    event.preventDefault();
    manual(() => engine.cut());
  } else if (event.key === 'Enter') {
    event.preventDefault();
    manual(() => engine.auto());
  } else if (fKey) {
    event.preventDefault();
    const index = Number(fKey[1]) - 1;
    if (event.shiftKey) saveSlot(index);
    else loadSlot(index, event.altKey ? 'preview' : 'program');
  } else if (event.code === 'KeyL' && !event.altKey) {
    setLive(!live);
  } else if (event.code === 'KeyD' && !event.altKey) {
    setAutoDirector(!autoDirector.enabled);
  } else if (event.code === 'KeyB' && !event.altKey) {
    setBeatCut(beatEvery ? 0 : lastBeatEvery);
  }
}

window.addEventListener('keydown', handleKey);
(window as Window & { stagecamKey?: typeof handleKey }).stagecamKey = handleKey;

// Keep Space/Enter for the switcher instead of re-clicking the last button.
document.addEventListener('click', (event) => {
  (event.target as HTMLElement | null)?.closest('button')?.blur();
});

// ---- misc -------------------------------------------------------------------

let toastTimer = 0;
function toast(text: string) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3500);
}

Object.assign(window, {
  stagecam: { engine, cameras, analyzer, autoDirector, effectList, transitionList },
});

renderSlots();
renderPanelNow();
renderMultiview();
void loadSaved();
void restoreAudio();
signal.connect();
schedule();
