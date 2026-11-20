# A Little Something

The first Bit a new Plethora viewer meets. It is a small game: it doesn't explain the app, it lets you play first and teaches the platform's gestures along the way.

A small island sits in a pale turquoise sea. In this world things arrive from the sky on threads: far-off islands hang from them, and so does the piece of the world you are about to place. You tap to let go.

## The beats

1. **The world, already alive.** The island sits in the sea, gulls drift, far islands sway on their threads, and a little house swings above. The editorial title *WELCOME TO PLETHORA / There's a little something here.* sits in the sky. The thread passes behind the letters.
2. **The demonstration.** After 1.6 s a ghost finger taps the sky, the thread twangs and the house jiggles. *TAP TO LET IT GO* sits between the house and the island. A shadow on the island shows where the piece will land, and for the first two pieces a dotted plumb line joins them.
3. **You act.** Tap anywhere and the thread snaps (a sound plus a light haptic). The house falls and lands with squash, dust, a note and sprouting grass. The title lifts away.
4. **Variation.** Seven pieces: house, tree, house, hill, house, tree, lighthouse.
   - The swing speeds up with each piece.
   - Houses snap onto houses and stack into towers (*HOUSES STACK*).
   - A piece of hill grows the land and lifts whatever stands on it (*LAND MAKES MORE ISLAND*).
   - Misses aren't failures: the sea keeps them as little islets (*THE SEA KEEPS WHAT YOU MISS*).
   - The landing note is chosen by where the piece lands, so placing pieces plays a small tune.
5. **The surprise.** After the hill, the island rumbles, tears free of the sea and rises. Water pours off its underside and its roots hang free (*IT FLOATS.*). From then on wind sways the threads, the island bobs, and clouds drift below it.
6. **Something emerges.** The last piece is a lighthouse. Its lamp flickers on, dusk falls, the windows light one by one and the beam sweeps. The camera frames the island under a plate: *ISLAND Nº n · MADE BY @you · date · 7 PIECES · 2 KEPT BY THE SEA*. Every island is different, because it is the record of your taps.

## Teaching the real platform actions

The Bit never fakes Like, Capture or Navigation. Plethora's logo button (`{ }`) is the real control:

| Gesture | Host action | What the Bit does |
|---|---|---|
| Swipe the logo left | Capture | Cue: *Keep this one. / SWIPE LEFT TO CAPTURE*, with a ghost finger dragging from the logo to a camera target. On capture the world freezes, a white flash, the plate frame snaps tight, a **CAPTURED** stamp and a shutter sound. |
| Swipe the logo right | Like | Cue: *Enjoyed that? / SWIPE RIGHT TO LIKE*, with a ghost drag to a heart. On like, a warm coral glow passes over the island, the trees blossom from left to right, petals rise, gulls circle and a soft arpeggio plays. |
| Tap the logo | Navigation | Cue: a dotted thread (the Bit's own motif) runs from the island down to the logo, which gets soft pulse rings, with *There's a lot more here. / TAP { } TO LOOK AROUND*. When navigation opens, the gulls fly off. |

- **How it hears the host.** The Bit listens with `ctx.chrome.on("action")` and `ctx.chrome.on("mode")`. These are host-restricted and supplied to first-party Bits only.
- **Action names.** They are matched loosely (`capture|screenshot|camera|comment`, `like|heart`, `nav|menu|browse`), and a `play` → `browse` mode change counts as navigation.
- **Debugging.** Every host action seen is reported with `ctx.platform.emit("host_action_seen", …)`, so the real names can be confirmed from analytics.
- **Never trapped.** A cue gives way after 11 s if ignored, so the viewer is never stuck. The navigation cue stays, and *OR TAP THE SKY FOR ANOTHER ISLAND* starts a fresh, randomised island.
- **Without `ctx.chrome`.** In a creator draft preview the cues still teach the gestures, and the cue sequence advances on its own after 8 s each.
- **Remembered.** Gestures the viewer has used are kept in `ctx.storage` and not taught again.

## Art direction

- **Drawing.** Flat Canvas2D with split lit and shade faces, as in an isometric illustration.
- **Palette.** One palette interpolated from dawn to dusk:
  - Teal sky, turquoise sea and ochre sand.
  - Olive and acid-yellow trees, white houses with soft orange roofs.
  - A single unexpected coral, used only for the Like bloom.
- **Texture.** A static film-grain overlay sits on its own `overlay` surface, so it costs nothing per frame.
- **Type.** Approved registry fonts only, with no serifs:
  - Bebas Neue for titles, which matches Plethora's own headings.
  - Inter for the human lines.
  - Space Mono for the instruction lines.
- **Sound.** An ambient pentatonic `ctx.music` bed that turns Lydian at dusk. World sounds are synthesised: thread snap, wooden landing note, splash, rumble, lamp chord, shutter and like arpeggio. There is a mute toggle in the top right.

## Run locally

```sh
mkdir -p dev/vendor   # fonts from libs.plethora.studio, see dev/index.html
python3 -m http.server 8777
# open http://localhost:8777/dev/index.html
```

The harness emulates Plethora's host:

- It starts in browse mode, with the card, the nav bar and the BITS pill.
- The first tap enters play mode.
- The `{ }` logo emits the real-shaped chrome events: a tap means navigation, a swipe left means `screenshot_comment`, a swipe right means `like`.
- Add `?nochrome&nologo` to test the fallback.

## Tests

```sh
node dev/play.js shots/run aim            # full playthrough, every beat screenshotted, host gestures performed
node dev/play.js shots/miss miss 360x640  # misses into the sea on a small Android-sized screen
node dev/play.js shots/tab aim 768x1024   # tablet
node dev/play.js shots/nc aim 430x932 '?nochrome&nologo&user='   # no host chrome: timed fallback
node dev/play.js shots/idle idle          # no input: the demonstration keeps repeating
node dev/perf.js                          # frame pacing at 4x CPU throttle, DPR 3
```

## Still to check on a phone

- The real `ctx.chrome` action names and whether this Bit receives `ctx.chrome` (it must be registered as first-party).
- Whether the first tap in browse mode reaches the Bit or is consumed by the host's switch to play mode.
- Haptics, the audio unlock, and frame rate on GPU-backed canvas.
