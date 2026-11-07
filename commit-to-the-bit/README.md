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
the internet. Fonts (Big Shoulders Display, Instrument Sans, Fraunces, IBM Plex Mono) are bundled from `@fontsource`, textures are generated in
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

Per-screen interactions (all resettable):

| Screen | Interaction |
| --- | --- |
| 01 | Click the wall to raise the challenge |
| 02 | Drag any object; threads stretch with it |
| Challenge | **T** start/pause · **S** new pair · **X** reset · **→** skip |
| 03 | Pull back the seed and let go |
| 05 | Click words to rebuild the sentence; play in the dish · **X** reset |
| 06 | **1–8** or click to add/remove limits · **0** clear |
| 07 | **J** / ↑ / click to jump · **1–3** jump to a stage |
| 09 | Drag the Challenge and Skill sliders |

### Lite mode

Lite mode turns off the WebGL motes and the paint grain, and calms ambient
motion. It switches on automatically for software rendering, very low core
counts or `prefers-reduced-motion`. You can force it with `?lite` or force full
quality with `?full`.

## Running order

| # | Screen | Beats |
| --- | --- | --- |
| — | Opening — Plethora presents Commit to the Bit | 1 |
| 01 | Why play? (Bernard Suits) | 3 |
| 02 | Connecting dots | 3 |
| 02 · Challenge | Make the connection (45 s) | 1 |
| 03 | The joy of trying again | 3 |
| 04 | Two ways to build a game | 4 |
| 05 | Games have a grammar | 2 |
| 06 | A game needs limits (Three.js) | 2 |
| 07 | Same rules. New problems. | 3 |
| 08 | Three games. Three recipes. | 4 |
| 09 | Flow (WebGL shader field) | 3 |
| 10 | Connect. The. Dots. | 3 |

The final screen holds; → does nothing more and the presenter chrome is hidden.

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
  games/                   flappy-bird.mp4, 2048.mp4, tetris.mp4
```

## Asset slots

- `public/assets/brand/plethora-wordmark.png`: supplied, used on the opening.
- `public/assets/brand/plethora-symbol.png`: supplied, reserved for the closing signature.
- `public/assets/games/flappy-bird.mp4`, `tetris.mp4`: supplied (cropped from the phone recordings to 9:16).
- `public/assets/games/2048.mp4`: **not supplied yet.** Slide 08 shows a labelled
  placeholder at the correct aspect ratio until the file exists.
