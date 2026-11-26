# शुभ विवाह — a Nashik patrika

A single-page Marathi wedding patrika (9:16, 1080 × 1920) set in an original painted view of the Godavari at Panchavati, Nashik. Everything is painted in code: watercolour washes, pencil construction lines and ink, rendered in Chromium.

**Status:** the static composition is awaiting approval. River motion will be added only after that.

## The composition (after the user's reference, recomposed for 9:16)

- **The setting:** a soft morning on the Godavari. We stand inside an old stone pavilion on the ghat: its pillar and the spring of its arch frame the left edge, and a flowering palash branch hangs over them.
- **The couple:** below, on the steps, a married couple sits with their backs to us, looking at the river, a brass thali of marigolds and a lota beside them.
- **Our bank (left):** the ghat recedes along the river past a round open pavilion, a basalt shikhara and a corner bell-house.
- **Across the water (right):** a tall arcaded sandstone tower stands in the river, with the town and hills beyond.
- **The type:** sits in the sky on one centred axis, with the venue in the low gap between the temples and the tower.

## Typography

- **Typeface:** Tiro Devanagari Marathi, in one weight. It was tested on the actual copy against Noto Serif Devanagari.
- **Colour:** names, title and headings in deep kumkum maroon; the rest in warm near-black.
- **Ornament:** two fine gold flourishes only: either side of ॥ शुभ विवाह ॥, and around the senders.
- **Line breaks:** the invitation keeps the line breaks of the family's handwritten draft.
- **Spacing:** a 14 px unit.

## Editing and rendering

- **Copy:** `content/copy.js` holds all the copy.
- **Code:** `src/style.css` is the type system, `src/scene.js` the painting, `src/main.js` the compositor and river, `src/timeline.js` the timing.

```bash
node tools/render.mjs still     # out/patrika-static.jpg + .pdf at 2160 × 3840
node tools/render.mjs frame 0   # quick 1080 × 1920 check
node tools/render.mjs video     # out/patrika.mp4 (after approval of the static)
```

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
9. **The names under * आपले विनीत *** were blacked out in the draft. Their space is held with faint bars, and no text has been invented.
10. **Layout changes:** the parentheses around the parents' names are kept. The honorifics (चि., चि. सौ. कां.) are set smaller than the names, which is a typographic choice and leaves the words unchanged.
