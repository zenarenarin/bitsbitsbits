# The Thing That Watches Back

A dimensional horror game Bit for Plethora (`plethora-bit@2`, three.js 0.164.1). A tiny traveller crosses an impossible architecture of ribs, shafts, bridges and iris gates, built around a network of watching eyes.

## The rule of the network

- Eyes watch things: other eyes, places, or you.
- An eye that another eye is watching is **held**. It cannot notice you, and a drifter stops on its rail.
- Your gaze **pins** one eye at a time. A pinned eye is blind and frozen. Whatever it was watching is no longer held.
- Look away and it **releases**, then resumes.
- A free eye that sees you **acquires** you. If it finishes, you are seen and the encounter restarts.
- Bridges, iris gates and turning structures answer to the network: who is watching whom.
- Sight lines are real. Columns, walls, blades and canopies block eyes, and they block your gaze too.

Eye states are `active`, `alert`, `acquiring`, `searching`, `pinned`, `releasing`, `disrupted` (a freed eye's moment of disorientation) and `dormant`.

## Eye types

| Type | Behaviour |
|---|---|
| Watcher | Sweeps or watches an eye; turns to you in its periphery |
| Drifter | Rides a rail; held or pinned, it stops |
| Collector | Turns to hold any formation member left unwatched |
| Choir | A ring that holds itself; heals around a pinned member unless architecture blocks the heal |
| Sentinel | Watches floor patches in a visible cycle; when it sees you, every free eye looks there |
| Mimic | Looks wherever you looked a few seconds ago. If you looked at it, it looks at you |
| Liar | Seems asleep, but sees. Cannot be pinned until it opens |
| False eye | Turns and stares, but carries no light and casts no beam. Pinning it does nothing |
| Unblinking | Lidless: cannot be pinned. Stares back at any eye that watches it, and is then held |
| Crown | Shielded from your gaze while its ring is whole |
| Centre | The end of the spiral |

## Campaign

Twenty authored encounters in four acts: Attention (1–4), Relationships (5–10), Deception (11–16), Convergence (17–20). Progress, best times and sound settings are saved locally. Clearing an encounter saves Continue Playing progress. Finishing the campaign submits the campaign time to the `campaign_time` leaderboard.

## Controls

| | Touch | Keyboard and mouse |
|---|---|---|
| Move | Drag anywhere in the lower left | WASD or arrows |
| Look at an eye (pin) | Tap it, or slide a second finger onto it | Click it, or E to cycle |
| Look away | Tap empty space | Click empty space, Space or Q |
| Pause | Pause button | Esc or P |

## Structure

- `src/00_util.js`: math.
- `src/01_sim.js`: the simulation, the single source of truth. It covers eyes, links, holding, gaze, movers (bridges, gates, rotors), walkable regions, blockers, analytic line of sight and checkpoints. It is deterministic at 60 Hz and uses no rendering.
- `src/02_kit.js`: authoring kit. Each call writes the simulation shapes and a visual descriptor from the same numbers.
- `src/03_act1.js` … `src/06_act4.js`: the twenty encounters.
- `src/10_gfx.js`: the illustrated material. It is a Lambert material that turns darkness into world-anchored ink hatching, with contour rims, engraved walkways, height fog and an occlusion fade around the traveller. This file also holds the geometry builders.
- `src/11_world.js`: architecture (slabs with keels, fluted columns, ribbed walls, iris gates, vertebral bridges, ribs, shafts, distant massing).
- `src/12_eyes.js`: socket, ball, shader iris, lids and lashes. Also the billboarded beams of attention.
- `src/13_player.js`: the traveller rig.
- `src/14_view.js`: scene, camera, atmosphere, picking.
- `src/15_audio.js`: synthesised sound.
- `src/16_hud.js`: HUD.
- `src/17_game.js`: the Plethora entry, input, campaign flow.

`node build.js` concatenates `src/` into `main.js`.

## Tests

```sh
node dev/test_campaign.js            # every encounter: the solution bot must win, the naive bot must not
node dev/test_campaign.js e06        # one encounter, with an event trace
python3 -m http.server 8765          # then:
node dev/e2e.js <out> 0 19           # the real game in Chromium: stick input and canvas taps drive each solution
node dev/touch.js <out>              # CDP touch: stick, two-finger gaze while moving, look away, pause
node dev/allshots.js <out> 0 19      # opening screenshot of every encounter
node dev/perf.js                     # draw calls, triangles, CPU per step
```

The dev harness (`dev/index.html`) needs `dev/vendor/three.module.js`, from `https://libs.plethora.studio/three/0.164.1/three.module.js`.
