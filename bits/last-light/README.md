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
- `src/05_watcher.js`: the Watcher. It knows only what its lamps light: four points on your silhouette (feet, knees, chest, head) tested against each lamp's visibility polygon.
  - **Hidden**: no lamp lights you.
  - **Exposed** (*notice*): suspicion rises with how much of you is lit (about 0.9 s fully lit to be sure). The lamp hesitates and its iris tightens.
  - **Detected** (*track*): the lamps that can reach your last known position turn to it. Lock-on rises while you're lit (about 1.3 s more and you're caught).
  - **Hunting**: you stayed lit too long, or it found you again soon after losing you. Lock-on is faster, shutters near your last known position close, and doorways there open and stop hiding you.
  - **Lost**: you broke its line of sight. It sweeps the place it last saw you, marked with a dashed ring, and gives up after 5 s (7.5 s in a hunt).
  - **Reacquire**: walk back into its light while it's still searching and it goes straight to a hunt.
  - **Captured**: lock-on full. The light closes on you like an iris, then a card shows the cause, worked out from the game state at that moment.
  - **No flicker exploit**: suspicion and lock-on only start to fall after 0.45 s out of the light, so darting in and out of a beam still gets you found.
  - **Noise**: a cord pull or a hard landing gives it a place to look, without revealing you.
  - Every timing lives in `WATCH`.
- `src/04_world.js`: awnings that unroll (each is a platform and a shadow, and rolls back after a few seconds), Watcher-operated shutters that never close on you, doorways, laundry, the rope.
- `src/01_level.js`, the authored slice. Every stretch has at least two routes with different costs.
  - **I. The balcony:** you start hidden in a balcony doorway. A tower searchlight sweeps the balcony; time the crossing to the far balcony, which the overhanging roof shades, then grab the cornice.
  - **II. First contact:**
    - The roof: a raking lamp and chimney shadows. Fast, but timed.
    - Under the roof's edge: hang and shimmy. Safe, but slow.
    - The street: two lanterns sweep it; go doorway to doorway.
  - **III. Descent:** a drainpipe in the blind spot under the lamp.
  - **IV. The awning:** the cord hangs in the open at the edge of a lantern's sweep. Pull while it looks away; the awning's shadow covers the cord and the crossing for 4.5 s. The pull is loud, so the lantern turns to where you pulled. Or take the high road: climb the pipe, jump to D's balcony, wait in the balcony doorway, then run the balconies between sweeps of a raking lamp.
  - **V. The Watcher responds:** a noise or a hunt brings the gate shutter down. Slide under it, wait in a doorway until it lifts, or climb over the gatehouse.
  - **VI. The escape:** swing across the cellar on the rope (fast, through two sweeping lamps), or climb through the cellar. A doorway past the court is somewhere to break a pursuit.
  - **VII. The last light:**
    - Climb, wait on the pipe under the balcony, pull the high cord, drop, and run beneath the lamppost in the awning's shadow.
    - Or wait on the second pipe and take the rooftops between the far tower's sweeps.
  - **Checkpoints:** four marks (I, III, V, VII). After a capture you can run the whole street again (a full reset), or retry from the last mark: the clock keeps running and the capture costs points.
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

**Score:** 10,000 − 40 per second − 250 per second lit − 500 per detection − 1,500 per capture (minimum 100). The result screen shows this breakdown, and the score is submitted to the `score` record.

**Feedback:**
- An aperture closes around the runner while a lamp has you: dashed while you're only exposed, solid with lock-on marks once you're detected.
- A dashed ring marks where the Watcher is searching after it loses you.
- The screen edges whiten while you're lit.
- A thin high hiss rises with how much of you is lit.
- The pull button exists only beside a cord: it reads PULL, or WAIT while the awning is out, and it's hidden in mid-air.

## Run and test

```sh
node build.js
python3 -m http.server 8766      # from this folder; open http://localhost:8766/dev/index.html
node dev/route.js     # 17 movement checks: every traversal, driven through the real controller
node dev/threat.js    # 16 Watcher and exploit checks (standing in, running through and darting along beams, hiding, reacquiring, climbing, jumping, the awning's timing, shutters, doors, capture card, retry and reset, the pull button)
node dev/play.js A    # a careful full run, lamps live: roof and awning route (≈85 s, uncaught)
node dev/play.js B    # the slow, safe route: street, high road, cellar, rooftops, no awning (≈114 s, uncaught)
node dev/probe.js     # exposure map per route and polygon/detection agreement
node dev/touch.js out # emulated phone with real touch events: begin, stick + jump multitouch, pull, pause, result, replay
node dev/shot.js out 402 874 x,y,label[,awning]   # screenshots
```
