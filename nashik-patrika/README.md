# शुभ विवाह — a Nashik patrika

A 40-second 9:16 motion patrika (1080 × 1920) and its static version. Both are painted entirely in code: watercolour washes, pencil construction lines and ink, rendered in Chromium.

The idea: you are standing on the stone steps of a ghat on the Godavari, just inside the edge of a riverside pavilion, looking diagonally across the river at the far bank. That bank has old lime-plastered wadas with timber balconies and clay-tile roofs, a basalt temple with a curvilinear shikhara and a mandapa, a small domed chhatri halfway down the steps, a peepal tree, and the town rising behind. Halfway through, you walk about 1.3 m along the ghat. The pavilion's stone pier passes close in front of your eye, and the high basalt wall of a temple precinct comes into view on the right. Its corner bell-house is drawn from the Naroshankar vocabulary, with the bell hanging in a cusped arch.

## Deliverables (`out/`)

| file | what |
|---|---|
| `patrika.mp4` | 1080 × 1920, 30 fps, 40 s, H.264, for WhatsApp and phones |
| `patrika-page1.jpg`, `patrika-page2.jpg` | each view at 2160 × 3840 with all of its text |
| `patrika-static.jpg` | both pages stacked in one image, for forwarding |
| `patrika-static.pdf` | both pages as a two-page PDF |

## Timeline

| time | what happens |
|---|---|
| 0 – 3.4 s | Morning haze lifts off the river. Page 1 is already fully readable. |
| 3.4 – 15 s | Reading. Only slow ripples in the reflections and a few breathing glints move. |
| 15 – 22 s | The walk. Its velocity follows a minimum-jerk curve (no overshoot). The pier crosses the eye, and the text swaps behind it. |
| 22 – 40 s | Reading page 2. The light on stone and water warms very slightly over the whole piece. |

## How the transition works

The camera only ever translates sideways. For any flat surface, that sideways move changes its image by an exact affine shear or scale. So each painted surface (sky, hills, far bank, water, steps, precinct wall, pier) is a card at its true depth. Each frame re-projects the cards with one canvas transform each, and nothing is repainted, which keeps the motion physically correct.

The text never moves, fades or scales. Page 1 stays visible wherever the pier has not yet passed. Page 2 shows wherever it has. The boundary between them is always behind the stone.

## Editing

- **Copy:** `content/copy.js` is the only file to change. Line arrays are one sentence split for hierarchy; join them with spaces to get the draft back. To fill in the names under आपले विनीत, replace `names: null` with the real rows (the format is in the comment).
- **Typography:** `src/style.css`. The typeface is Tiro Devanagari Marathi (SIL OFL, `fonts/`), set in a single weight with no letter-spacing.
- **Timing:** `src/timeline.js`.
- **Scene:** `src/world.js` (composition, in metres), `src/architecture.js` (painters), `src/core.js` (camera and watercolour primitives).

## Rendering

```bash
npm install            # font package only; Playwright + Chromium + ffmpeg must be present
node tools/render.mjs video          # out/patrika.mp4  (~5 min)
node tools/render.mjs stills         # out/patrika-page*.png, -static.png, -static.pdf (2×)
node tools/render.mjs frame 11 34    # quick check frames
```

Opening `index.html` through any local server plays the piece in real time.

## Copy to confirm

These are readings of the handwritten draft. They are typeset exactly as listed here, and nothing has been corrected.

1. **वावीकर.** The surname is read with a long ी.
2. **वदन्या.** This is the bride's name as read.
3. **२९/१/२०२७.** The draft separates the date with vertical strokes; these are typeset as slashes so they are not read as dandas. Pausha Krishna 8, Shaka 1948, Friday 29 January 2027 are consistent with each other.
4. **१२ वाजून १४ मिनिटे.** The draft does not say सकाळी or दुपारी, and nothing has been added.
5. **शुभाशिर्वाद.** This is kept as written. The usual spelling is शुभाशीर्वाद.
6. **श्री. राहुल** has a dot after श्री, but **श्री निलेश** does not. This is kept as in the draft.
7. **राकाज् गुलाबनगरी.** The first word of the venue was hard to read.
8. **हनुमानवाडी.** This could be one word or **हनुमान वाडी**.
9. **The names under आपले विनीत** were redacted in the draft. Their space is reserved with neutral bars until the real names are supplied.
10. **Layout changes:** the parentheses around the parents' names are kept. The honorifics (चि., चि. सौ. कां.) are set smaller than the names, which is a typographic choice and leaves the words unchanged.
