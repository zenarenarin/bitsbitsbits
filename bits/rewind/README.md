# REWIND

*The world moves through time. You move through the world.*

A three-quarter-view arcade run across a monumental city of clockwork stone, built as a
Plethora Bit (`plethora-bit@2`, three.js 0.164.1). The world's history is yours to scrub
forward and back; your own body is not. You keep steering while bridges fall upward into
place, ferries return along their tracks and great rings turn back into alignment.

## Controls (REWIND 2.0)

Time **always flows** during play. You bend it; only the pause menu stops it.

| | Keyboard | Touch |
|---|---|---|
| Move (camera-relative, analog) | **WASD** / **arrows** (diagonals normalised) | drag anywhere on the left half: a floating stick |
| Rewind time | hold **Space** (or **K**) | hold **◀◀** (large, bottom right) |
| Hurry time | hold **Shift** (or **L**) | hold **▶▶** (beside it; slide between the two) |
| Pause | **Esc** / **P** | ❚❚ button |
| Mute | **M** | speaker button |

Movement and time are independent: you can walk, stop, back up and turn while time runs
forward, backward or fast. Sideways and backward steps stop at ledges; only a committed run
straight off the end of a walkway carries you over. A push within ~20° of the course goes
straight along it (gentle path assist).

## Run it locally

```sh
npx http-server -p 8123 -c-1 bits/rewind
# open http://localhost:8123/dev/index.html          (fills the window)
# or   http://localhost:8123/dev/index.html?w=390&h=844   (phone-sized stage)
```

`dev/harness.js` is a small local stand-in for the Plethora runtime: just the parts of
`ctx` that REWIND uses. three.js and the fonts load from the Plethora library registry
(`libs.plethora.studio`). In Plethora itself only `main.js` and `plethora.json` ship.

### Automated play-tests

```sh
NODE_PATH=$(npm root -g) node bits/rewind/dev/playtest.cjs <scenario> [outDir]
```

| Scenario | What it checks |
|---|---|
| `smoke` | boots, title, start, time flowing (screenshots) |
| `rules` | world state identical in forward/backward/random T order; same seed → same course; opening identical across seeds; validator over 120 seeds; shards and distance can't be farmed by oscillating time; beginning of history; steering while reversing; restart reset; draw calls |
| `autopilot` | a bot that plays with the same four inputs a player has, using element time windows. `SEEDS=1,2,3 STEPS=42000 MANUAL=1` |
| `pointers` | each finger owns one role: lifting one never releases another |
| `ui` | touch start, two-finger play, blur → pause, death → results → restart (`TOUCH=1`) |
| `tour`, `rewindSeq` | screenshots of every opening encounter and of a bridge rebuilding |

Set `MANUAL=1` for scenarios that drive the fixed-step simulation directly, and
`VENDOR=<dir>` to serve registry files from a local mirror.

## How it works

Everything is in `main.js`, in numbered sections:

1. **Constants and math**: deterministic RNG and easing.
2. **Temporal clock**: world time `T` is the only world state. Rate is +1 (advance),
   −1.5 (reverse) or 0. `T` stops at 0, the beginning of recorded history.
3. **Visual kit**: procedural limestone textures, materials, static geometry baking,
   rigid-mesh merging. Every material dithers away where it stands between the camera and
   the player. Decorative architecture also keeps the route ahead visible. Depth fog sinks
   the abyss into blue-grey.
4. **Elements**: `Span` (voussoir bridge that assembles from the abyss and/or collapses in
   a cascade, with optional safety latch), `Ferry` (barge on a timetable, escapement rails),
   `Ring` (orrery ring whose decks form the path at the bottom of the turn), `FoldStair`
   (steps slide out of a terrace wall), `Gate` (escapement door with a dial), `Gnomon`
   (sundial blade sweeping at body height), `Shard` (Echo Shard reward). Each element's
   `render(T)` and `colliders(T)` read the same pure state function, so what you see is
   exactly what you can stand on, in both directions of time.
5. **Encounters**: a fixed six-part opening (promenade with light well and gate → first
   bridge → first ferry → route choice → combined challenge), then nine endless templates
   chosen by a seeded generator with difficulty gating. A validator rejects any encounter
   with a gap in its route, an element that never opens, an un-outrunnable chase or a
   too-steep stair. Each segment's timetable is anchored to the world time when it is
   generated (~20 s ahead, in the fog), so earlier rewinds never pile up into long waits.
6. **Course**: lazy segment building ahead, disposal behind, collider queries.
7. **Player**: independent 120 Hz physics. It is never rewound and never immune. Rising
   surfaces catch and lift the player; vanished ones leave them falling; barriers push
   back toward the side the player came from; decks carry riders; riders never inherit
   upward velocity. Falling 19 units below the last ground is unrecoverable.
8. **Character rig**: procedural run/brake/turn/fall/land animation, with a chest charm
   that glows amber, cyan or pale for advance, reverse or still.
9. **Camera and atmosphere**: fixed three-quarter follow camera (framing adapts from phone
   portrait to landscape), sky, fog, analytic dust and motes that move in world time.
10. **Audio**: procedural WebAudio. Clock ticks follow world time (tick forward, a
    swelled "tock" in reverse, silence when still), plus stone, ferry, gate and shard cues.
11. **Input**: keyboard plus per-finger touch roles.
12. **HUD**: score, distance, streak pips, the time ribbon (world-time ticks plus the next
    element's open windows), contextual first-run hints, title, pause and results screens.
13. **Run**: rewards and failure. Shards and bonuses have stable ids and pay once per run.
    Distance counts only the forward frontier.

### Scoring

- 10 points per metre of forward frontier (walking back or bending time never adds distance).
- Echo Shards: 100, +20 per shard in a quick chain. Some exist only while their structure stands.
- **Perfect reversal** (250): a crossing that was shut when you approached, crossed by rewinding.
- **Ahead of time** (180): a crossing not yet open when you approached, crossed by hurrying.
- **Clean crossing** (60), *Knife-edge* (120), *Caught by history* (200).
- Each encounter cleared without a fall: 50, and the streak multiplier rises by +0.25 (up to ×3).
  Every bonus is keyed to a stable id and pays once per run, however often time oscillates.

### REWIND 2.0 structure

- **Opening:** three steps from spawn, the first bridge is already cracking and falls. A latch
  holds you; hold rewind and it reassembles; keep holding while you cross (time pins at the
  beginning of history) and collect the shard trail that exists only while the bridge stands.
  Then a fork (orrery ring vs dividing bridge), then a fallen bridge guarded by a blade that
  rewinds with it, and a stair that has not unfolded yet: the first reason to hurry time.
- **Mechanisms:** voussoir bridges (collapse/assemble), ferries, orrery rings, folding stairs,
  escapement gates, sundial blades, **dividing bridges** (halves slide apart and rejoin) and
  **pillar waves** (a travelling wave of rising/sinking pillars).
- **Regions:** I First Contact, II Interlocking, III Verticality, IV Convergence,
  V Transformation. Each unlocks mechanisms, favours its new ones, then recombines old ones;
  the light shifts per region and a banner marks the change. A distant beacon marks the way.
