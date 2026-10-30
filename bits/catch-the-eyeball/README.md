# Catch the Eyeball

A 30-second Halloween arcade Bit for Plethora (`plethora-bit@2`, three.js 0.164.1). You slide a glass specimen jar along the floor of an abandoned specimen cabinet and catch the eyeballs that blink open in the dark, bounce around the room and keep staring at your jar.

## Controls

| | Desktop | Mobile |
|---|---|---|
| Move the jar | Mouse movement, or ←/→ (A/D) | Drag horizontally anywhere |
| Start / replay | PLAY button, Enter or Space | PLAY button |
| Mute | Speaker icon on the start/result screens, or M | Speaker icon |

## Eyeballs

All seven share one construction: an irregular silhouette, dirty-ivory sclera on a five-step ramp, a maroon outline, pink socket tissue and veins that crawl in from the rim.

| Eye | Look | Behaviour | Score |
|---|---|---|---|
| Normal | Teal or brown iris | Bounces, darts, glances before it darts | +10 |
| Bloodshot | Pink sclera, heavy veins, rust iris | Faster and twitchier | +15 |
| Golden | Amber sunburst iris, warm sparkle trail | Floats, drifts and shies away from the jar. Rare (2–3 per round) | +50 |
| Possessed | Near-black iris, tiny pupil, lumpy silhouette, ember trail | Throbs (inflamed frame) faster and faster, then bursts. Catching it bursts it in the jar | −25, combo reset, jar stunned |
| Teleporting | Hypnotic ringed iris, turquoise shimmer | A shimmer marks where it will go, it blinks out and reappears (up to 3 times) | +20 |
| Multiplying | Three pupils, a budding lump | Swells and splits into 2–3 small eyes on its first floor hit or rim hit | +20 (small eyes +8) |

Each floor hit is a leap back up. After three (two for golden and small eyes) the eye shuts and melts into the floor.

**Combo:** catches within 2.6 s of each other chain. 3+ = ×2, 6+ = ×3, 10+ = ×4.

**Difficulty:** two calm teaching eyes arrive beside the jar first. Over the 30 s, the spawn interval falls from 1.2 s to 0.4 s, the cap on eyes on screen rises from 3 to 10, and eye speed goes from ×0.82 to ×1.45 (time-scaled, so the arcs keep their shape and only get faster). Bloodshot eyes arrive from 4 s, teleporting from 9 s, multiplying from 13 s and possessed from 17 s.

At 0 s spawning stops, eyes already dropping in can still land for 0.9 s, then every eye shuts and the result screen shows score, best and the number caught.

## Rendering

- **Low-res pipeline.** The WebGL renderer draws into a framebuffer of a whole number of device pixels per art pixel (about 200×300 art pixels minimum). The canvas is then upscaled with `image-rendering: pixelated`. One world unit is one art pixel.
  - Every sprite has even dimensions and is snapped to whole texels each frame, so the grid never drifts.
  - Squash and stretch resample through nearest filtering at the same pixel density.
- **Authored, not filtered.** `src/01_sprites.js` paints every eyeball layer, lid frame, the jar, flames and the room texel by texel from the palette ramps in `src/00_util.js`.
  - Lambert shading is quantised, then single-pixel noise is removed so each cluster reads as deliberately placed.
  - Dithering is used only for the large, quiet room gradients and for particle fades.
- **Eyes are four layers.** The sclera, the iris (which slides a few texels to look at the jar), a fixed gloss and a lid (blink, open, teleport and close frames).
- **Particles.** One pooled `THREE.Points` draw: grid-snapped squares that fade by ordered dither.
- **Wide screens.** The playfield is capped at 320 art pixels. Shelves sit behind stone pillars that mark the side walls.

## Files

- `src/00_util.js`: maths helpers and the palette.
- `src/01_sprites.js`: pixel-art painters for the eyes, jar and room.
- `src/02_audio.js`: Web Audio synthesis.
  - Room tone and drips.
  - Bounce, squelch plus glass ring, rim clink.
  - Burst, teleport, split, countdown ticks and the end chord.
  - One master gain for mute.
- `src/03_fx.js`: the particle pool.
- `src/04_eyes.js`: the pooled eyes (26), substepped physics, eye-to-eye collisions and the behaviours.
- `src/05_jar.js`:
  - Jar movement, the catch zone, and the rim and wall bumpers.
  - Pickled contents: up to 10 visible, the oldest dissolves when full, and they stay below the mouth.
- `src/06_game.js`: layout, room, input, the round, difficulty, scoring, the HUD and screens, and the Plethora lifecycle.

`node build.js` concatenates `src/` into `main.js`. Edit the sources, not `main.js`.

**The catch rule:** an eye is caught when its centre drops through the mouth line within the inner rim while it is moving down. Anything else hits the round rim lips or the glass walls and bounces. A caught eye leaves the physics immediately, so it can't be caught twice.

## Testing

```bash
mkdir -p dev/vendor && cp <three@0.164.1>/build/three.module.js dev/vendor/
```

```bash
python3 -m http.server 8766
```

```bash
NODE_PATH=/opt/node-tools/node_modules node dev/play.js <outdir> 390 844 3
```

`dev/play.js` runs a bot-driven round with screenshots and prints counts per eye type, splits, bursts and misses; set `NOBOT=1` to keep the jar still. `dev/input.js` checks the PLAY button, mouse, keyboard and touch drag in the live loop, plus the frame rate. `dev/sheet.js` dumps a zoomed sprite sheet for art review.
