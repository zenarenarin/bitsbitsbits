# The Last Light on the Street

A monochrome pursuit arcade Bit for Plethora (`plethora-bit@2`, Canvas2D, no dependencies). Something unseen, the Watcher, hunts a small figure through an engraved old city using the city's own lamps. You run, climb, hang and swing through the architecture, and pull awnings out to throw new shadows. The slice is **The Watcher's Street**: seven sections, a result screen and an immediate retry.

## The signature idea

Every façade is drawn twice: once in ink (the city at night) and once as a paper engraving. Each lamp's lit area is its **visibility polygon**, cast against the same edges the game uses for detection. The renderer draws the engraving clipped to those polygons, so the Watcher's light reveals the city as white paper and shadow is the city's own black.

- **Only the Watcher's light is white.** Lit windows and ordinary lamplight are grey.
- **Detection uses the same geometry as the drawing.** `dev/probe.js` checks 20,000+ random points and finds 100% agreement between the drawn polygons and `optics.sees`.
- **Shadow comes from the geometry.** Anything solid between you and a lamp (slab, chimney, awning, shutter, laundry) hides you.

## Controls

| | Touch | Keys |
|---|---|---|
| Run, climb, drop | Drag on the left (floating stick) | Arrows / WASD |
| Jump (hold for height) | Jump button, or tap the right side | Space |
| Pull a cord | Hand button (bright when something is in reach) | E |
| Pause | Pause button | Esc / P |

Movement:
- Hold down on a balcony or roof to lower yourself and hang from its lip. Shimmy left and right; press up to pull up, or down to let go.
- Down + jump drops straight through a balcony.
- Running into a waist-high obstacle vaults it; pressing down while running slides.

## Systems

- `src/02_player.js`, the runner:
  - Running with acceleration, braking and turning.
  - Variable-height jump with coyote time and a jump buffer.
  - Step-ups, vaults, slide and crouch.
  - Grabbing ledge lips and block corners, shimmying, pull-ups, drop-to-hang.
  - Climbing drainpipes, including stepping off at the top.
  - A real pendulum rope swing with pumping and a release that keeps your velocity.
  - Every tunable lives in `MOVE`.
- `src/03_light.js`: visibility polygons and `sees()`, both built on the same set of occluding edges.
- `src/05_watcher.js`, the Watcher's states:
  - **search**: lamps follow their sweep patterns.
  - **notice**: a lamp that sees you hesitates, its iris tightens, and suspicion rises.
  - **investigate**: noise (a cord pull, a hard landing) gives it a place to look.
  - **track**: lamps turn to your *last known* position, not your current one, and lock-on rises while you are lit.
  - **hunt**: after a long exposure, or being found again soon after it lost you. Lamps move faster, shutters near your last known position close, and nearby doorways open and stop hiding you.
  - **capture**: lock-on reaches full.
  - Tunables live in `WATCH`.
- `src/04_world.js`: awnings that unroll (each is a platform and a shadow, and rolls back after a few seconds), Watcher-operated shutters that never close on you, doorways, laundry, the rope.
- `src/01_level.js`, the authored slice:
  - I. The balcony
  - II. First contact: a raking lamp over a roof with chimneys. Run in rhythm, or hang under the roof's lip and shimmy, where the roof itself hides you.
  - III. Descent
  - IV. The awning: a lantern over the street. Pull the cord and run in the awning's shadow, or take the high road and time a sweep.
  - V. The Watcher responds: the gate shutter drops when the Watcher investigates. Slide under it, wait in a doorway, or climb over the gatehouse.
  - VI. The escape: swing over the cellar, or climb through it.
  - VII. The last light: climb, pull the high cord, drop, and run beneath the lamppost.
- `src/06_art.js`, `src/07_render.js`, the art:
  - Layers: sky, skyline, façades, light, architecture, runner, near-side foreground.
  - A faint giant silhouette (the Watcher's shade) crosses the distant houses during a hunt.
  - The runner is procedural: flat cap, scarf, paper rim.
- `src/08_audio.js`, procedural sound:
  - Footsteps that differ by surface.
  - The lamps' motor hum.
  - A cue for each Watcher state.
  - Shutters, awnings, doors, and the city's slow tick.
- `src/09_game.js`:
  - Input, checkpoint marks, capture and a 1.25 s retry.
  - HUD: time, chapter heading, the Watcher's eye and meter.
  - Pause, result and leaderboard, and the Plethora lifecycle.

**Score:** 10,000 − 45 per second − 300 per second seen − 400 per alarm − 1,200 per capture (minimum 100). It is submitted to the `score` record.

## Run and test

```sh
node build.js
python3 -m http.server 8766      # from this folder; open http://localhost:8766/dev/index.html
node dev/route.js     # 17 movement checks: every traversal, driven through the real controller
node dev/threat.js    # 10 Watcher checks: escalation, recovery, last-known position, awning shade, shutters, capture/retry, doors
node dev/play.js      # a careful full run with the lamps watching (≈44 s, uncaught)
node dev/probe.js     # exposure map per route and polygon/detection agreement
node dev/touch.js out # emulated phone with real touch events: begin, stick + jump multitouch, pull, pause, result, replay
node dev/shot.js out 402 874 x,y,label[,awning]   # screenshots
```
