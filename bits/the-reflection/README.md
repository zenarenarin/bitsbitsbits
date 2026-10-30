# The Reflection

A 3D psychological-horror arcade Bit for Plethora (`plethora-bit@2`, three.js 0.164.1). A small black cat sits before an antique cheval mirror. At first its reflection follows. Then it leads. Then it starts to anticipate you. Keep in sync for as long as you can.

**One endless run, no rounds and no breaks.** The three phases flow into each other on a clock. The only text is two lines: *At first, it follows you.* at the start and *Then it doesn't.* when the reflection takes over. After that the room says the rest: the candle gutters, the glass warps, the drone tightens. Past 80 s the run keeps going and keeps escalating, with floors so it stays fair.

## Plethora contract

Built against the agent context **`plethora-agent-context-2026-10-22.1`** (SDK 1.7.0), fetched from <https://agent.plethora.studio/v1/agent/context.md>. Fetch it again before any upload and send that version as `agentFeedback.contextVersion`; an upload built against an older context is refused with `409 context_outdated`.

- **`"display": "fullscreen"`** (required to publish). The scene runs edge to edge. The HUD, the action buttons and every screen are laid out from `ctx.contentSafeArea ?? ctx.safeArea`, so they stay clear of the camera cutout, the home indicator and Plethora's logo button.
- **Onboarding:** `one_line`.
- **Dependency:** `three@0.164.1`, the approved registry pin. Fonts (DM Serif Display in roman and italic, Nunito Sans 700) come from the font registry through `ctx.loadFont`.
- **Score:** kept on `ctx.game.score()` and submitted once per run to the `score` record. The results screen shows the top three and your own rank from that same board. Replay never waits for it.
- **Pulse:** a run that survives 80 s ends with `ctx.pulse.complete` on the results screen.
- **Storage:** used synchronously, for the best score and the mute setting.
- **Creator tuning (Draft Tools):**
  - `response_window`, `takeover_seconds` and `feint_rate` apply on restart.
  - `camera_shake` and `mirror_distortion` apply live.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Sit | 1 | button 1 |
| Stand | 2 | button 2 |
| Crouch | 3 | button 3 |
| Paw up | 4 | button 4 |
| Jump | 5 or Space | button 5 |
| Pause | Esc / P | (pauses on blur) |
| Mute | M | speaker icon |

## How a run unfolds

| Time | Level | The reflection… |
|---|---|---|
| 0 s | 1 | copies you after 300 ms |
| 8 s | 2 | lags, stretching toward 1 s; glances and blinks on its own (cosmetic, never scored) |
| 20 s | 3 | **leads**: moves first in a fixed, learnable order; you copy it |
| 28 s | 4 | reorders its moves |
| 36 s | 5 | repeats moves (a repeat is a visible dip back into the same pose) |
| 45 s | 6 | hurries: shorter windows, variable gaps |
| 53 s | 7 | feints: a third of a move, then a shudder and a reversed hiss. There is no cue on the glass and no penalty for ignoring it, but answering one counts as *fooled* |
| 58 s+ | | two-move sequences, later three |
| 63 s | 8 | anticipates: an ear-flick tell, then it quickly takes the move you favour |
| 80 s+ | 9, 10… | one more step every 20 s, with window and gap floors |

A real prompt draws a hairline of light along the base of the glass that shrinks as the response window closes. Your first five prompts also light the matching button.

## Synchronisation and score

Sync starts at 100 and is clamped to 0–100. STABLE is 75 and up, UNSTABLE 45–74, CRITICAL below 45; the meter pulses below 20. At 0 the reflection escapes.

| Result | Sync | Score (× level × perfect-combo) |
|---|---|---|
| Perfect (≤ 500 ms) | +10 | 200 |
| Good (≤ 900 ms) | +5 | 100 |
| Late (≤ 1200 ms) | +2 | 25 |
| Wrong action | −12 | — |
| Missed | −15 | — |
| Moving when it didn't (*alone*) | −4 | — |
| Answering a feint (*fooled*) | −6 | — |

Survival adds 10 points per second, times the level multiplier. Consecutive perfects raise the multiplier in steps of 0.2, up to ×3. Phase 1 pays a little for each deliberate change of pose and nothing for mashing. All numbers live in `src/00_config.js`.

When the reflection escapes, it stops pretending: it stares, turns from the glass and walks out of the mirror, and the mirror's candle goes out while yours keeps burning. Then you see the results and can go again straight away.

## Architecture

`build.js` concatenates `src/` into `main.js` (edit the sources, not the build).

- `00_config.js`: every gameplay number, the difficulty levels and the timing windows.
- `01_util.js`: math and the seeded RNG.
- `02_director.js`: **the reflection's mind**. Pure logic with no DOM, rendering or wall clock: phases, the difficulty manager, the deterministic action queue, prompts, validation, sync and score. It talks to the game only through hooks. One input per prompt, double taps ignored, no scoring after game over.
- `03_room.js`: procedural textures (floorboards, aged wallpaper with stains, wainscot, patina), the room, window, curtain, table, candle, armchair, books, the arched bronze mirror with its cheval stand, and the dust motes.
- `04_cat.js`: the procedural cat rig. It has a spine, two-bone IK legs toward foot targets, a head with blinking eyes and ears, and a tail chain. The five poses are spring targets; the jump is a timeline (prep, flight, landing). The rig also does feints, repeats, tells and the escape walk. **Each cat has its own controller.** The reflection never reads the real cat's state.
- `05_audio.js`: procedural WebAudio behind named hooks (`catMove`, `reflectMove`, `perfect`, `wrong`, `miss`, `warn`, `deviate`, `phase`, `gameOver`, ambience), so recorded assets can replace any of them later. The reflection's sounds are swelled in (reversed envelope) and sent through a dark delay.
- `06_ui.js`: the HUD (time, score, best, sync meter, streak and combo), the silhouette action buttons, and the start, results and pause screens.
- `07_game.js`: renderer, flow and input.
  - **The mirror** is a second scene. The room is rebuilt inside a group whose matrix reflects across the tilted glass plane, with a clip plane at the glass, and it holds the reflection cat.
  - That scene renders to a target, which the glass samples in screen space. That gives real ripples on deviations, chromatic tearing as sync falls, old silvering and foxing, a glint on perfect timing, and the response cue.
  - The mirror tilts forward on its stand so it looks down at the floor, which keeps both cats visible.
  - The camera solves its fov and pitch per aspect, so the cat stands just above the buttons and the mirror fills the frame in both landscape and portrait.

## Run locally

```sh
node build.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/three.module.js https://libs.plethora.studio/three/0.164.1/three.module.js
python3 -m http.server 8765        # from this folder, then open http://localhost:8765/dev/index.html
# add ?fullscreen to emulate a full-screen iPhone 17 Pro (insets and the logo button)
```

## Tests

```sh
node dev/sim.js                              # director: skilled / idle / mashing / sloppy bots, endless escalation, clamping
node dev/shoot.js <outdir> 1280 800 basic    # screenshots of all five actions, both cats
node dev/shoot.js <outdir> 390 844 basic     # the same on a phone
node dev/shoot.js <outdir> 1280 800 long     # 85 s bot run through every phase, escape, results, AGAIN
node dev/shoot.js <outdir> 900 600 poses     # side close-ups of every pose
QS='?fullscreen' node dev/shoot.js <outdir> 402 874 results   # full-screen phone: result board, real taps on AGAIN and the action buttons
```
