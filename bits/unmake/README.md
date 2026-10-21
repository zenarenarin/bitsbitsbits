# UNMAKE 2.0

A 3D traversal arcade Bit for Plethora (`plethora-bit@2`, three.js 0.164.1). A city built around a living root system spent generations holding itself still. You run through it, and with a key you can unmake what the preservers added: a glazed wall, a section of glazed floor, a prop, a copper cable or pin. Collision goes with it, everything it held responds, and you move through the changed geometry.

**The rule players learn:** anything clad in the cool square glaze with oxidised-copper edges, or made of copper, can be unmade. Settlement stone, roots and the old city cannot. There is no meter and no cooldown. Each stretch of the city allows as many unmakings as its biggest solution needs, and the allowance refills at the next stretch, so there is never any waiting. Once a stretch is spent, its remaining glaze and copper dull to grey and can't be targeted. The cap was added because `dev/erase_all.js` showed that erasing everything eligible still crossed every family on every seed. It can be turned off in Settings (*Free unmaking*).

## Controls

| | Keyboard and mouse | Touch |
|---|---|---|
| Steer | A/D or ←/→ | Drag a floating stick, anywhere in the lower left |
| Pace (sprint / brake) | W/↑ and S/↓ | The same stick, pushed up or down |
| Jump | Space (hold for a higher jump) | JUMP button |
| Unmake | Hover to preview, click to unmake. E unmakes the focused element | Touch to preview, release to unmake, slide off to cancel |
| First / third person | V | eye button |
| Look (first person) | Drag the mouse | Drag on the right side |
| Pause and settings | Esc or P | pause button |

## The language of unmaking

- **Eligible**: cool, regular glaze with copper edge trim, or copper restraints.
- **Preview** (hover, touch-and-hold, or the first-person crosshair):
  - The exact region that will go gets a chalk outline and a moving demolition hatch.
  - Everything that will move because of it gets an ink outline.
  - Where each of those things will come to rest gets a second ink outline, drawn through geometry.
- **Unmaking**: the body is erased outward from the point you touched. The erasing front carries a thin chalk rim, with no debris, glitch or particles. A chalk plan of what was there lingers for a second. Collision is removed on the same frame.
- Breaking by force, as when a pendulum hits a wall, still makes rubble. Unmaking is quiet and clean.

## Systems

- **Structural physics** (`src/01_phys.js`): oriented-box bodies.
  - **Static** bodies don't move.
  - **Hinges** are moved by real torque from their own weight, resting loads and the traveller's weight.
  - **Suspended platforms** swing from whichever cable survives.
  - **Free loads** fall, land and ride whatever they land on.
  - **Pendulums** can be driven, latched or free, and fly off when their rod is cut.
  - **Kinematic** lifts, floats and collapses follow scripted motion.
  - Connections (cables, pins, chains) and bodies marked `erase` are what you unmake.
  - `Phys.erase` takes out an erase group (for example, a scaffold of four props) and releases anything it held. `holdsAny` means a body falls when any one of its supports goes.
  - `Phys.dependents` and `Phys.predictRest` drive the consequence preview.
  - Chain reactions are tracked with causal tags. Three useful consequences from one act scores a chain.
- **Traveller** (`src/02_player.js`): a capsule controller.
  - Guided auto-run with sprint and brake, weighted steering.
  - Coyote time, jump buffering and variable jump height.
  - Slope snapping, being carried by moving and rotating structures, side-ledge protection, knockback and crushing.
  - Recovery points are never recorded on erasable ground.
- **Encounters** (`src/03_course.js`): ten authored families, each with at least two viable approaches.
  - **Threshold** is the playable slice and first lesson. It recurs procedurally with varied dimensions.
    - Decision 1: unmake the glazed wall to keep the high road, or unmake the glazed floor to drop into the old street, where a relic is.
    - Decision 2, on the high road: unmake the props so the lintel drops into a bridge, or sprint-leap the gap. The leap counts as a movement-only crossing.
    - A missed leap lands in the old street, which ramps back up. A fall costs time, not the run.
    - Unmaking the props while standing under the lintel crushes you. The preview shows where the lintel will land.
  - **Shutters**: glazed walls on a causeway, to be erased at speed. A settlement-stone wall between them can't be erased, so you go round it on the side beam. The last shutter stands at the lip of a gap, so erase it early and keep your run-up.
  - Drawbridge, counterpoise, cradle, root, pendulum, collapse (glazed wall on the high road), sluice (glazed gate), lift, plus terrace approaches as breathers.
  - Every generated segment is validated: each solution's physics is settled, then the walkable surfaces must connect within the traveller's jump.
- **Rendering**: procedural textures, materials and sky (`04_assets`), authored views and a jointed traveller rig (`05_views`), and the streamed basin and sanctuary (`06_world`).
  - Occlusion dithering keeps the traveller visible behind architecture.
- **Game** (`08_game.js`): input, targeting and preview, unmaking, adaptive camera (third and first person), fall recovery, the Stillness, scoring, sanctuary restoration and settings.
  - Fall recovery: the city sets you back on the last sound footing, and the Stillness gains 3 m on you; it never leaves you more than 14 m ahead after a catch. If it would be closer than 2.5 m, nothing catches you.
- **Performance**:
  - Each segment's settlement stone is baked into one mesh per material.
  - A body's other parts are merged by material. This halves draw calls, to about 270–360 per frame including shadows.
  - Simulation costs about 0.04 ms per step on the dev machine.
- **HUD**:
  - Top left: distance (DM Serif Display, 32 px), the Stillness as a hairline that fills from the right, and the score (11 px tracked label).
  - Top right: view and pause icons.
  - Bottom right: the jump chevron.
  - Layout uses a 16 px gutter and 8 px rhythm. There are no badges and no captions; on the first run a ghost of the steering stick appears once.

## Run locally

```sh
node build.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/three.module.js https://libs.plethora.studio/three/0.164.1/three.module.js
python3 -m http.server 8765        # from this folder
# then open http://localhost:8765/dev/index.html
```

## Tests

```sh
node dev/test_move.js        # movement model (9 checks)
node dev/validate.js         # every family, every solution, across seeds and difficulty
node dev/skill_routes.js     # skill routes driven by the real controller along waypoints
node dev/slice.js            # threshold and shutters, driven by the real controller: every route, walls really block, crush, low-road recovery (40 checks)
node dev/erase_all.js        # does erasing everything eligible still cross each family? (it did: that is why there is a per-stretch allowance)
node dev/simcost.js          # CPU cost of one simulation step
node dev/touch.js <outdir>   # emulated phone, real touch events: stick, hold to preview, slide off to cancel, release to unmake, jump
node dev/slice_shots.js <outdir> [wall|floor|leap] [third|first]   # screenshots of the slice's beats
node dev/bot.js <outdir> [secs] [0|1] [third|first]   # live playtest bot in headless Chromium
```
