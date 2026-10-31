# SPIN DOCTOR

A precision timing Bit for Plethora (`plethora-bit@2`, three.js 0.164.1). A kinetic sculpture of concentric rings, each turning at its own speed and in its own direction. Tap a ring to engage its brake, so that its marker comes to rest on the fixed vertical axis at 12 o'clock. When every ring is aligned, the sculpture synchronises and the next round adds another ring.

**Observe → predict → tap → align.** That is the whole game.

## Rules

- Round 1 has three rings at 42, −61 and 83 °/s. Every cleared round adds one ring.
- Tapping a ring brakes it over 210 ms. The velocity falls as v₀(1 − s)², so the ring always travels another v₀ × 0.07 s after the tap. Reading that lead is the skill.
- **Aligned**: the marker stops within tolerance. The ring clicks into exact alignment, turns pale cyan and stays locked.
- **Missed**: the ring stops where it lands, turns warm and stays still until you tap it again to release it. Three misses in one round end the run.
- Tolerance starts at ±6° and tightens toward ±2.5° (`2.5 + 3.5·e^(−(round−1)/4.5)`). Two faint ticks beside the axis index show the current window.

## Difficulty

Difficulty comes from several dials, not just raw speed:

1. Ring count: +1 per round, up to what the screen can hold at a reliable touch size (≥14 px per ring band). That is 10 rings on a typical phone and 8 on a small one. After the cap, rounds keep the full ring count and keep getting harder in the ways below.
2. Speeds: stratified across a widening band. Round 1 runs 30–84 °/s, and the band grows to 58–128 °/s. Speeds are always clearly distinct, and near-2:1 and 3:2 ratios are avoided so rings don't fall into an obvious rhythm.
3. Direction: rings alternate, with more same-direction neighbours from round 3.
4. Start positions: always at least 38° off the axis. From round 4, markers increasingly start just past the axis, so you have to watch nearly a full revolution first.
5. Tolerance: tightens every round.
6. Breathing speeds: from round 4, some rings modulate their speed by a few percent, making them less predictable.

**Solvability guarantee:** peak speed, including breathing, is capped at 132 °/s and tolerance never drops below 2.5°, so the acceptance window is always at least 38 ms (more than two frames at 60 Hz). `dev/logic.test.js` checks this across 400 seeds × 30 rounds.

## Scoring

| | |
|---|---|
| Aligned ring | 100 |
| Precision | ≤1° +100 · ≤2° +70 · ≤4° +40 · otherwise +20 |
| Streak | +25 per consecutive alignment beyond the first, up to +250. A miss resets it. |
| Flawless round (no misses) | 100 + 50 × ring count |

The board is `memory.records.score` (best per user, descending). It is submitted once per run, at game over. Stored on the device through `ctx.storage` (`spin-doctor.v1`): best score, highest round, best streak, best precision, last score and the mute preference.

## Implementation notes

- **Sculpture**: each ring is a lathe of a rounded-rectangle profile with real bevels and depth, built once. Only vertex positions are rewritten when a ring's dimensions change, during the round-to-round re-layout; normals don't depend on size.
- **Lighting**: materials are `MeshPhysicalMaterial` (brushed aluminium, frosted glass, porcelain, resin, satin silver, champagne and so on), lit by a PMREM of a procedural studio of soft light panels. A key light casts PCF shadows onto a shadow-only wall 70 px behind the rings.
- **Background**: a screen-space shader gives the warm charcoal field and an almost imperceptible aura, which brightens during synchronisation.
- **Marker and axis**: each marker is a dark machined inlay with a narrow luminous incision. The axis is a faint additive line with an index tick. Completion sends a pulse up the axis and sweeps a light across the metal.
- **Timing**: everything is in delta time. A tap is mapped to simulation time using the pointer event's timestamp, so the brake starts where the ring was at the moment of touch, not at the next frame.
- **Input**: hit-testing is radial. Each ring owns exactly its band, so neighbouring rings never steal a tap. Locked, braking and spinning-up rings ignore taps, and gameplay input is ignored during transitions, pause and game over.
- **Camera**: perspective with a 14° FOV, set so 1 world unit = 1 CSS px at the sculpture plane. That makes hit-testing and layout exact while keeping a faint depth cue.
- **Sound**: all synthesised in WebAudio (requires the `audio` permission): room tone, a whir that follows the number of spinning rings, a click on select, metallic friction on brake, a glass-metal partial stack on lock that rises with each aligned ring, a muted thud on a miss, a layered harmonic resonance on completion and a quiet two-note resolution at game over. The game is fully playable muted.

## Run locally

```sh
mkdir -p dev/vendor
curl -sS -o dev/vendor/three.module.js https://libs.plethora.studio/three/0.164.1/three.module.js
curl -sS -o dev/vendor/inter-400.ttf https://libs.plethora.studio/fonts/inter/1.0.0/400.ttf
curl -sS -o dev/vendor/inter-600.ttf https://libs.plethora.studio/fonts/inter/1.0.0/600.ttf
curl -sS -o dev/vendor/cormorant-garamond-300-italic.ttf https://libs.plethora.studio/fonts/cormorant-garamond/1.0.0/300-italic.ttf
python3 -m http.server 8765   # from this folder, then open http://localhost:8765/dev/index.html
```

## Tests

```sh
node dev/logic.test.js                # angle wrap at 0/360, brake profile, tolerance, scoring, round generation and solvability
node dev/play.test.js dev/out 9       # headless Chromium, loop stepped at 60 Hz: hit-testing, braking, miss/release,
                                      # duplicate taps, 358.5° lock, 9 rounds of perfect play, pause, game over,
                                      # leaderboard submit, persistence, restart, small-phone layout, console errors
```
