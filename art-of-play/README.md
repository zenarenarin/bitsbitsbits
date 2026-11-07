# The Art of Play

A motion-led, presenter-controlled presentation in ten scenes about the principles of game design.
Built with React + Vite, Three.js, GSAP, SVG, CSS and the Web Audio API. Everything (fonts, textures, sound) is generated or bundled locally; nothing is fetched at presentation time.

**Status:** Scenes 01 and 02 are built (the prototype). Scenes 03–10 come next, on the same systems.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

For the show, use the production build served locally (works offline):

```bash
npm run build
npm run preview    # http://localhost:4173
```

## Presenter controls

| Key | Action |
|---|---|
| → / Space / PageDown | Next beat. Pressing during a beat completes it instantly. |
| ← / PageUp | Previous hold (instant). During a beat: abandon it and return to where it started. |
| R | Replay the current scene from its first hold |
| F | Fullscreen |
| M | Mute / unmute |
| H | Hide / show the scene indicator |
| D | Debug HUD: fps, frame time, scene, beat, timeline time, draw calls |
| Q | Toggle lower render resolution (0.7×) for weak hardware |
| 1–9, 0 | Jump to a scene (rehearsal and recovery) |

URL options: `?scene=2&beat=1` opens at a hold; `?q=low` starts in low-resolution mode.

There is no automatic advancement. Every beat ends on a stable hold the presenter can talk over indefinitely; ambient life (camera drift, chalk boil, sway) continues on its own clock without changing the composition.

## How it works

**Central idea: chalk becomes matter.** Three systems carry the story:

- **The Line** (`src/systems/chalk.js`): a chalk stroke rendered in WebGL as a camera-facing ribbon with width in world units, so it has real depth, thins with distance and can disappear *inside* the geometry it becomes. The chalk is all in the shader: drag streaks, dry broken edges, tooth grain, pressure variation and a warmer head. Draw-on, erase and boil are uniforms. Chalk dust is a pure function of draw progress. SVG chalk (`svgChalkPath`) is used for marks that belong to typography.
- **The Dot** (`src/systems/dot.js`): a glazed burnt-orange sphere with amber mottling, a satin clearcoat and one chalk band around its equator, so rolling is legible. Squash and stretch run along impact normals or travel direction through a hierarchy that never fights rotation. It has a contact shadow.
- **The Kit** (`src/systems/kit.js`): one family of bevelled geometry and a short material list (matte, chalky, soft ceramic, coloured translucent, metal detail). `growable()` patches any material so a mesh grows along its length with a glowing front: the moment a line becomes matter. It also includes a lighting rig.

Supporting systems:
- **Physics** (`physics.js`): deterministic. Motion is simulated once at scene build (fixed 1/240 s step: sphere vs boxes and planes with restitution, friction and rolling; and rail-following under gravity) and recorded. Timelines play the recording, so physical motion is seekable, reversible and identical every run.
- **Camera** (`camera.js`): tweenable state plus a procedural follow target blended by weight, and slow ambient drift.
- **Type** (`type.js`): masked-line blocks on a 1920×1080 grid, plus a small set of named behaviours (`rise`, `lift`, `settle`), per-character splitting and stage-space measurement for marks that attach to words.
- **Audio** (`audio.js`): fully procedural. Chalk grains, ceramic and wood impacts, bounces, clicks, assemblies, whooshes and swells, plus a breathing ambience per scene. No music. Sounds fire only on forward play and are suppressed when a beat is skipped.

**Engine** (`src/engine/Engine.js`): one persistent WebGL renderer. Each scene module returns `{ scene, camera, timeline, beats, exitLabel, ambience, update }`. The timeline's labels are the holds, and the engine moves between them. Each scene's exit beat carries the thread into the next scene, which plays its intro to its first hold. The next scene is built and its shaders compiled during idle time, so there's no loading pause between scenes. Film grain is one static tile moved by a compositor-only transform from the engine clock.

## Scenes

1. **What would you do?** A point in the dark becomes a line that wanders, loops and draws an open zig-zag in space. The camera finds the one viewpoint from which it closes: an impossible triangle. The line retracts into it as it becomes matter, and the Dot is born from its last curl, falls and bounces to rest. Only the floor's shadow shows the structure is open. The question and Bernard Suits follow. The line leaves into the distance until it is a single point.
2. **Connecting dots.** The point opens a deep-ocean space with five unrelated objects, each moving to its own rhythm. The line lassos them one by one, and each connection stills its own motion into one shared sway. The connections contract into a machine. The line becomes a dashed trajectory, the pendulum strikes, and the Dot runs ramp → loop → steps. The statement follows ("UNCONNECTED." pulls its letters together). The machine lets go.

## Tools

- `node tools/shoot.mjs <url> <outdir> <scene> <time|label>...`: frame-exact stills at timeline times or hold labels.
- `node tools/record.mjs <url> <outdir> <presses> [hold] [fps] [width]`: records the real experience as a presenter drives it (frame-stepped, deterministic).
- `node tools/navtest.mjs <url>`: drives real keyboard events and asserts every navigation control.
- `node tools/fps.mjs <url> [high|low] [width]`: measures real-time frame rate during holds and heavy beats. Set `GPU=1` to use the machine's GPU instead of software rendering.
