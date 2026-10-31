# THE LAST SIGNAL — revised Phase 1: vertical slice

A mobile-first 3D traversal Bit for Plethora (`plethora-bit@2`, three.js 0.164.1, SDK 1.7.0).

The city's rooftop signal network has gone dark. A small black stray carries a stolen power core on its collar toward the one relay still standing.

The core glows green and brightens with each energy fragment the cat picks up. Reaching the relay sends the signal across the sky to the great tower on the horizon. The tower stays in view for the whole run.

This is the **revised Phase 1**: the original movement lab's foundations, rebuilt into one compact, playable slice of the new world. It is not the endless city yet, and it is not Phase 2 polish.

## The slice

A run takes 18–20 s. The route branches, and the road you take decides your charge.

| Act | Structure | What it asks of you |
|---|---|---|
| 1 · Roofs | Terrace → tiled roof (up and over) → alley jump → ridge run → broken section | Slopes pull toward the eaves; uphill slows, downhill speeds; chimneys to go around; two jumps. **Fragment 1** low on the slope |
| 2 · Junction | The great pipe runs into a **junction tank**. A green lamp marks the high road, a violet one the low road | **Choose** |
| — high road | Thin pipe **climbing** 1.2 m → scaffold → swaying **rope bridge** → **leap** off the scaffold edge → long drop | Balance (careful pace, strong roll-off), the bridge carries you sideways, a leap of faith. **Fragments 2, 3, 4** |
| — centre | The wide pipe through **two steam vents** | Timing: hold back while they hiss, then go |
| — low road | Drop to a sunken catwalk → **crawl** under a duct → **hop** a pipe → climb a ramp | Safe and steady. No fragments |
| | All three merge on the machine platform | A dead relay wakes as you pass |
| 3 · Catwalk | A narrow suspended walkway: **1.9 m broken gap**, a squeeze, a section that gives way if you stall | **Fragment 5** hangs overhead: jump for it |
| 4 · Relay | Lean-to tin roof → 3 m drop → the relay terrace | Reach the relay: the signal climbs to the tower |

**Fragment counts by route:**
- **High road:** 5/5, the only full charge.
- **Centre:** 2/5. It's a test of timing.
- **Low road:** 2/5, the safe way.

**The broken signal line** is the environmental story. A dead cable sags from relay to relay along the whole route, and sparking snapped ends hang where each fragment fell. Three **waypoint relays** wake as the core passes, turning from red to green, and each cable segment lights up after them. The line visibly comes back to life on the way to the tower.

## Surfaces and how they move

| Surface | Response |
|---|---|
| Wide pipe | Full pace; the curvature rolls you outward gently and the cat steadies itself |
| Thin pipe (< 0.4 m) | **Balance**: pace capped at 3.6 m/s, stronger roll-off, reduced steering. The cat goes low with a narrow stance and the tail held out as a counterweight |
| Inclined pipe | Climbing costs speed; the camera follows the height |
| Tiled roof | Sideways slopes pull toward the eaves; the cat rolls with the pitch |
| Rope bridge | Sways about 0.14 m and **carries the cat sideways**; the cat leans against it and the tail swings |
| Narrow catwalk | Reduced steering, self-centring; broken gaps need a jump |
| Low structures | **Crawl** at 3 m/s, belly low, ears flat |
| Steam | A visible hiss and red lamp first, then a burst you cannot jump over: time it with the brake |
| Unstable walkway | Creaks, then drops if you stall on it |

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
node dev/test_move.js          # 26 slice checks through the real controller and hazards, all three routes
node dev/smoke.js <outdir>     # emulated phone, landscape + portrait: real touch input, autopilot to the relay, screenshots
node dev/clip.js <outdir>      # frame-exact gameplay recording (then ffmpeg)
node dev/closeup.js <outdir>   # close-up stills of the cat
```

**What `test_move.js` proves (26 checks):**
- **Act 1:** the roofs, the alley window (464 ms), slope drift and the broken section.
- **Junction:** a full-pace run onto the tank. On the centre pipe the cat stays on from an off-centre start, a blind run into steam scalds, and timing the steam works from 8 of 8 start phases.
- **High road:** the thin pipe is a balance surface (settled pace ≤ 3.6 m/s) that climbs 1.2 m. The bridge carries the cat 0.14 m sideways, yet an idle stick still crosses at every phase, while a committed push falls.
- **Low road:** the crawl runs at 3.0 m/s, the hop pipe blocks without a jump, and the ramp returns to the platform.
- **Act 3:** the catwalk gap needs a jump (330 ms window), the squeeze works, and the unstable section holds at pace but drops if you stop.
- **Final gap:** 313 ms window.
- **Full runs:** high road 5/5 in 18.6 s, centre 2/5 in 19.3 s, low road 2/5 in 18.2 s. All three wake every waypoint and reach the relay.

Draw calls: about 131 per frame including shadows (up from 105; the extra cost is the new structures and sprites). Static architecture is merged per material.

## Functional placeholders, and what is intended as final

- **Placeholder: the cat's geometry.** It is still procedural primitives, refined (a waist, shoulder blades, haunches, cheek ruffs, a 12-segment tail) and responding to each surface (balance stance, bridge lean, crawl, jump stretch and landing squash). A rigged character is Phase 2; the rig interface (`root`, `update`, `setShadows`, `dispose`) lets it drop in. **Plethora's library registry still has no glTF loader.** That is the blocker for an imported skinned cat (a model built in code or an inline GLB parser are the options).
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
