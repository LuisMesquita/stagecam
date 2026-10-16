# StageCam

Turn your friends' iPhones into live cameras and direct them onto a big screen, concert-style.
Everything runs on your Mac over your home Wi-Fi. No app to install, no internet needed.

- **Phones** open a web page in Safari and stream their camera over WebRTC.
- **The director** (Chrome on the Mac) shows every camera, lets you build the next shot on
  **Preview** with effects and layers, and sends it to **Program** with a cut or a transition.
- **The output window** goes fullscreen on the TV or projector connected over HDMI.

## Party-night runbook

1. **Wi-Fi.** Connect the Mac and the camera phones to your main Wi-Fi (5 GHz if you can).
   If there are many guests, send them to the router's guest network so the streams get the bandwidth.
   Don't put camera phones on the guest network: guest networks usually block devices from reaching each other.
2. **Start.** `nvm use && npm install` (first time only), then `npm start`.
3. **Director.** Open `http://localhost:4747` in Chrome on the Mac.
4. **Cameras.** Click **Add cameras (QR)**. Each friend scans the code, taps
   _Show Details › visit this website_ on the certificate warning (the certificate is self-signed),
   enters a name and taps **Start camera**. Phones should stay plugged into power banks.
5. **Output.** Connect the TV over HDMI, click **Open output window** (allow "window management" when
   Chrome asks, so the window opens on the TV), then click inside it to go fullscreen.

## Directing

| Key                  | Action                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `1`–`9`              | Put camera N on Preview (base layer)                                                            |
| `Space`              | Cut: swap Preview and Program                                                                   |
| `Enter`              | Auto: run the selected transition                                                               |
| `F1`–`F9`            | Put a scene slot live on Program right away, or click the slot (`fn` + F-key on a Mac keyboard) |
| `Option` + `F1`–`F9` | Load a slot into Preview for editing (or option-click it)                                       |
| `Shift` + `F1`–`F9`  | Save Preview to a slot (or shift-click a slot button)                                           |
| `L`                  | LIVE edit: the panel edits Program instead of Preview                                           |
| `B`                  | Beat cut on/off                                                                                 |

- **Layers:** each scene is a stack of layers. Each layer has a source, an effect chain, a blend mode
  and an opacity. Click **+ Add layer** to superimpose a second camera.
- **Output FX** apply on top of everything, on both Preview and Program.
- **Sliders:** double-click one to reset it.
- **Camera drops:** a camera that stops sending video freezes on its last frame. If _every_ camera
  on Program has been frozen for 2 s, the output crossfades to the scene you chose under
  _If a camera drops, go to_.
- **Sideways phone shows upright?** iOS sends portrait frames when the phone's orientation lock is on.
  Click ↻ on the camera's tile to rotate it. The director remembers the rotation per phone.
- **Phones:** a phone shows a red **ON AIR** frame while it is on Program and a green frame while it is on Preview.
- **Tiles:** double-click a tile's name to rename the camera. Use × to remove it.

## Music and beats

Pick an input in the top bar. The meters next to it show the five signals:
`bass`, `mid`, `high`, `level` and `beat` (a pulse on each kick drum).

- **Music playing on this Mac:** choose _Music playing on this Mac (tab or screen)_, then:
  - **YouTube or Spotify Web in a Chrome tab:** share that tab and tick **Also share tab audio**.
  - **The Spotify app or anything else:** share **Entire screen** and tick **Also share system audio** (macOS 14.2+).
  - The music keeps playing while it is captured. If you stop sharing, the audio input turns off.
- **Microphones** (built-in or a USB interface from the mixer) are listed with 🎤.
  The director remembers the last one you used.
- **Sensitivity:** use the small slider next to the picker. Turn it up if the meters barely move.
- **♪ links:** click ♪ next to any slider to make it follow a signal. _amount_ sets how far the music
  pushes the slider (negative pulls it down). The slider stays at its resting value, and the number
  shows the live value. Links are saved with scene slots.
- **Beat cut:** switches Program to the next camera with video every 1, 2, 4 or 8 beats.
  Layers and effects stay. Press `B` to turn it on and off.

## Camera health

- **Tiles:** each tile shows frame rate, bitrate and resolution. A yellow tile means the phone is
  struggling (below 20 fps or 0.6 Mb/s), often because it is hot or far from the router.
- **Phones:** each phone shows **☀ Screen stays on** when it can keep its screen awake, or
  **⚠ Keep the screen on** when it can't (older iOS or Low Power Mode).
- **Reconnects:** if a phone was locked or left Safari for a moment, it reconnects by itself as soon as
  the page is visible again.

## Adding an effect

Create one file in `web/src/effects/`. It's registered automatically and the panel builds its sliders from `params`:

```ts
import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'invert',
  name: 'Invert',
  params: [{ key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 }],
  glsl: `
vec4 effect(vec2 uv) {
  vec3 c = texture(u_input, uv).rgb;
  return vec4(mix(c, 1.0 - c, u_amount), 1.0);
}`,
} satisfies ShaderEffectDef;
```

- **What a shader can read:** `u_input`, `u_time` (seconds), `u_resolution`, one `u_<key>` per param,
  and the helpers `luma()`, `hash()` and `hsv2rgb()`.
- **Stateful effects:** use `kind: 'custom'` and keep your own GPU buffers (see `frame-delay.ts`).
- **Transitions:** these live in `web/src/transitions/`. They define `vec4 transition(vec2 uv)`
  and read `u_from`, `u_to` and `u_progress`.

## Development

Requires Node 24 (`.nvmrc`). The tooling is [Vite+](https://viteplus.dev) (`vp`).

| Command         | What it does                                                                     |
| --------------- | -------------------------------------------------------------------------------- |
| `npm run dev`   | Server with Vite middleware (reload the page to see changes)                     |
| `npm start`     | Production build + server                                                        |
| `npm run check` | Format check, lint, typecheck, unit tests                                        |
| `npm run e2e`   | Real Chrome with 2 fake cameras: connect, effects, transitions, tally, fail-safe |

### Ports and files

- **Director:** HTTP `localhost:4747` (IPv4 + IPv6 loopback; not 8080, which corporate security agents such as Cortex XDR intercept). It's reachable only from the Mac.
- **Cameras:** HTTPS `0.0.0.0:8443`.
- **Overrides:** set `DIRECTOR_PORT`, `CAMERA_PORT` or `STAGECAM_DATA`.
- **Certificate:** generated in `.certs/` and regenerated when the Mac's LAN IP changes.
- **Saved scenes:** `data/scenes.json`.
