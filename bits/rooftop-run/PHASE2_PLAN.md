# THE LAST SIGNAL — Phase 2 technical plan: the endless city

## What exists and what happens to it

| System | File | Verdict |
|---|---|---|
| Fixed 60 Hz sim, interpolation, lifecycle, Plethora wiring | `12_game` | **Reuse.** The run loop changes: no end screen at a relay; lives and game over are added |
| Shape world (boxes, gables, sheds, pipes incl. incline, sway/fall offsets) | `02_world` | **Reuse, extend.** Add removal for streaming (`remove(id)`, grid cleanup) |
| Cat controller (pace, slopes, balance, crawl, jump model, assists) | `04_cat` | **Reuse as is.** It is the movement simulation; animation stays separate |
| Hazards (steam, unstable walkways, bridges, fragments, waypoints, relay) | `05_hazards` | **Modify.** Hazards register and unregister per streamed section; relays become repeating milestones |
| Fixed slice | `03_slice` | **Becomes the first modules** of a library (roof cluster, ridge run, junction tank, catwalk run, relay terrace) |
| Scene builder (batching per material, decor, particles) | `10_scene` | **Split.** A per-section builder producing a disposable group, plus the global sky, light, tower and far city |
| Procedural cat rig | `08_catrig` | **Kept as a fallback only.** The final cat is the Blender GLB (Step 1); the rig interface stays the same |
| Camera, input, HUD, LAB panel | `09`, `06`, `11` | **Reuse.** The HUD gains lives, distance and score |
| Headless tests and route pilots | `dev/` | **Reuse.** Pilots move to per-module lines; a soak test runs the generator for thousands of metres |

## Step 1 — Blender asset pipeline (verified)

- **Blender:** Blender 5.2.3 runs headless here through the `bpy` module, so everything is a script in `blender/` that runs unchanged in desktop Blender (`blender -b -P script.py -- out.glb`).
- **Loading:** Plethora's library registry has no `GLTFLoader` (47 libraries; three is core only), and Bits cannot ship asset files (`maxAssets: 0`). So:
  - `07a_glb.js` reads binary glTF: accessors, node hierarchy, skinned meshes, simple PBR materials, and TRS animations. It produces native three.js `Bone`, `Skeleton`, `SkinnedMesh` and `AnimationClip` objects, so `AnimationMixer` handles playback and blending.
  - The GLB is embedded in `main.js` as base64 by `build.js`.
- **Test asset verified in the real runtime** (`dev/glb_test.js`, three 0.164.1):
  - The skin binds, and vertices deform under the bones.
  - Clips play, and a mid cross-fade sits at 0.5/0.5 weights.
  - Materials and emission come through; scale and Y-up orientation are correct.
  - Parsing takes about 5 ms.
- **The cat:**
  - Modelled with a Skin modifier over a feline vertex armature, subdivided, with separate ears, eyes, collar and core.
  - About 30 bones: spine chain, neck, head, ears, 6-bone tail, 4 three/four-bone legs.
  - Weights from Blender's automatic (heat) weighting; accessories pinned to head and neck.
  - Nine clips: Idle, Run, Sprint, Jump, Land, Balance, Crouch, Fall, Recover.
- **Animation driver (`08b_catanim`):**
  - **Grounded:** speed blends Idle → Run → Sprint, and speed also scales playback rate.
  - **Surface states** cross-fade: Balance on thin pipes, Crouch under low structures.
  - **Air:** the jump plays once and holds its airborne pose; after about 0.35 s of falling it becomes Fall.
  - **Landing and respawn:** Land is a one-shot on touchdown; Recover plays after a respawn.
  - **Kept procedural on top:** yaw toward velocity, lean into slopes and sway, and the core glow.
  - **No coupling back:** nothing in the animation touches the controller.

## Step 2 — seven lives and the continuous run

**What costs a life:**
- **Falls:** off a surface, through a gap, onto scenery, or with a walkway that gives way.
- **Lethal hazards:** steam bursts, and later moving machinery and electrified sections.

**Losing a life:**
1. The run continues with no end screen.
2. **Falls** respawn the cat at the last safe checkpoint: the last sound footing on a non-moving, non-collapsing surface, recorded every second of grounded play and validated (ground present, headroom, no hazard volume, not a bridge or unstable section).
3. **Hazard hits** don't move the cat: it is knocked back and keeps going.
4. Either way, **1.6 s of invulnerability** follows: the cat flickers, and hazards and falls cannot cost another life in that window.
5. A **life-loss latch** guarantees one incident costs exactly one life, even if a fall and a scald land on the same frame.

**Rules that hold for the whole run:**
- **Fragments** already collected are kept; the core never drains.
- **Distance** is the furthest point reached and never goes backwards.
- **Score** = distance (1 per m) + 50 per fragment + 250 per relay, and is never deducted on a life loss.
- **Relays** activated become checkpoints, and activating one restores a life, up to seven.

**Forgiving start:** the first 150 m use wide surfaces only, with slower steam and assistance at full strength.

**Game over** only at 0 lives: a result card shows distance, relays, fragments and score, with RUN AGAIN.

## Step 3 — the endless generator (next)

- **Sections:** the world is a chain of **sections**, each an instance of an authored **module**.
- **What a module declares:**
  - entry and exit contracts: surface height, x span, width class (wide, medium, narrow), and surface type;
  - its own length;
  - its region tags (Old Quarter, Pipeworks, Undercity, High Grid, Forgotten Works);
  - mechanic tags (gap, steam, balance, sway, crawl, unstable, branch);
  - a difficulty range, and a `build(rng, params, origin)` that returns shapes, hazards, fragments, decor and the exit contract.
- **Streaming:** sections are generated about 150 m ahead and disposed about 40 m behind, along with their shapes, hazards, batches and particles. The z origin is rebased every 1000 m to keep floating-point precision.
- **Joining:** consecutive modules must match contracts. Where they differ, a short authored **connector** (step-down, ramp, bridge stub, ladder pipe) is inserted, so no impossible combination can be produced.
- **Validation:** every generated join is checked by the same headless controller the tests use (reachability with the jump model, and timing windows at the current speed).

## Avoiding repetition

- **Short-term memory:** a rolling history of the last 8 modules, signatures and mechanic patterns.
  - **Hard rules:** no module twice within 4 sections; no identical mechanic sequence (for example gap→steam→gap) twice within 10.
  - **Soft rules:** weights decay for recent region, roof-silhouette class and width class.
- **Weighted, controlled randomness:** module weight = base × region affinity × difficulty fit × novelty × pacing. Pacing alternates tension and rest.
- **Variation inside modules is structural:** heights, roof pitch and orientation, widths, pipe radius and layout, gap lengths, hazard phases, and route side are all parameters.
- **Regions** drift through the city as long bands (200–400 m) with 40–80 m blended borders. Both modules and scenery draw from the neighbouring regions' sets, so transitions read as architecture changing, not a palette swap.
- **Landmarks** (a giant gasholder, a clock tower, a dead crane, a collapsed bridge) are placed at most once per region band, for spatial memory.

## Difficulty

- **A separate `Difficulty` manager** maps run distance (and recent failures) to independent parameters:
  - cruise speed (capped);
  - gap length and landing depth;
  - surface width;
  - hazard frequency and timing slack;
  - decisions per sequence;
  - mechanic combination limits;
  - fog density (visibility).
- **Bands:** EARLY, DEVELOPING, INTERMEDIATE, ADVANCED, EXPERT, MASTERY, each a block of thresholds in `01_tuning.js`.
- **Each mechanic carries an `introducedAt` distance.** Its first appearance uses the module's forgiving variant, and it can only be combined with others after it has appeared once alone.
- **Easing after failure:** losing two lives within 100 m eases the next sections by half a band.

## Steps 4–8

4. Module library: 20+ authored modules across the five regions.
5. Anti-repetition and combination rules.
6. Difficulty bands.
7. Designed encounters: machine wake, pipe-network steam sweep, collapse, building passage, hidden rooftop, high viewpoint, new relay revealed.
8. Performance pass on device: draw calls per section, the cat's skinning cost, and particle budgets.
