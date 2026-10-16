# Changelog

All notable changes to StageCam are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

## [0.2.0] - 2026-10-16

### Added

- Halloween effects: blood moon, VHS horror tape, possessed and old horror film.
- Auto director: picks cameras, looks and transitions, paced by the music's energy, with a
  Halloween style.
- `npm run gallery` renders every effect on a test portrait.

## [0.1.0] - 2026-10-16

First release: a live multi-iPhone camera switcher for a party, LAN only.

### Added

- Camera page for iPhone Safari: name, front/back camera, ON AIR / PREVIEW tally, rotate hint,
  screen wake lock with an indicator, and automatic reconnect after the page was in the background.
- Director in Chrome on the Mac: camera tiles, Preview and Program monitors, CUT and AUTO with
  crossfade, wipe and glitch transitions, and an output window for the HDMI screen.
- Scenes as layer stacks: each layer has a source, an effect chain, a blend mode and an opacity.
  Output FX apply on top. 9 scene slots, saved on the server.
- Effects: over-saturation, color tint, duotone, B&W high contrast, RGB split/glitch, mirror,
  kaleidoscope, frame delay/echo. A new effect or transition is one file.
- Per-camera rotation, a fail-safe to a safe scene when every camera on Program stops sending
  video, and link stats (fps, bitrate, resolution) on each tile.
- Audio-reactive effects from a microphone or from music playing on the Mac: bass, mid, high,
  level and beat signals, ♪ links on every slider, and a beat cut mode.
- Node 24 server: a loopback-only director listener (port 4747), an HTTPS camera listener
  (port 8443, self-signed certificate) and WebSocket signaling.
- Vite+ toolchain, unit tests and a Chrome end-to-end test with fake cameras and a fake microphone.

[Unreleased]: https://github.com/LuisMesquita/stagecam/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/LuisMesquita/stagecam/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LuisMesquita/stagecam/releases/tag/v0.1.0
