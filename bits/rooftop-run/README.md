# THE LAST SIGNAL — revised Phase 1: vertical slice

A mobile-first 3D traversal Bit for Plethora (`plethora-bit@2`, three.js 0.164.1, SDK 1.7.0).

The city's rooftop signal network has gone dark. A small black stray carries a stolen power core on its collar toward the one relay still standing.

The core glows green and brightens with each energy fragment the cat picks up. Reaching the relay sends the signal across the sky to the great tower on the horizon. The tower stays in view for the whole run.

This is the **revised Phase 1**: the original movement lab's foundations, rebuilt into one compact, playable slice of the new world. It is not the endless city yet, and it is not Phase 2 polish.

## The slice

A full run takes about 17–25 s.

| | Structure | What it asks of you |
|---|---|---|
| A | Terrace (start) | Nothing yet: the cat gathers speed |
| B | Tiled roof, ridge across the route | Run up and over. Uphill costs speed, downhill gives it back. Chimneys stand on the ridge |
| — | Alley (1.4 m) | Jump from the eave onto the next ridge |
| C | Long roof, ridge along the route | The slopes pull you toward the eaves. Steer around a chimney onto the slope and back. **Fragment 1** sits low on the slope past the chimney |
| — | Broken roof section (1.8 m) | Jump it, or fall through |
| D | The great pipe | Pipe curvature rolls you outward. **Two steam vents**: hold back while they hiss, then go |
| — | Junction (valve platform) | Route choice: stay on the great pipe through the steam, or drop left onto the narrow pipe |
| D′ | The narrow pipe | No steam, but precision balance. **Fragment 2** |
| E–F | Junction platform → suspended catwalk | **Squeeze** under a low pipe. An **unstable section** creaks and drops if you stall. **Fragment 3** hangs above the walkway: jump for it |
| G | Lean-to tin roof | A downhill run-up |
| — | Gap (3 m, 1.5 m drop) | The last jump |
| H | Relay terrace | Reach the relay: the signal climbs to the tower, then the result |

The fragments sit on the harder lines: the low slope, the narrow pipe, and the jump above the catwalk. They charge the collar core, shown as three diamonds in the HUD.

The result card shows fragments and time and offers to run again. A full charge in a new best time is called out.

## Controls

Two inputs, with contextual behaviour for everything else.

| | Touch | Keyboard |
|---|---|---|
| Steer | Drag on the left 55% of the screen (floating stick) | A/D, ←/→ |
| Pace | The same stick: push forward to hurry, pull back to slow and wait (full back = stop) | W/↑ hurry, S/↓ wait |
| Jump | Tap the right 45% of the screen; hold to jump higher | Space (hold for higher) |
| Pause / lab panel / restart | ‖ and LAB buttons | Esc or P / L / R |

The cat still runs by itself. Pace has a dead zone of about a third of the stick's travel, so steering never brakes by accident.

The cat handles these on its own:
- ducking under low structures;
- steadying itself on pipes and ledges;
- leaning into roof slopes;
- lining up with a narrow surface;
- catching an edge it came up just short of.

## What made Phase 1 feel generic, and what changed

| Then | Now |
|---|---|
| Every surface was a flat axis-aligned box | The world has **shapes with height functions**: pitched roofs (ridge along or across the route), lean-to roofs, cylindrical pipes. Slopes and curvature are collision, not decoration |
| Empty pale concrete, one material language, flat golden light | Terracotta, weathered plaster with lit and dark windows, oxidised pipes, catwalk grating, brick and rusted tin, under a dusk haze with selective green and violet industrial light |
| Two verbs: steer and jump | **Pace control**, **slope physics**, **pipe balance**, **timed steam**, **collapsing catwalks**, **squeezing**, plus jumping and route choice |
| No purpose | **The core, the fragments, the relay, the tower** |
| A small brown cat | A **black cat** with lit eyes, a rim light, the glowing collar core, and new poses (see below) |

## Systems: preserved, modified, new

| Preserved | Modified | New |
|---|---|---|
| Fixed 60 Hz simulation with render interpolation | `02_world`: shape functions for ground, ceiling, solids and camera rays | `05_hazards`: steam cycles, unstable walkways, fragments, relay. Pure simulation, testable headless |
| Jump model: buffer, coyote time, variable height, scramble, edge grip | `04_cat`: pace, slope pull and climb drag, pipe roll-off, leading-edge blocking on slopes, riding a falling walkway, scalding | `03_slice`: authored slice plus a seeded neighbourhood and far layers |
| Pointer-role input, keyboard ramping | `06_input`: pace axis | `10_scene`: rebuilt city (see below) |
| Batcher, disposal, lifecycle, Plethora wiring, LAB panel | `08_catrig`: black cat, collar core, pipe, slope, waiting and flinch poses | Result flow, finale camera |
| Headless and browser test harness | `09_camera`: shape-aware occlusion, anticipatory fades, finale framing | `dev/pilot.js`, `dev/clip.js` |

**What the rebuilt city in `10_scene` contains:**
- tiled roofs with ridge caps and gable ends;
- plaster blocks with an emissive window map;
- pipes with flanges and supports;
- catwalks on hangers;
- steam particles in a custom shader;
- turning fans and smoke stacks;
- the relay and its signal beam;
- the lattice tower and its beacon;
- a dusk sky with exponential haze.

Every gameplay number is in `01_tuning.js`, including the new steam timings, pace and slope settings. The LAB panel edits them live.

## Tests

```sh
node build.js
node dev/test_move.js          # 23 slice checks through the real controller and hazards
node dev/smoke.js <outdir>     # emulated phone, landscape + portrait: real touch input, autopilot to the relay, screenshots
node dev/clip.js <outdir>      # frame-exact gameplay recording (then ffmpeg)
node dev/closeup.js <outdir>   # close-up stills of the cat
```

**What `test_move.js` proves:**
- **Roofs:** you can climb over the first one (slower uphill than down). An idle stick drifts toward the eave but never off the roof. Chimneys bump you, and you can steer around them.
- **Gaps:** the alley jump window is 464 ms (tap). The broken roof and the alley both need a jump.
- **Pipes:** you can run onto the great pipe and along it with the stick idle. A committed push falls. A 120 ms flick doesn't throw you off the narrow pipe.
- **Steam:** running blind into a burst scalds you. Timing the vents with the brake gets through cleanly from 8 of 8 start phases.
- **Route choice:** the junction leads onto the narrow pipe.
- **Catwalk:** the squeeze works. The unstable section holds at pace and drops if you stop. The overhead fragment needs a jump.
- **Last jump:** the final gap window is 313 ms.
- **Full run:** a full run with all three fragments reaches the relay in 17 s.

Draw calls: about 105 per frame including shadows. Static architecture is merged per material.

## Functional placeholders, and what is intended as final

- **Placeholder: the cat's geometry.** It is still procedural primitives, though articulated, rim-lit, and responding to pipes, slopes, steam and waiting. A rigged character is Phase 2; the rig interface (`root`, `update`, `setShadows`, `dispose`) lets it drop in. **Plethora's library registry still has no glTF loader.** That is the blocker for an imported skinned cat (a model built in code or an inline GLB parser are the options).
- **Placeholder: the art pass.** Procedural textures are the right materials but at prototype density. There's no ambient occlusion and no baked lighting.
- **Placeholder: the remaining hazards.** Fans are scenery, not hazards. There are no electrified sections or falling debris yet.
- **Placeholder: audio.** There is none. Phase 5 adds the hiss, creak, collect and relay sounds and a score.
- **No leaderboard yet.** It's planned with `ctx.game.score` and a `memory.records` best-time board.
- **Intended as final structure:** the shape world, the hazard model, pace control, the slice layout as a module template, and the camera behaviour.

## Needs testing on a real phone

- **Frame rate:** test on a mid-range Android phone (shadows and steam particles are the costs to watch). The LAB panel can turn shadows off.
- **Pace on the stick:** whether braking by pulling the stick back is natural, and whether its dead zone is right for real thumbs.
- **Readability:** whether the steam warning reads from a distance, and whether the black cat reads on dark pipes at phone brightness.
- **Narrow pipe:** whether it feels like a fair challenge, not a punishment.
- **Plethora host:** behaviour inside the host (full-screen safe areas, the logo button, backgrounding), as before.
