# Commit to the Bit

**Plethora presents — a playground for game makers.**
An interactive presentation for a live 15-minute talk, built as an art-directed
website in React, Vite, Three.js, GSAP, SVG and Web Audio. It runs entirely
offline.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — for rehearsing and editing
```

For the talk itself, use the production build (faster, no dev tooling):

```bash
npm run build
npm run preview    # http://localhost:4173
```

Then press **F** for fullscreen. After `npm install`, nothing at runtime needs
the internet. Fonts are bundled from `@fontsource`, textures are generated in
the browser, and audio is synthesised.

## Presenter controls

| Key | Action |
| --- | --- |
| → / Space / Enter / PageDown | Next beat (then next screen) |
| ← / PageUp | Previous beat |
| R | Replay the current beat |
| F | Fullscreen |
| M | Mute |
| Home | Back to the opening |
| L | Toggle lite mode (low-performance fallback) |
| H or ? | Key help |

Nothing advances on its own. Each screen has a few beats, and every beat
settles into a stable composition you can talk over. The URL hash (for example
`#02.1`) records the current screen and beat, so a reload resumes in place.

Pointer interactions:

- **01**: click the wall to raise the challenge.
- **02**: drag any object; its threads stretch with it.
- **Challenge**: **T** start/pause, **S** new pair, **X** reset, **→** skip.
- **03**: pull back the seed and let go.

### Lite mode

Lite mode turns off the WebGL motes and the paint grain, and calms ambient
motion. It switches on automatically for software rendering, very low core
counts or `prefers-reduced-motion`. You can force it with `?lite` or force full
quality with `?full`.

## Running order

| # | Screen | Status |
| --- | --- | --- |
| — | Opening: Plethora presents Commit to the Bit | Built |
| 01 | Why play? (Bernard Suits) | Built |
| 02 | Connecting dots | Built |
| 02 · Challenge | Make the connection (45 s) | Built |
| 03 | The joy of trying again | Built |
| 04–10 | Chapter cards | Phases 3–5 |

## Structure

```
src/
  content/deck.js          all copy, kept separate from animation code
  scenes/                  one folder per screen (Opening, Scene01 …)
  systems/
    navigation/useBeats    beat engine: reversible, replayable timelines
    transitions/           iris · foliage · slit cover transitions
    environment/           foliage library, grain, parallax, Three.js motes
    typography/            split text, stage-space measurement
    audio/                 Web Audio synth (plucks, whoosh, thump)
    stage/                 fixed 1920×1080 canvas, letterboxed; perf detection
    video/                 VideoSlot with designed fallback (Slide 08)
  components/              the Bit, presenter chrome
public/assets/
  brand/                   plethora-wordmark.png, plethora-symbol.png
  games/                   flappy-bird.mp4, 2048.mp4, tetris.mp4, candy-crush.mp4
```

## Asset slots

- `public/assets/brand/plethora-wordmark.png`: supplied, used on the opening.
- `public/assets/brand/plethora-symbol.png`: supplied, reserved for the closing signature.
- `public/assets/games/*.mp4`: **not supplied yet.** Slide 08 shows a labelled
  placeholder at the correct aspect ratio until each file exists.
