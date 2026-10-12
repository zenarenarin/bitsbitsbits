# Move it

A tiny two-character animation playground (Plethora Bit). Drag a figure's hands, feet, knees, elbows, head or hips to pose it, or drag its torso to move the whole figure. Add poses, press play, and export the loop as a GIF.

- `main.js`: the whole Bit (`window.plethoraBit`). Vanilla JS and Canvas 2D, with no dependencies.
- `plethora.json`: the manifest. It requests `storage` (autosave) and `haptics`, and uses a one-line first-use hint.
- `dev/index.html` + `dev/harness.js`: a local stand-in for the Plethora runtime `ctx`, for previewing and testing only.
- `dev/test.mjs`: Playwright end-to-end checks in a 390×844 touch viewport, including the full acceptance scenario.

```sh
node dev/test.mjs            # needs Playwright + Chromium
open dev/index.html          # local preview
```

## How it works

- **Data:** a pose is an independent snapshot of both characters. Each character is stored as a pelvis position plus joint angles, in fixed stage units (440×600). Resizing changes only the view transform.
- **Posing:** hands and feet use two-bone IK. The bend side is locked for the length of a drag, so elbows and knees never flip mid-drag. Elbows and knees rotate their bone. The head tilts. The shoulder point bends the spine. Dragging the hips moves them while the feet stay planted, which is how you crouch, sit or kneel.
- **Playback:** joint angles interpolate with ease-in-out, plus a small follow-through on the head and forearms. Every pose is still hit exactly. Looping eases back to the first pose, unless the last pose already matches it.
- **History:** each completed drag or timeline action is one undo step. History is capped at 80 entries.
- **Export:** frames are rendered off-screen at 25 fps and encoded by a built-in GIF89a/LZW encoder, so no library is needed.
