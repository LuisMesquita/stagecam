import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sirv from 'sirv';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { ClientMsg } from '../web/src/shared/protocol.ts';
import { loadCert } from './certs.ts';
import { Hub } from './hub.ts';
import type { Peer } from './hub.ts';
import { lanAddress } from './net.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DEV = process.argv.includes('--dev');
const DIRECTOR_PORT = Number(process.env.DIRECTOR_PORT ?? 4747);
const CAMERA_PORT = Number(process.env.CAMERA_PORT ?? 8443);
const DATA_DIR = process.env.STAGECAM_DATA ?? join(ROOT, 'data');
const SCENES_FILE = join(DATA_DIR, 'scenes.json');
const MAX_BODY = 2 * 1024 * 1024;
const DIRECTOR_ONLY = /^\/(director|output)(\.html)?$|^\/api\//;

type Next = () => void;
type Middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

const lanIp = lanAddress();
const camUrl = `https://${lanIp}:${CAMERA_PORT}/cam.html`;
const hub = new Hub();

const serveStatic: Middleware = DEV
  ? (
      await import('vite-plus').then(({ createServer }) =>
        createServer({
          configFile: join(ROOT, 'vite.config.ts'),
          server: { middlewareMode: true, hmr: false },
        }),
      )
    ).middlewares
  : sirv(join(ROOT, 'dist'), { extensions: ['html'] });

function handler(local: boolean) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://host').pathname;
    if (path === '/' || path === '/cam')
      return redirect(res, local ? '/director.html' : '/cam.html');
    if (!local && DIRECTOR_ONLY.test(path)) return send(res, 403, 'Forbidden');
    if (path === '/api/info') return json(res, { camUrl });
    if (path === '/api/scenes') return scenes(req, res);
    serveStatic(req, res, () => send(res, 404, 'Not found'));
  };
}

async function scenes(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method === 'PUT') {
      const body = await readBody(req);
      JSON.parse(body);
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(SCENES_FILE, body);
      return json(res, { ok: true });
    }
    const body = await readFile(SCENES_FILE, 'utf8').catch(() => 'null');
    res.writeHead(200, { 'content-type': 'application/json' }).end(body);
  } catch (error) {
    send(res, 400, String(error));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) return (fail(new Error('Body too large')), req.destroy());
      chunks.push(chunk);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

const log = (text: string) => console.log(`[${new Date().toLocaleTimeString()}] ${text}`);
const redirect = (res: ServerResponse, to: string) => res.writeHead(302, { location: to }).end();
const send = (res: ServerResponse, status: number, text: string) =>
  res.writeHead(status, { 'content-type': 'text/plain' }).end(text);
const json = (res: ServerResponse, data: unknown) =>
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const alive = new WeakSet<WebSocket>();

function attachSignaling(server: Server, local: boolean) {
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://host').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) =>
      onConnection(ws, local, req.socket.remoteAddress ?? '?'),
    );
  });
}

function onConnection(ws: WebSocket, local: boolean, address: string) {
  const peer: Peer = {
    local,
    send: (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)),
    close: (code, reason) => ws.close(code, reason),
  };
  let who = `${local ? 'director-port' : 'camera-port'} ${address}`;
  log(`connected ${who}`);
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString()) as ClientMsg;
    } catch {
      return peer.send({ t: 'error', message: 'Invalid JSON' });
    }
    if (msg.t === 'hello') {
      who =
        msg.role === 'camera' ? `camera "${msg.camera.name}" ${address}` : `director ${address}`;
      log(`hello from ${who}`);
    }
    hub.receive(peer, msg);
  });
  ws.on('close', (code, reason) => {
    log(`closed ${who} (${code}${reason.length ? ` ${reason.toString()}` : ''})`);
    hub.disconnect(peer);
  });
  ws.on('error', (error) => {
    log(`socket error ${who}: ${error.message}`);
    ws.terminate();
  });
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 10_000).unref();

const cameraServer = createHttpsServer(await loadCert(join(ROOT, '.certs'), lanIp), handler(false));
attachSignaling(cameraServer, false);

// `localhost` may resolve to IPv6 or IPv4 depending on the client, so listen on both loopbacks.
for (const host of ['127.0.0.1', '::1']) {
  const server = createHttpServer(handler(true));
  attachSignaling(server, true);
  server.on('error', (error) => log(`director listener ${host}: ${error.message}`));
  server.listen(DIRECTOR_PORT, host);
}
cameraServer.listen(CAMERA_PORT, '0.0.0.0', () => {
  console.log(`
  StageCam ${DEV ? '(dev)' : ''}
  Director (this Mac, Chrome):  http://localhost:${DIRECTOR_PORT}
  Cameras  (iPhones, Safari):   ${camUrl}
`);
});
