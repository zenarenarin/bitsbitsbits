# शुभ विवाह — a Nashik patrika

A single-page Marathi wedding patrika (9:16, 1080 × 1920) set in an original painted view of the Godavari at Panchavati, Nashik. Everything is painted in code: watercolour washes, pencil construction lines and ink, rendered in Chromium.

**Status:** the static composition is awaiting approval. River motion will be added only after that.

## The composition

- **The view:** seen from a raised ghat on our bank, frontally across a broad river. The light is a soft golden glow low behind the far bank, so the riverfront reads as layered, backlit planes with warm rims.
- **The far bank, left to right:**
  - a Naroshankar-type precinct: a high basalt river wall with a blind arcade, a corner bell-house with the bell hanging in a cusped arch, a gateway stair through the wall, and a basalt shikhara and domed mandapa behind;
  - the old town packed up the slope with spires and domes;
  - a round open pavilion on a platform in the river;
  - a tall arcaded tower standing in the water, as the landmark.
- **The river and the near bank:** the far ghat has tiny figures and boats. On our side, a married couple sits on the steps at the water, seen from behind.
- **The type:**
  - The ceremonial text sits on one centred axis in the sky.
  - The senders and the venue sit in a traditional two-column footer on the paving, which fades into the paper.

## Typography

- **Typeface:** Tiro Devanagari Marathi, in one weight. It was chosen over Noto Serif Devanagari after testing the actual copy: both render every conjunct correctly, but Tiro has the letterpress character of Marathi print.
- **Spacing:** a 14 px unit, with sections 3 units apart.
- **Type sizes (px):**

| Text | Size |
|---|---|
| invocation, footer | 24 |
| family lines, invitation | 29 |
| date and muhurta line | 34 |
| ॥ शुभ विवाह ॥ | 46 |
| names | 68 |

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
9. **The names under आपले विनीत** were blacked out in the draft. Their space is held with faint bars, and no text has been invented.
10. **Layout changes:** the parentheses around the parents' names are kept. The honorifics (चि., चि. सौ. कां.) are set smaller than the names, which is a typographic choice and leaves the words unchanged.
