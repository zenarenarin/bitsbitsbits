# The Wind Keeps

A 3D Bit for Plethora (`plethora-bit@2`, three.js 0.164.1). You are a tiny caretaker in a large, gently broken mechanical world. Everything moves on its own timing. You can't steer any of it: you watch, and you touch the screen at the moment that matters. One good touch travels through the whole machine.

**The one skill:** knowing when to step into a moving system. There is no timing bar, target ring or "PERFECT" text. Timing is read from the world: grass bending as a gust crosses the meadow, sails starting to flutter, the swell of the wind's sound, a lift slowing at the top of its hop, a pendulum at the end of its arc.

## Worlds

### I. The Windmill

Wind arrives in gusts from the meadow, on the left. Golden ribbons, a bending grass wave and blowing leaves show each one coming.

The chain of consequences:

1. Catching a gust opens the sails, and the rotor gains momentum. Fast sails are easier to keep fast.
2. Above a certain speed, the rotor drives a pump into the cistern. Its notes rise as the cistern fills.
3. The cistern feeds a water wheel.
4. The wheel's coral cam kicks a ratchet lift. Catch the cage at the top of each hop and the pawl holds it there.
5. The lift carries the lantern-bearer, a small creature, up to the greenhouse on the cliff.
6. Its seed becomes a flower, the greenhouse lights up, the bell rings and the birds lift off.

| # | Entry | What it introduces |
|---|---|---|
| 01 | Get the windmill turning | Catching. Wide windows, steady wind |
| 02 | Fill the cistern | Momentum: the pump only works above a speed |
| 03 | Raise the lift | A second timing, the apex of a hop |
| 04 | Carry a seed to the greenhouse | The full chain, and keeping water flowing |
| 05 | Mind the crosswind | Grey-blue gusts from the right. Catching one brakes the rotor and blows the keeper's hat off; letting it pass is rewarded |
| 06 | Everything at once | An uneven wind pattern (3 + 3 + 2) against the wheel's 3-beat cam |
| 07 | The living machine | 100 seconds; the wind changes mood every few bars |

### II. The Clock Tower

A pendulum hangs in the arch. Push it at the end of its swing to keep it going. Pushing is optional, and pushing too much bangs it into the stops.

While it swings:

1. The escapement ticks the hands forward and steps a great wheel round.
2. Catch the wheel's coral pointer at the top to wind the bell weight.
3. Each quarter hour, the hammer falls if the weight is wound. Then the bell rings and an automaton bird comes out.
4. In the later entries, gusts from the windmill country (the windmill is visible on the horizon) blow through the arch. They shove the swing off its rhythm, so the player has to read it again.

Entries: Wake the pendulum · Set the hands moving · Wind the bell weight · Ring the hour · A wind through the arch · Keep the quarters · Keep time (100 s).

World II unlocks after Windmill 04.

### Today's Machine

A daily 90-second run. A seed derived from the UTC date picks:

- the world
- the wind's weather pattern
- how often crosswinds or gusts come
- the starting water or weight
- the number of lift notches

Everyone gets the same machine. The score goes to the `daily_machine` record, and the result card shows the top three and your rank.

## Systems

- **Ops** (`08_game.js`). Each world creates timed opportunities (`G.addOp`).
  - A tap resolves the nearest one, plus anything else lined up within the good window. Two at once gives a "When things align" bonus.
  - The tap time is taken from the event, between frames, minus 30 ms to allow for input latency.
  - Outcomes: in flow, good, early, late, snag (catching a harmful op), missed, and weathered (a harmful op left alone).
  - Optional ops (pendulum pushes) are never counted as misses.
- **Flow** is the state of the world, not a multiplier:
  - lower drag on the sails
  - more open canvas
  - garden flowers that bloom at thresholds
  - balcony lanterns
  - a pad chord that gains voices
  - music that snaps onto the shared pulse
  - In flow, the water wheel and the pendulum gently phase-lock to the wind's pulse, so the machine starts to sound like one piece.
  - Mistakes lower Flow a little; one mistake never ends a run. Nothing can fail permanently: the wind keeps coming.
- **Chains** of good catches give sparse lines of text ("The chain continues", "Beautifully connected", "Everything moves"…) and a swell of the current chord.
- **Score** is mostly hidden. It counts:
  - catch quality, chain length and Flow
  - deliveries and quarter hours
  - weathered crosswinds
  - an efficiency bonus against par
  - Stamps on the result card: KEPT, IN FLOW, UNBROKEN.
- **Audio** (`01_audio.js`) is all procedural WebAudio:
  - wind bed, and a gust swell that peaks on arrival
  - blade creaks pitched by speed, a thump per revolution
  - pump chuffs, cistern drips that rise with the water level
  - ratchets, latches, ticks and tocks, FM-style bells
  - creature chirps, a flow-driven pad with chord changes on deliveries
- **HUD** ("the field note"):
  - top left: an archival label and the objective as tally marks
  - top right: a nearly invisible pause mark
  - bottom left: a paper turbine that fills and spins with Flow, beside a rolling mechanical counter
  - Sheets (pause, field notes index, completion record) are pieces of paper.
- **First use** is immersive. On the very first gust, a pencilled dashed arrow follows it in to the sails ("the wind is coming"), and a small touch glyph appears as it arrives. After the first catch, both are gone for good.

## Platform integration

- **Readiness**: the DOM title paints first. Three loads with distinct failure messages for library, renderer and first frame; `platform.ready()` comes after the first rendered frame.
- `platform.start()` on every attempt, `interact`, `milestone`, `setProgress`, `complete`, and `pulse.complete` (score and time) on the result screen.
- `memory.local('notebook')`: unlocked entries, best scores, stamps and sound preference. Writes happen only after a successful read; a failed read shows "notes could not be read" and never overwrites.
- `memory.records.daily_machine`: `best_per_user`, desc. Submitted at the end of every daily run, detached from replay.
- `tuning`: timing forgiveness, anticipation beats, Flow recovery, daily length and sound level.

## Run locally

```sh
node build.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/three.module.js https://libs.plethora.studio/three/0.164.1/three.module.js
python3 -m http.server 8765        # from this folder
# open http://localhost:8765/dev/index.html
```

## Tests

```sh
node dev/levels.js [skill] [offset] [world] [noise]   # a timing bot plays every entry (e.g. 0.8 0.02 "" 0.12)
node dev/touch.js                                      # emulated iPhone, real touches: begin, catch, pause, resume, HUD passthrough, field notes
node dev/shoot.js <name> [w] [h] [steps...]            # screenshots; steps are JS expressions, wait:ms or shot:name
Q='?failmem' node dev/shoot.js fm                      # memory unavailable
Q='?failthree' node dev/shoot.js ft                    # library download failure
```
