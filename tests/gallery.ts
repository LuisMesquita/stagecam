// Renders every effect on the face fixture and writes tests/output/gallery.png (a contact sheet).
import { spawn, execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { lanAddress } from '../server/net.ts';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'tests', 'output');
const FRAMES = join(OUT, 'gallery');
const only = process.argv.slice(2);

await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });
const server = spawn(process.execPath, ['server/index.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    DIRECTOR_PORT: '18082',
    CAMERA_PORT: '18445',
    STAGECAM_DATA: await mkdtemp(join(tmpdir(), 'stagecam-gallery-')),
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
    `--use-file-for-fake-video-capture=${join(ROOT, 'tests', 'fixtures', 'face.y4m')}`,
  ],
});
try {
  const director = await (await browser.newContext()).newPage();
  director.on(
    'console',
    (m) => m.type() !== 'log' && console.log(`director ${m.type()}: ${m.text()}`),
  );
  director.on('pageerror', (e) => console.log(`director error: ${e.message}`));
  await director.goto('http://localhost:18082/director.html?codec=any');
  const cam = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  await cam.goto(`https://${lanAddress()}:18445/cam.html`);
  await cam.click('#start');
  await director
    .waitForFunction(
      () => {
        const [camera] = [...(window as any).stagecam.cameras.cameras.values()];
        return (
          camera?.video.videoWidth > 0 && !(window as any).stagecam.engine.isLost(camera.info.id)
        );
      },
      undefined,
      { timeout: 30_000 },
    )
    .catch(async (error) => {
      console.log(
        await director.evaluate(() =>
          JSON.stringify(
            [...(window as any).stagecam.cameras.cameras.values()].map((c: any) => ({
              link: c.link,
              w: c.video.videoWidth,
              frames: c.video.getVideoPlaybackQuality().totalVideoFrames,
              stale: (window as any).stagecam.engine.staleness(c.info.id),
            })),
          ),
        ),
        await cam.$eval('#status', (el) => el.textContent),
      );
      throw error;
    });
  const ids: { id: string; name: string }[] = await director.evaluate(() =>
    (window as any).stagecam.effectList.map((d: any) => ({ id: d.id, name: d.name })),
  );
  for (const { id, name } of [{ id: '', name: 'Original' }, ...ids]) {
    if (only.length && id && !only.includes(id)) continue;
    await director.evaluate((effect) => {
      const { engine, cameras } = (window as any).stagecam;
      const [camera] = [...cameras.cameras.values()];
      engine.preview = {
        layers: [
          {
            uid: `g-${effect}`,
            sourceId: camera.info.id,
            blend: 'normal',
            opacity: 1,
            effects: effect
              ? [{ uid: `e-${effect}`, type: effect, enabled: true, params: {} }]
              : [],
          },
        ],
      };
    }, id);
    const needsFaces = await director.evaluate(
      (effect) =>
        !!(window as any).stagecam.effectList.find((d: any) => d.id === effect)?.needsFaces,
      id,
    );
    if (needsFaces) {
      await director
        .waitForFunction(
          () => {
            const { cameras, faceTracker } = (window as any).stagecam;
            const [camera] = [...cameras.cameras.values()];
            return faceTracker.faces(camera.info.id).length > 0;
          },
          undefined,
          { timeout: 30_000 },
        )
        .catch(async (error) => {
          console.log(
            await director.evaluate(() => {
              const [camera] = [...(window as any).stagecam.cameras.cameras.values()];
              return `video ${camera.video.videoWidth}x${camera.video.videoHeight}, tracker ${JSON.stringify((window as any).stagecam.faceTracker.stats)}`;
            }),
          );
          throw error;
        });
    }
    await director.waitForTimeout(1200);
    const png = await director.$eval(
      '#preview',
      (preview, label) => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(preview as HTMLCanvasElement, 0, 0, 640, 360);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, 640, 40);
        ctx.fillStyle = '#fff';
        ctx.font = '600 22px -apple-system, sans-serif';
        ctx.fillText(label, 12, 28);
        return canvas.toDataURL('image/png');
      },
      name,
    );
    const index = String(ids.findIndex((d) => d.id === id) + 1).padStart(2, '0');
    await writeFile(
      join(FRAMES, `${index}-${id || 'original'}.png`),
      Buffer.from(png.split(',')[1], 'base64'),
    );
  }
  const columns = 4;
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-pattern_type',
    'glob',
    '-i',
    join(FRAMES, '*.png'),
    '-vf',
    `scale=480:-1,tile=${columns}x${Math.ceil(readdirSync(FRAMES).length / columns)}:padding=4:color=0x09090b`,
    '-frames:v',
    '1',
    join(OUT, 'gallery.png'),
  ]);
  console.log(`Gallery written to ${join(OUT, 'gallery.png')}`);
} finally {
  await browser.close();
  server.kill();
}
