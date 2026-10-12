# Move it

A tiny two-character animation playground (Plethora Bit). Drag a figure's hands, feet, knees, elbows, head or hips to pose it, or drag its torso to move the whole figure. Add poses, press play, and export the loop as a GIF.

- `main.js`: the whole Bit (`window.plethoraBit`). Vanilla JS and Canvas 2D, with no dependencies.
- `plethora.json`: the manifest. It requests `storage` (autosave) and `haptics`, and uses a one-line first-use hint.
- `dev/index.html` + `dev/harness.js`: a local stand-in for the Plethora runtime `ctx`, for previewing and testing only.
- `dev/test.mjs`: Playwright end-to-end checks in a 390×844 touch viewport, including the full acceptance scenario.

```sh
node dev/test.mjs            # needs Playwright + Chromium (also motion.mjs, freeform.mjs)
open dev/index.html          # local preview
```

## How it works

- **Data:** a pose is an independent snapshot of both characters. Each character is stored as a hip position plus joint angles, in fixed stage units (440×600). The spine has three segments, so it can curve. Resizing changes only the view transform.
- **Bodies:** each body part is a chain of circles. The chain and the tangent hulls between neighbouring circles are filled as one shape, which gives a tapered torso and limbs with rounded, hinge-free elbows and knees. The same shapes are used for hit testing, so anything you can see you can grab. The rig adds anatomical assists: raising an arm lifts its shoulder, and lifting a leg tips the pelvis and counter-leans the torso.
- **Direct manipulation:** what a drag does depends on where it starts.
  - Head: tilts it, and the upper spine follows.
  - Chest: curves the spine.
  - Belly: leans the torso.
  - Hips: crouch with the feet planted.
  - Upper arm or thigh: swings it.
  - Forearm, hand, shin or foot: two-bone IK. A hand pulled out of reach makes the body lean into the reach.
  - Press and hold: picks up the whole figure.

  Planted feet stay exactly where they are during every drag.
- **Animation, base layer:** a pure function of time. Every channel follows a Catmull–Rom (cubic Hermite) curve through the poses, so the body moves through poses instead of stopping at each one (unless the pose has a hold). Distal parts trail slightly to give overlapping action, and shoulders never swing through the body. Feet that rest in place between poses stay planted, and they ease into and out of contact.
- **Animation, motion layer:** springs stepped at 240 Hz with interpolated targets, so motion is the same at any frame rate. The hips carry momentum, which drives sway, squash and stretch. The head and forearms follow through, and the hips dip before big accelerations (anticipation) and sink on landings. None of this ever writes to the saved poses.
- **History:** each completed drag or timeline action is one undo step. History is capped at 80 entries.
- **Export:** a built-in GIF89a/LZW encoder renders the same pipeline as playback, so no library is needed.

## Tests

- `dev/test.mjs` (66 checks): the original acceptance scenario, pose integrity, undo/redo, persistence, timeline, ghost, loop and export.
- `dev/motion.mjs` (22 checks): builds a wave → jump → landing → lean scene through touch drags, then simulates playback at 30, 60 and 144 fps and with jittered frame times. It measures snapping, jerk, the loop seam, frame-rate independence, foot sliding, limb length, joint flips, anticipation, landing absorption and follow-through, and writes `scene.gif`.
- `dev/freeform.mjs` (20 checks): grabs the torso, chest, upper arm, forearm, head, hips, thigh and shin directly, then plays the result back.
- `dev/frames.mjs`, `dev/look.mjs` and `dev/perf.mjs` are visual and performance inspection helpers.
