# INFLATE — local dev

The Bit itself is `../main.js` + `../plethora.json` (Plethora runtime `plethora-bit@2`). These files are local tooling only and are not uploaded.

## Play it in a browser

```sh
npx http-server bits/inflate -p 8765 -c-1
# open http://localhost:8765/dev/harness.html
```

`harness.html` is a small mock of the Plethora SDK surface the game uses (canvas, input, game loop, storage, platform events). Query params: `st` / `sb` simulate the top/bottom safe area in px, `manual=1` disables the rAF loop so tests can step frames with `window.__advance(ms)`.

Controls: hold anywhere (touch or mouse) to inflate, release to shrink. Space / ↑ also inflate on desktop; Esc pauses.

## Headless simulation checks

```sh
node bits/inflate/dev/sim_test.js gen            # generator: open %, difficulty by distance, fallback count
node bits/inflate/dev/sim_test.js policies       # hold-forever / never-hold / mashing must fail early
node bits/inflate/dev/sim_test.js autopilot 6 60000
```

Tuning lives in the `CFG` block at the top of `main.js` (inflation rates, radii, buoyancy, drag, speed, difficulty curve, validator beam/margin, scoring, streaks).
