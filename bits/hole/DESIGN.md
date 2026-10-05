# HOLE: design notes and critique

You carry a 3D aperture cut into a plaster slab. Whatever it swallows changes its geometry, and its geometry decides what it can swallow next.

## Critique before building (and what changed because of it)

| # | Question | Risk in the brief | Response in the prototype |
|---|----------|-------------------|---------------------------|
| 1 | Is transformation useful? | If most things fit anyway, morphing is just cosmetic. | The fit test is exact. Each object's footprint polygon has to sit inside the aperture's radial outline, and the renderer and collision read the same 120 samples. Large "themed" objects (64–84% of the aperture's area) only fit a hole that is clearly committed to their shape. |
| 2 | Does 3D create gameplay? | A top-down 2D game wearing 3D clothes. | The footprint follows orientation, and spinning objects only fit at certain moments. Ramps launch objects into the air, and an airborne object can't be eaten. Its shadow tells you where it will land. Posts, bars and turntables block the hole and objects physically. Honest limit: footprints are still yaw-only projections. Tumbling (an object lying on its side showing a different cross-section) is the obvious next step. |
| 3 | Different from Hole.io? | Growing until you eat everything. | The aperture's area is constant. It only changes shape. Instability makes it smaller, never bigger. |
| 4 | Meaningful choices? | "Eat what's near" with no reason to say no. | Small "basic" objects keep you fed, but each one dilutes your shape a little toward its own. A NEXT chip announces the next wave's shape, and a transformer for that shape is placed out of the way. You choose between easy food now and a hole that can eat the coming wave. |
| 5 | Enough skill? | Orientation was impossible to control: the brief gives no rotation input. | **Tap = twist the aperture 30°.** This works the same in both modes. Themed objects spawn on the 30° grid, and a ±15° "settle" click (like a shape-sorter toy) makes alignment achievable. |
| 6 | Enough risk? | Nothing to manage. | The aperture slowly closes unless you feed it (hunger). Dangerous black shards home in on the hole. Eating one scores RISK points, but it knocks stability down and pushes the outline toward a jagged "broken" shape that fits almost nothing. |
| 7 | Does motion feel good? | Tilt mapped straight to position feels floaty and unpredictable. | Tilt sets a *target velocity* (with a response curve and a deadzone). It goes through the same acceleration-limited integrator as touch. A bubble-level indicator shows your current tilt, so the hole's motion is predictable. |
| 8 | Does touch feel good? | The finger hides the hole, and absolute dragging is jumpy. | Dragging is *relative* (a trackpad-style offset), so the finger never covers the hole. A faint ghost ring shows where the hole is heading. |
| 9 | Endless? | Speed-only scaling. | Sections alternate INTERLUDE (transform) and WAVE (exploit), and the arena itself changes between them: posts → ramp → turntable → narrow passage → sliding posts → random combinations. Difficulty raises spin, dangers, homing, hunger, fast objects and the tightness of perfect fits, not just speed. |
| 10 | First 30 seconds? | A wall of objects. | It's scripted: three static objects (one clearly fits) → three more, including a triangle transformer → slow drift → faster drift → at 24s, NEXT ■ with a far-away square transformer versus easy spheres placed next to you. |

## Equivalence of controls

Both modes produce a desired velocity. The hole then uses the same `VMAX = 8`, `AMAX = 40`, collision, fit test, scoring and hunger. Only the mapping differs:

- **Touch:** desired velocity = `(target − pos) × 11`, clamped to VMAX. Releasing means desired velocity is 0.
- **Motion:** desired velocity = `curve(tilt) × VMAX`, with maxAngle 16° and an exponent of 1.35 for fine control. Holding the phone neutral means desired velocity is 0.

You can switch control mode, recentre, or invert tilt from the pause menu. If no motion sensor data arrives within 1.2s, the game shows "Motion control isn't available on this device." and starts in touch mode. On desktops without touch there's an opt-in dev simulator (arrow keys to tilt, space to twist).

## Playtest notes (automated bot, headless)

- **Greedy bot that never twists:** dies around wave 2–3, at 500–2400 points. It goes hungry through any wave whose shape it didn't transform into, which is the intended consequence.
- **Same bot, after landing a matching transformer:** chains PERFECT +60 at FLOW × 08.
- **An early exploit:** camping at the spawn line. The hole is now limited to the nearer two-thirds of the slab.

## Next steps

- Tumbling objects: a cross-section that changes with pitch and roll.
- A themed wave that needs two shapes in sequence.
- Separate leaderboards per control mode.
