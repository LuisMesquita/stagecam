import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { CLOSE_FORBIDDEN, CLOSE_KICKED, CLOSE_REPLACED, Hub } from '../server/hub.ts';
import type { Peer } from '../server/hub.ts';
import type { ServerMsg } from '../web/src/shared/protocol.ts';

interface FakePeer extends Peer {
  sent: ServerMsg[];
  closed: number | null;
}

function peer(local: boolean): FakePeer {
  const p: FakePeer = {
    local,
    sent: [],
    closed: null,
    send: (msg) => p.sent.push(msg),
    close: (code) => (p.closed = code),
  };
  return p;
}

const camera = (id: string, name = 'Ana') =>
  ({ t: 'hello', role: 'camera', camera: { id, name, facing: 'environment' } }) as const;
const types = (p: FakePeer) => p.sent.map((m) => m.t);

describe('Hub', () => {
  let hub: Hub;
  beforeEach(() => (hub = new Hub()));

  it('rejects a director from the LAN listener', () => {
    const remote = peer(false);
    hub.receive(remote, { t: 'hello', role: 'director' });
    expect(remote.closed).toBe(CLOSE_FORBIDDEN);
  });

  it('introduces cameras and director in both join orders', () => {
    const cam = peer(false);
    hub.receive(cam, camera('a'));
    expect(types(cam)).toEqual([]);

    const director = peer(true);
    hub.receive(director, { t: 'hello', role: 'director' });
    expect(director.sent[0]).toEqual({
      t: 'cameras',
      list: [{ id: 'a', name: 'Ana', facing: 'environment' }],
    });
    expect(types(cam)).toEqual(['director-ready']);

    const late = peer(false);
    hub.receive(late, camera('b', 'Ben'));
    expect(types(director)).toContain('camera-joined');
    expect(types(late)).toEqual(['director-ready']);
  });

  it('routes signals between a camera and the director', () => {
    const director = peer(true);
    const cam = peer(false);
    hub.receive(director, { t: 'hello', role: 'director' });
    hub.receive(cam, camera('a'));

    hub.receive(cam, { t: 'signal', data: { sdp: { type: 'offer', sdp: 'x' } } });
    expect(director.sent.at(-1)).toEqual({
      t: 'signal',
      from: 'a',
      data: { sdp: { type: 'offer', sdp: 'x' } },
    });

    hub.receive(director, { t: 'signal', to: 'a', data: { sdp: { type: 'answer', sdp: 'y' } } });
    expect(cam.sent.at(-1)).toEqual({
      t: 'signal',
      from: 'director',
      data: { sdp: { type: 'answer', sdp: 'y' } },
    });
  });

  it('replaces a reconnecting camera without announcing it left', () => {
    const director = peer(true);
    hub.receive(director, { t: 'hello', role: 'director' });
    const first = peer(false);
    const second = peer(false);
    hub.receive(first, camera('a'));
    hub.receive(second, camera('a'));
    expect(first.closed).toBe(CLOSE_REPLACED);

    hub.disconnect(first);
    expect(types(director)).not.toContain('camera-left');
    expect(hub.cameraCount).toBe(1);
  });

  it('kicks a camera and ignores messages from non-directors', () => {
    const director = peer(true);
    const cam = peer(false);
    const other = peer(false);
    hub.receive(director, { t: 'hello', role: 'director' });
    hub.receive(cam, camera('a'));
    hub.receive(other, camera('b'));

    hub.receive(other, { t: 'kick', to: 'a' });
    expect(cam.closed).toBeNull();

    hub.receive(director, { t: 'kick', to: 'a' });
    expect(cam.closed).toBe(CLOSE_KICKED);
    expect(types(cam)).toContain('kicked');
    expect(director.sent.at(-1)).toEqual({ t: 'camera-left', id: 'a' });
  });

  it('renames a camera and sanitizes names', () => {
    const director = peer(true);
    const cam = peer(false);
    hub.receive(director, { t: 'hello', role: 'director' });
    hub.receive(cam, camera('a', '   '));
    expect(director.sent.at(-1)).toMatchObject({ camera: { name: 'Camera' } });

    hub.receive(director, { t: 'rename', to: 'a', name: 'Drummer cam' });
    expect(cam.sent.at(-1)).toEqual({ t: 'renamed', name: 'Drummer cam' });
  });

  it('tells cameras when the director leaves', () => {
    const director = peer(true);
    const cam = peer(false);
    hub.receive(director, { t: 'hello', role: 'director' });
    hub.receive(cam, camera('a'));
    hub.disconnect(director);
    expect(cam.sent.at(-1)).toEqual({ t: 'director-gone' });
  });
});
