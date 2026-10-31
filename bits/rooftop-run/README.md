# ROOFTOP RUN — Phase 1: Movement Lab

A mobile-first 3D rooftop traversal Bit for Plethora (`plethora-bit@2`, three.js 0.164.1). A cat runs across weathered city rooftops. The player steers and jumps; everything else (ducking, steadying on a ledge, catching an edge it came up short of) is the cat's own competence.

This is **Phase 1 only**: one authored stretch of rooftops for judging whether the movement, camera and touch controls feel right. There is no endless generation, scoring or audio yet.

## Findings from the existing code

- **`plethora-threejs-audit.md` is not in this repository.** Everything below comes from reading the source of `bits/unmake` and `bits/neon-orbit-pinball`.
- **Plethora contract** (both bits use it the same way): `window.plethoraBit.init(ctx)`, three via `ctx.importModule('three', '0.164.1')`, `ctx.createCanvas/createRoot/listen/onResize/onDestroy/onFrame`, an optional `ctx.game.loop`, and `ctx.platform.ready/start/error/haptic/interact/milestone`. This is all Rooftop Run uses.
- **The score API conflicts, and neither version can be verified here.** UNMAKE calls `ctx.game.score().set(n)` and then `.submit('score', {label})`. Pinball calls `ctx.memory.record('score').submit(n, {label})`. **Rooftop Run does not submit scores, and its manifest declares no `memory` record.** This has to be resolved with the platform owners before Phase 5.
- **GLTF:** `libs.plethora.studio` serves `three/0.164.1/three.module.js` only. `GLTFLoader` returns 404 under `examples/jsm/…`, `addons/…` and the version root. A Bit is a single `main.js`, and no asset channel is declared anywhere. **Loading a skinned glTF cat is therefore unproven.** The cat is a procedural articulated rig behind a swappable interface (see below). Core three.js still includes `SkinnedMesh`, `Bone` and `AnimationMixer`, so a glTF path remains open if an asset channel is confirmed or a small GLB parser is inlined.

## What was reused, changed, rebuilt

| From UNMAKE | Here |
|---|---|
| `build.js` concat → single `main.js` | **Reused** as is |
| `00_util` math, rng | **Reused**, trimmed; added a damped `spring()` |
| Boot diagnostics, `ctx.game.loop` → `ctx.onFrame` fallback, fixed 60 Hz accumulator | **Reused**; added render interpolation (smooth on 90/120 Hz screens) |
| Pointer role map (one role per finger), floating stick | **Modified**: stick origin follows an overshooting thumb; the whole right part of the screen is the jump zone |
| Jump buffer, coyote time, variable height | **Kept the structure, retuned**: a tap gets a guaranteed minimum full-strength rise |
| `dev/index.html` runtime stand-in, headless tests | **Reused** the pattern |
| Capsule player, guided pace, OBB structural physics | **Rebuilt**: an axis-aligned box world and a long, low cat body (`02_world`, `04_cat`) |
| Third/first-person camera | **Rebuilt**: no first person, no orbit; reads the terrain ahead (`08_camera`) |
| Humanoid traveller rig | **Rebuilt**: procedural quadruped (`07_catrig`) |
| Static batching by material | **Rebuilt** as a box/quad batcher with world-space UVs (`06_assets`) |

## Source layout

Logic is kept separate from rendering. Files `00`–`04` have no three.js and no DOM, and run headless in Node.

| File | Role |
|---|---|
| `00_util.js` | Math, rng, springs |
| `01_tuning.js` | **Every gameplay number.** The in-game LAB panel edits these live |
| `02_world.js` | Collision world: AABBs, a z-grid, ground, ceiling, overlap and ray queries |
| `03_lab.js` | The Phase 1 course as pure data: boxes with a `kind`, decor, checkpoints |
| `04_cat.js` | Cat movement: run, steer, jump, land, duck, edge grip, assists |
| `05_input.js` | Touch, mouse and keys → `{steer, jumpPressed, jumpHeld}` |
| `06_assets.js` | Procedural textures, shared materials, static batcher |
| `07_catrig.js` | The visible cat (reads cat state, never writes it) |
| `08_camera.js` | Follow camera |
| `09_scene.js` | Architecture from the collision boxes, decor, backdrop, sky, light |
| `10_hud.js` | HUD, start and pause cards, LAB tuning panel |
| `11_game.js` | Lifecycle, loop, respawn, Plethora wiring, dev hooks |

**Swapping the character:** any rig that provides `{ root, update(dt, s), dispose() }` replaces `createCatRig`. `s` is built in `11_game.js` from controller state: speed, velocity, grounded, crouch, teeter, edge ahead, narrow, scramble progress, stumble, and that frame's events.

## The lab course

1. **Wide concrete roof.** Steer around a water-tank plinth and a stair room, under a laundry line.
2. **2.6 m gap**, slightly downhill.
3. **Low passage.** A pipe bundle between a stair room and a tank platform leaves 0.30 m of clearance. Steer into the opening and the cat flattens itself through. Alternatively, a held jump onto the tank platform is a second route.
4. **0.4 m ledge across a void**, entered through a gap in a parapet.
5. **Short roof**, then a **3 m gap with a 1.25 m drop** onto
6. **the landing terrace.** At the end the lab loops back to the start with a short fade, with no menu in between.

A fall fades out and respawns at the last checkpoint reached on solid footing.

## Controls and movement

| | Touch (landscape or portrait) | Keyboard / mouse |
|---|---|---|
| Steer | Drag anywhere on the left 55% (floating stick) | A/D or ←/→ (ramped, not digital) |
| Jump | Tap anywhere on the right 45%; hold to jump higher | Space / W / ↑ (hold for higher); right mouse button |
| Pause | ‖ button | Esc / P |
| Lab panel | LAB button | L or \` |
| Restart lab | Pause → Restart | R |

**Steering and jumping use separate pointers, so they work at the same time.**

### Movement behaviour

- **Running:** the cat accelerates from rest to 6.4 m/s in about 1 s, so the start has weight. It never stops on its own.
- **Steering:** lateral speed builds toward a target value, faster when reversing. On a surface narrower than 0.75 m, lateral speed drops to 55% and an idle stick lets the cat centre itself.
- **Jump:** fires on the press, with no animation delay, and adds a 0.9 m/s pounce. It uses a 140 ms input buffer, 110 ms coyote time, and falls 1.55× faster than it rises.
  - Hold mode: releasing early cuts the rise, but only after 130 ms of guaranteed full strength.
  - A tap travels 2.9 m (0.81 m rise). A hold travels 4.1 m (1.10 m rise).
- **Ducking is automatic:** the cat flattens under anything with 0.22–0.40 m of clearance. Jumping under the pipes bonks your head.
- **Stumble:** running nose-first into a wall costs most of your speed for about half a second.
- **Hard landing:** a fast landing briefly costs speed (weight and recovery). A soft landing keeps momentum.

### Assistance

Every assist can be turned off from the LAB panel.

- **Air nudge.** The cat predicts its own landing. If the arc would just miss a surface to the side (by up to 0.4 m), it twists toward it.
- **Ledge line-up.** Running at a narrow surface up to 0.45 m off its line eases the cat onto it. Steering clearly away overrides this.
- **Edge grip.** Steering off the side of any roof is resisted for 0.22 s, and a sideways drift never walks the cat off. A committed push still falls.
- **Scramble.** Coming up to 0.42 m short of an edge in front, the front paws hook the lip and the hind legs push the cat up, at a cost of 30% speed.

### Tap vs hold

Measured on the lab's gaps by `dev/test_move.js`. The window is the span of press times that still land, at cruise speed.

| Mode | Gap 1 (2.6 m) | Gap 2 (3 m, drop) | Notes |
|---|---|---|---|
| Hold mode, quick tap | 344 ms | 375 ms | |
| Hold mode, held | 492 ms | 508 ms | |
| Tap mode (always full) | 508 ms | 508 ms | Every jump is full height |

**Recommendation: hold mode.**
- A quick tap is already a fully useful jump with a window over 340 ms, so nobody has to learn to hold.
- Holding adds reach for long gaps and the tank-platform route.
- Tap-only is slightly more forgiving on gaps, but it removes short, controlled hops. Those matter for Phase 3's narrow landings and low ceilings.

The LAB panel switches between the two modes, so this can be judged on a device.

## Camera

- **Ground reference.** It rides a smoothed ground height, not the cat, and follows about a third of a jump arc. Jumps don't bob the frame, the view keeps looking down onto the landing, and a new roof height is picked up promptly.
- **Terrain ahead.** It probes the ground at 3, 6, 10 and 14 m and pitches toward drops before the cat reaches them. When a gap is coming it lifts and eases back slightly.
- **Lane framing.** It sits partly toward the middle of the surface underfoot, so the next route choice stays visible.
- **Obstruction.** It pulls in along the cat-to-camera line instead of clipping through walls. Thin overhead things (the pipe bundle) fade instead, and so does laundry the camera passes through.
- **Landing dip.** Landings give a small spring dip.
- **Orientation presets.** Landscape and portrait framing are separate, editable live:
  - Landscape: 1.75 m back, 0.86 m up, 52° FOV.
  - Portrait: 2.3 m back, 1.25 m up, 62° FOV.

## The cat rig

The rig is procedural and articulated:
- **Body:** a two-part spine that flexes with the gallop.
- **Legs:** two-bone IK. The hind legs have a hock. Paws are planted against the ground, so crouching, landing compression and edge-gathering bend the legs by themselves.
- **Head:** held level against the body's pitch. It looks ahead, turns into steering, and looks down at the landing while falling.
- **Ears and eyes:** ears flatten with speed and when ducking, with occasional twitches. The eyes blink.
- **Tail:** eight segments on springs. It streams back at speed, rises on ledges, swings for balance when teetering, and lags behind jumps and turns.

Its poses respond to what the body is doing:
- **Gathering:** lowers and looks down as an edge approaches.
- **Takeoff:** hind legs push off.
- **Rising:** front paws reach forward.
- **Falling:** front paws reach down to land.
- **Landing:** compresses with overshoot.
- **Scramble:** front paws hook the lip while the hind legs scrabble.
- **Stumble:** the body pitches forward.

## Performance

- **Draw calls:** about 42 per frame, shadows included. Each static material is one merged mesh.
- **Shadows:** one shadow-casting sun, with a 1024² map on phones (2048² otherwise) that follows the cat. A blob contact shadow sits straight under the cat to help judge landings.
- **Materials:** Lambert throughout.
- **Rendering:** pixel ratio is capped at 2 on phones (1.75 otherwise). The simulation is fixed-step and rendered with interpolation.
- **Lifecycle:** resize, `visibilitychange` and blur pause the game, and `onDestroy` disposes everything. WebGL context loss pauses the game, and restore re-flags textures for upload; this is best-effort and unverified on a device.

## Run locally

```sh
node build.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/three.module.js https://libs.plethora.studio/three/0.164.1/three.module.js
python3 -m http.server 8765        # from this folder
# open http://localhost:8765/dev/index.html (use device emulation for touch)
```

## Tests

```sh
node dev/test_move.js            # 19 movement checks on the real lab geometry, plus timing windows
node dev/smoke.js <outdir>       # emulated phone, landscape + portrait: real touch events, autopilot through the lab, screenshots
node dev/closeup.js <outdir>     # close-up stills of the cat in each movement state
```

## Known limitations

- The course is authored data. There is no module library, generation or validation yet (Phases 3–4).
- There are no unstable surfaces yet. They are not part of the Phase 1 list.
- The rig is procedural primitives, good enough to judge movement. It is the swappable part, and glTF is not yet proven on Plethora.
- No audio, no score, no game-over. Falls respawn.
- Performance numbers come from headless SwiftShader, so only draw calls and triangle counts are meaningful. Frame time is not.

## Still needs validation on a real mid-range Android phone

- **Frame rate:** frame time with shadows on and off (LAB → Shadows).
- **Touch controls:**
  - stick radius and curve on a real thumb;
  - whether the 45% jump zone is ever hit by accident while steering;
  - simultaneous steer and jump under real multi-touch.
- **Jump mode:** hold vs tap, in hand.
- **Camera:** distance and height in both orientations, and whether the cat is big enough on a small landscape phone.
- **Lifecycle:** behaviour inside the Plethora host:
  - `ctx.game.loop` vs `onFrame`;
  - safe areas;
  - backgrounding;
  - context loss and restore.
- **Haptics:** whether landing, bump and scramble haptics feel right or noisy.
