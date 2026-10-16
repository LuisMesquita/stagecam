import type { Facing, ServerMsg, SignalData, Tally } from '../shared/protocol.ts';
import { Signal } from '../shared/signal.ts';

const MAX_BITRATE = 3_000_000;
const STORAGE = { id: 'stagecam.camId', name: 'stagecam.name', facing: 'stagecam.facing' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setup = $('setup');
const live = $('live');
const nameInput = $<HTMLInputElement>('name');
const startButton = $<HTMLButtonElement>('start');
const setupError = $('setup-error');
const video = $<HTMLVideoElement>('preview');
const me = $('me');
const statusEl = $('status');
const awakeEl = $('awake');
const tallyEl = $('tally');
const overlay = $('overlay');
const facingButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-facing]')];

const camId = localStorage.getItem(STORAGE.id) ?? crypto.randomUUID();
localStorage.setItem(STORAGE.id, camId);

let name = localStorage.getItem(STORAGE.name) ?? '';
let facing: Facing = localStorage.getItem(STORAGE.facing) === 'user' ? 'user' : 'environment';
let stream: MediaStream | null = null;
let pc: RTCPeerConnection | null = null;
let sender: RTCRtpSender | null = null;
let pendingCandidates: RTCIceCandidateInit[] = [];
let directorPresent = false;
let wakeLock: WakeLockSentinel | null = null;
let hiddenAt = 0;
/** iOS suspends background pages; after this long the socket and camera are likely dead. */
const RESUME_AFTER_MS = 2000;

nameInput.value = name;
renderFacing();

facingButtons.forEach((button) =>
  button.addEventListener('click', () => {
    facing = button.dataset.facing === 'user' ? 'user' : 'environment';
    renderFacing();
  }),
);

startButton.addEventListener('click', async () => {
  name = nameInput.value.trim() || 'Camera';
  localStorage.setItem(STORAGE.name, name);
  localStorage.setItem(STORAGE.facing, facing);
  startButton.disabled = true;
  setupError.hidden = true;
  try {
    stream = await openCamera(facing);
  } catch (error) {
    startButton.disabled = false;
    setupError.hidden = false;
    setupError.textContent = cameraErrorText(error);
    return;
  }
  setup.hidden = true;
  live.hidden = false;
  me.textContent = name;
  showStream();
  void keepAwake();
  signal.connect();
});

$('flip').addEventListener('click', async () => {
  facing = facing === 'user' ? 'environment' : 'user';
  localStorage.setItem(STORAGE.facing, facing);
  await restartCamera();
  signal.send({ t: 'update', camera: { name, facing } });
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    // Wall clock: performance.now() can stand still while a locked iPhone sleeps.
    hiddenAt = Date.now();
    return;
  }
  if (!stream) return;
  void keepAwake();
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState === 'ended') await restartCamera();
  else if (track.muted) {
    // iOS unmutes an interrupted capture by itself shortly after the page is back; restart only if not.
    setTimeout(() => {
      if (track.muted && track.readyState === 'live' && stream?.getVideoTracks()[0] === track) {
        void restartCamera();
      }
    }, 1500);
  }
  if (Date.now() - hiddenAt > RESUME_AFTER_MS) {
    // Closing the socket drops messages queued while suspended ('kicked', 'renamed'): let them run first.
    setTimeout(() => {
      if (!stream) return;
      setStatus('Reconnecting to the Mac…');
      signal.reconnectNow();
    }, 300);
  }
});

const signal = new Signal({
  hello: () => ({ t: 'hello', role: 'camera', camera: { id: camId, name, facing } }),
  onMessage: handleMessage,
  onStatus: (connected) => {
    if (connected) return setStatus('Waiting for the director…');
    directorPresent = false;
    setStatus('Reconnecting to the Mac…');
  },
});

function handleMessage(msg: ServerMsg) {
  switch (msg.t) {
    case 'director-ready':
      directorPresent = true;
      void startPeer();
      break;
    case 'director-gone':
      directorPresent = false;
      closePeer();
      setTally('off');
      setStatus('Waiting for the director…');
      break;
    case 'signal':
      void onSignal(msg.data);
      break;
    case 'tally':
      setTally(msg.state);
      break;
    case 'renamed':
      name = msg.name;
      localStorage.setItem(STORAGE.name, name);
      me.textContent = name;
      break;
    case 'kicked':
      signal.stop();
      closePeer();
      stream?.getTracks().forEach((track) => track.stop());
      // No stream: coming back from the background must not reopen the camera or hide this message.
      stream = null;
      showOverlay('The director removed this camera. Reload the page to join again.');
      break;
    case 'error':
      showOverlay(msg.message);
      break;
  }
}

async function startPeer() {
  if (!stream) return;
  closePeer();
  const connection = new RTCPeerConnection({ iceServers: [] });
  pc = connection;
  pendingCandidates = [];
  const track = stream.getVideoTracks()[0];
  sender = connection.addTrack(track, stream);
  connection.onicecandidate = (event) => {
    if (event.candidate)
      signal.send({ t: 'signal', data: { candidate: event.candidate.toJSON() } });
  };
  connection.onconnectionstatechange = () => {
    if (pc !== connection) return;
    const state = connection.connectionState;
    setStatus(
      state === 'connected'
        ? 'Live link OK'
        : state === 'failed'
          ? 'Link failed, retrying…'
          : 'Connecting…',
    );
    if (state === 'failed' && directorPresent)
      setTimeout(() => pc === connection && startPeer(), 2000);
  };
  setStatus('Connecting…');
  await connection.setLocalDescription(await connection.createOffer());
  signal.send({ t: 'signal', data: { sdp: connection.localDescription!.toJSON() } });
}

async function onSignal(data: SignalData) {
  const connection = pc;
  if (!connection) return;
  if ('sdp' in data) {
    await connection.setRemoteDescription(data.sdp);
    for (const candidate of pendingCandidates) await connection.addIceCandidate(candidate);
    pendingCandidates = [];
    await limitBitrate();
  } else if (connection.remoteDescription) {
    await connection.addIceCandidate(data.candidate);
  } else {
    pendingCandidates.push(data.candidate);
  }
}

async function limitBitrate() {
  if (!sender) return;
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = MAX_BITRATE;
  params.encodings[0].maxFramerate = 30;
  await sender.setParameters(params).catch(() => {});
}

function closePeer() {
  pc?.close();
  pc = null;
  sender = null;
}

async function openCamera(mode: Facing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: mode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
}

async function restartCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  try {
    stream = await openCamera(facing);
  } catch (error) {
    showOverlay(cameraErrorText(error));
    return;
  }
  overlay.hidden = true;
  showStream();
  const track = stream.getVideoTracks()[0];
  if (sender) await sender.replaceTrack(track);
}

function showStream() {
  if (!stream) return;
  video.srcObject = stream;
  video.classList.toggle('mirror', facing === 'user');
  stream.getVideoTracks()[0].onended = () => {
    if (document.visibilityState === 'visible') void restartCamera();
  };
}

async function keepAwake() {
  try {
    if (!wakeLock || wakeLock.released) {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
      wakeLock?.addEventListener('release', renderAwake);
    }
  } catch {
    // Unsupported (before iOS 16.4) or refused (e.g. Low Power Mode): the pill tells the user.
    wakeLock = null;
  }
  renderAwake();
}

function renderAwake() {
  const held = !!wakeLock && !wakeLock.released;
  awakeEl.hidden = false;
  awakeEl.classList.toggle('warn', !held);
  awakeEl.textContent = held ? '☀ Screen stays on' : '⚠ Keep the screen on';
}

function setTally(state: Tally) {
  live.dataset.tally = state;
  tallyEl.hidden = state === 'off';
  tallyEl.textContent = state === 'program' ? 'ON AIR' : 'PREVIEW';
}

function setStatus(text: string) {
  statusEl.textContent = text;
}

function showOverlay(text: string) {
  overlay.hidden = false;
  overlay.textContent = text;
}

function renderFacing() {
  facingButtons.forEach((button) =>
    button.setAttribute('aria-pressed', String(button.dataset.facing === facing)),
  );
}

function cameraErrorText(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError')
    return 'Camera access was blocked. Allow it in Settings › Safari › Camera and reload.';
  if (!window.isSecureContext) return 'Open the https:// link from the QR code, not http://.';
  return `Could not open the camera (${name || String(error)}).`;
}
