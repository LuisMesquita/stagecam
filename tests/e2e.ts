// End-to-end check with the installed Google Chrome and Chrome's fake camera:
// 2 camera pages stream to the director, then switching, effects, tally and the fail-safe are verified.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { lanAddress } from '../server/net.ts';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'tests', 'output');
const DIRECTOR = 'http://localhost:18080';
const CAMERA = `https://${lanAddress()}:18443/cam.html`;

await mkdir(OUT, { recursive: true });
const server = spawn(process.execPath, ['server/index.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    DIRECTOR_PORT: '18080',
    CAMERA_PORT: '18443',
    STAGECAM_DATA: await mkdtemp(join(tmpdir(), 'stagecam-e2e-')),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((ok) =>
  server.stdout!.on('data', (d: Buffer) => d.includes('Cameras') && ok()),
);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const errors: string[] = [];
let failed = false;
const step = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed = true;
    console.log(`  ✗ ${name}\n    ${String(error).split('\n').slice(0, 6).join('\n    ')}`);
  }
};

try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1600, height: 1000 },
  });
  const director = await context.newPage();
  director.on('console', (m) => m.type() === 'error' && errors.push(`director: ${m.text()}`));
  director.on('pageerror', (e) => errors.push(`director: ${e.message}`));
  await director.goto(`${DIRECTOR}/director.html?codec=any`);

  const cams: Page[] = [];
  for (const name of ['Ana', 'Ben']) {
    // Separate contexts: each phone has its own localStorage and therefore its own camera id.
    const camContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 844, height: 390 },
    });
    const cam = await camContext.newPage();
    cam.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await cam.goto(CAMERA);
    await cam.fill('#name', name);
    await cam.click('#start');
    cams.push(cam);
  }

  await step('camera page is blocked from the director URL', async () => {
    const res = await context.request.get(CAMERA.replace('cam.html', 'director.html'));
    if (res.status() !== 403) throw new Error(`status ${res.status()}`);
  });

  await step('both cameras connect over WebRTC and stream frames', async () => {
    await director.waitForFunction(
      () => {
        const { cameras, engine } = (window as any).stagecam;
        const list = [...cameras.cameras.values()];
        return (
          list.length === 2 &&
          list.every(
            (c: any) =>
              c.link === 'connected' && c.video.videoWidth > 0 && !engine.isLost(c.info.id),
          )
        );
      },
      undefined,
      { timeout: 20_000 },
    );
  });

  await step('multiview tiles show video (not black)', async () => {
    await director.waitForTimeout(500);
    const lit = await director.$$eval('.tile canvas', (canvases) =>
      canvases.map((c) => {
        const data = (c as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 320, 180).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
        return sum / (data.length / 4);
      }),
    );
    if (lit.length !== 2 || lit.some((v) => v < 10)) throw new Error(`tile brightness ${lit}`);
  });

  await step('every effect compiles and renders on preview and output', async () => {
    await director.evaluate(() => {
      const { engine, effectList } = (window as any).stagecam;
      const layer = engine.preview.layers[0];
      for (const def of effectList)
        layer.effects.push({ uid: `t-${def.id}`, type: def.id, enabled: true, params: {} });
      engine.outputFx.push({ uid: 'o-sat', type: 'oversaturate', enabled: true, params: {} });
      engine.onChange();
    });
    await director.waitForTimeout(800);
    const toast = await director.$eval('#toast', (el) =>
      (el as HTMLElement).hidden ? '' : el.textContent,
    );
    if (toast) throw new Error(toast);
  });

  await step('key 1 + Enter runs every transition and puts camera 1 on program', async () => {
    for (const id of ['crossfade', 'wipe', 'glitch']) {
      await director.selectOption('#transition', id);
      await director.locator('body').click({ position: { x: 5, y: 990 } });
      await director.keyboard.press('1');
      await director.keyboard.press('Enter');
      await director.waitForTimeout(1100);
    }
    const ok = await director.evaluate(() => {
      const { engine, cameras } = (window as any).stagecam;
      return (
        engine.program.layers[0].sourceId === cameras.byNumber(1).info.id && !engine.transitioning
      );
    });
    if (!ok) throw new Error('camera 1 is not on program');
    const toast = await director.$eval('#toast', (el) =>
      (el as HTMLElement).hidden ? '' : el.textContent,
    );
    if (toast) throw new Error(toast);
  });

  await step('the camera on program shows ON AIR', async () => {
    const number1 = await director.evaluate(
      () => (window as any).stagecam.cameras.byNumber(1).info.name,
    );
    const cam = number1 === 'Ana' ? cams[0] : cams[1];
    await cam.waitForFunction(
      () => document.getElementById('tally')!.textContent === 'ON AIR',
      undefined,
      {
        timeout: 3000,
      },
    );
    await cam.screenshot({ path: join(OUT, 'camera-on-air.png') });
  });

  await step('superimpose: second layer with screen blend', async () => {
    await director.click('text=+ Add layer (superimpose)');
    const layers = await director.evaluate(
      () => (window as any).stagecam.engine.preview.layers.length,
    );
    if (layers !== 2) throw new Error(`layers ${layers}`);
    await director.waitForTimeout(300);
    await director.screenshot({ path: join(OUT, 'director.png') });
  });

  await step('rotating a camera turns it into a pillarboxed portrait image', async () => {
    const id = await director.evaluate(() => (window as any).stagecam.cameras.byNumber(1).info.id);
    await director.locator('.tile').first().locator('.rotate').click();
    await director.waitForTimeout(400);
    const [edge, center] = await director.$eval('.tile canvas', (c) => {
      const ctx = (c as HTMLCanvasElement).getContext('2d')!;
      const avg = (x: number) => {
        const d = ctx.getImageData(x, 60, 4, 60).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
        return sum / (d.length / 4);
      };
      return [avg(4), avg(158)];
    });
    if (edge > 5 || center < 10) throw new Error(`edge ${edge}, center ${center}`);
    const rotation = await director.evaluate(
      (cam) => (window as any).stagecam.engine.rotation(cam),
      id,
    );
    if (rotation !== 1) throw new Error(`rotation ${rotation}`);
    await director.screenshot({ path: join(OUT, 'director-rotated.png') });
  });

  await step(
    'clicking a scene slot puts it live instantly; option-click loads preview',
    async () => {
      const [id1, id2] = await director.evaluate(() => {
        const { cameras, engine } = (window as any).stagecam;
        engine.preview.layers.splice(1);
        engine.preview.layers[0].sourceId = cameras.byNumber(2).info.id;
        return [cameras.byNumber(1).info.id, cameras.byNumber(2).info.id];
      });
      await director
        .locator('.slot')
        .first()
        .click({ modifiers: ['Shift'] });
      await director.keyboard.press('1');
      await director.locator('.slot').first().click();
      const live = await director.evaluate(() => {
        const { engine } = (window as any).stagecam;
        return [
          engine.program.layers[0].sourceId,
          engine.preview.layers[0].sourceId,
          engine.transitioning,
        ];
      });
      if (live[0] !== id2 || live[1] !== id1 || live[2]) throw new Error(JSON.stringify(live));
      await director
        .locator('.slot')
        .first()
        .click({ modifiers: ['Alt'] });
      const preview = await director.evaluate(
        () => (window as any).stagecam.engine.preview.layers[0].sourceId,
      );
      if (preview !== id2) throw new Error(`preview ${preview}`);
    },
  );

  await step('tiles show link stats', async () => {
    await director.waitForFunction(
      () =>
        [...document.querySelectorAll('.tile .state')].every((el) =>
          el.textContent?.includes('fps'),
        ),
      undefined,
      { timeout: 5000 },
    );
  });

  await step('a microphone drives the meters and the beat detector', async () => {
    const options = await director.$$eval('#audio-input option', (els) =>
      els.map((o) => (o as HTMLOptionElement).value),
    );
    await director.selectOption(
      '#audio-input',
      options.find((v) => v && v !== 'display')!,
    );
    await director.waitForFunction(() => (window as any).stagecam.analyzer.active, undefined, {
      timeout: 5000,
    });
    await director.waitForFunction(
      () => (window as any).stagecam.engine.signals.level > 0.05,
      undefined,
      { timeout: 5000 },
    );
    await director.waitForFunction(
      () => (window as any).stagecam.analyzer.beats.count >= 2,
      undefined,
      { timeout: 10_000 },
    );
  });

  await step('a ♪-linked slider shows a live value away from its resting value', async () => {
    await director.evaluate(() => {
      const { engine } = (window as any).stagecam;
      engine.preview.layers[0].effects = [
        {
          uid: 'sat',
          type: 'oversaturate',
          enabled: true,
          params: { amount: 0.5, contrast: 1 },
          mods: { amount: { signal: 'level', amount: 1 } },
        },
      ];
      engine.onChange();
    });
    await director.waitForSelector('button.audio-link.on');
    await director.screenshot({ path: join(OUT, 'director-audio.png') });
    await director.waitForFunction(
      () => {
        const out = document.querySelector('.effect .slider output');
        return out !== null && Number(out.textContent) > 0.6;
      },
      undefined,
      { timeout: 5000 },
    );
  });

  await step('beat cut switches program between cameras on the beat', async () => {
    await director.selectOption('#beat-cut', '1');
    const seen = new Set<string>();
    const deadline = Date.now() + 10_000;
    while (seen.size < 2 && Date.now() < deadline) {
      seen.add(
        await director.evaluate(() => (window as any).stagecam.engine.program.layers[0].sourceId),
      );
      await director.waitForTimeout(100);
    }
    await director.selectOption('#beat-cut', '0');
    if (seen.size < 2) throw new Error(`program stayed on ${[...seen]}`);
  });

  await step('a phone back from the background reconnects by itself', async () => {
    const cam = cams[1];
    const setVisibility = (state: string) =>
      cam.evaluate((value) => {
        Object.defineProperty(document, 'visibilityState', { value, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);
    await setVisibility('hidden');
    await cam.waitForTimeout(2500);
    await setVisibility('visible');
    await cam.waitForFunction(
      () => document.getElementById('status')!.textContent === 'Live link OK',
      undefined,
      {
        timeout: 15_000,
      },
    );
    const back = await director.evaluate(() =>
      [...(window as any).stagecam.cameras.cameras.values()].every(
        (c: any) => c.online && c.link === 'connected',
      ),
    );
    if (!back) throw new Error('director did not see the camera reconnect');
    const awake = await cam.$eval('#awake', (el) => el.textContent);
    if (!awake) throw new Error('wake-lock pill missing');
  });

  await step('losing one of two cameras on program keeps the shot on air', async () => {
    await director.evaluate(() => {
      const { cameras, engine } = (window as any).stagecam;
      const scene = {
        layers: [1, 2].map((n) => ({
          uid: `l${n}`,
          sourceId: cameras.byNumber(n).info.id,
          blend: 'screen',
          opacity: 1,
          effects: [],
        })),
      };
      engine.take(scene);
    });
    const name1 = await director.evaluate(
      () => (window as any).stagecam.cameras.byNumber(1).info.name,
    );
    const [first, second] = name1 === 'Ana' ? cams : [cams[1], cams[0]];
    await first.close();
    await director.waitForTimeout(3500);
    const sources = await director.evaluate(() =>
      (window as any).stagecam.engine.program.layers.map((l: any) => l.sourceId),
    );
    if (sources.includes('slate')) throw new Error('fell back to slate with one camera alive');

    await second.close();
    await director.waitForFunction(
      () => (window as any).stagecam.engine.program.layers[0].sourceId === 'slate',
      undefined,
      { timeout: 6000 },
    );
    const toast = await director.$eval('#toast', (el) => el.textContent ?? '');
    if (!toast.includes('No video')) throw new Error(`toast: ${toast}`);
    await director.screenshot({ path: join(OUT, 'director-failsafe.png') });
  });

  await step('no console errors', async () => {
    if (errors.length) throw new Error(errors.join('\n'));
  });
} finally {
  await browser.close();
  server.kill();
}

console.log(failed ? '\nE2E FAILED' : `\nE2E passed – screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
