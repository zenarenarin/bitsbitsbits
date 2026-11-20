# A Little Something

The first Bit a new Plethora viewer meets. It is a small game: it doesn't explain the app, it lets you play first and teaches the platform's gestures along the way.

A small island sits in a pale turquoise sea. In this world things arrive from the sky on threads: far-off islands hang from them, and so does the piece of the world you are about to place. You tap to let go.

## The journey

1. **On the Bits page.** "WELCOME TO PLETHORA / There's a little something here." sits in the sky. Below it a small island waits in a pale sea, and a little house hangs on a thread from the sky.
   - Far off, finished islands float. Each one is someone else's.
   - The house is the tap target. It has a soft glow and two breathing rings, a ghost finger lands on it, and "TAP TO PLAY" sits directly beneath it.
   - If the host takes that first tap to enter play mode, the mode change counts as the tap and the house drops.
2. **Play.** Tap to let each of seven pieces go: house, tree, house, hill, house, tree, lighthouse.
   - The swing quickens with each piece, and a shadow shows where the piece will land.
   - Houses settle on level plots and stack into towers. Trees grow in the gaps between plots, one per gap. The lighthouse takes a free plot. A piece of hill grows the land.
   - Misses become islets in the sea.
   - If you wait, "TAP TO DROP" returns on the hanging piece.
3. **The surprise.** After the hill, the island tears free of the sea and floats.
4. **Your island is finished.** The lighthouse lamp comes on, dusk falls, the windows light, and the camera frames your island.
5. **Like.** "Enjoyed that? / SWIPE RIGHT TO LIKE". The swipe is shown on Plethora's own `{ }` logo button: rings draw attention to it, a pulse at its edge marks the press, and a finger slides out to the right with chevrons showing the direction. The Bit draws no heart, camera or button of its own. On a real like, a warm glow passes over the island, the trees blossom, petals rise and gulls circle. Then "It likes you back."
6. **Capture.** A print frame appears: "A LITTLE SOMETHING / An island you made." Then "Keep your island. / SWIPE LEFT TO CAPTURE", demonstrated the same way on the real control, to the left. On a real capture the world freezes and flashes, the framed island lifts off like a print, and gets a small date stamp.
7. **Everyone's islands.** The camera pulls back, and other people's islands gather around yours at different depths, each with a small "@name" beneath it. One line reads "Your island joins everyone else's."
8. **Scroll to play more.** A finger pushes upward and the whole world nudges up with it, with "SCROLL TO PLAY MORE".
   - In browse mode the cue moves above the Bit card.
   - If an upward swipe reaches the Bit in play mode, meaning the host didn't scroll, a hint says "TAP { } FIRST, THEN SCROLL".
   - Tapping the sky (a tap, not a scroll) starts another island. No copy advertises it.

There are no counters, statistics or hints during play. The island tells the story.

## Composition

- **Three-quarter view.** The island has a visible top surface (grass ringed by beach), a front cliff and a rocky underside.
- **Grounding.** Everything stands on the middle of that surface, with a contact shadow.
- **Plots and gaps.** Buildings snap to a 40 px grid of plots. Each plot is levelled before a building sits on it. Trees take the gaps between plots.
- **Stacks.** A house always stacks onto the top of its column.
- **Re-grounding.** When the land changes (a hill grows, or the surface deepens as the island widens), every ground-floor piece and its stack is re-seated exactly on the surface.

## Shared world

- **Channel.** `manifest.memory.worlds.islands` is a `points` world: attributed, and limited to 3 islands per user per day.
- **What gets written.** A finished island is written as one point, `{ id, x, y, d, n }`. `d` is a compact description: seed, hills, and each piece's type, plot, floor and variant. Other viewers rebuild the island from it with the same drawing code, so it looks exactly as the creator made it.
- **Names.** Attribution comes from the platform's own field when the snapshot provides one, otherwise from the stored display name.
- **Fallback.** Until there are five other islands, Plethora's own starter islands fill the space, labelled @plethora. No made-up users.
- **Own islands.** The viewer's own islands are excluded from "everyone else's", using ids kept in `ctx.storage`.

## Teaching the real platform actions

The Bit never fakes Like or Capture. It listens with `ctx.chrome.on("action")` and `ctx.chrome.on("mode")`, which Plethora gives only to first-party Bits.

- **Action names.** These are matched loosely (`like|heart`, and `capture|screenshot|camera|comment`). Every action seen is reported with `ctx.platform.emit("host_action_seen", …)`.
- **Never trapped.** A cue gives way after 11 s if ignored, or after 8 s without `ctx.chrome`.
- **Remembered.** Gestures the viewer has learned are kept in `ctx.storage` and not taught again.

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
node dev/play.js shots/nc aim 430x932 '?nochrome&nologo&emptyworld&user='   # no host chrome, empty shared world
node dev/record.js shots/rec            # full-resolution playthrough video
node dev/play.js shots/idle idle          # no input: the demonstration keeps repeating
node dev/perf.js                          # frame pacing at 4x CPU throttle, DPR 3
```

## Still to check on a phone

- The real `ctx.chrome` action names and whether this Bit receives `ctx.chrome` (it must be registered as first-party).
- Whether the feed scrolls while a Bit is in play mode, or only in browse mode.
- The live points-world snapshot shape and attribution field (the Bit reads several likely shapes).
- Whether the first tap in browse mode reaches the Bit or is consumed by the host's switch to play mode.
- Haptics, the audio unlock, and frame rate on GPU-backed canvas.
