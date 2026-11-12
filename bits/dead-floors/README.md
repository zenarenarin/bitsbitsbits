# DEAD FLOORS

An endless first-person zombie shooter Bit for Plethora (`plethora-bit@2`, three.js 0.164.1).
Each floor of a derelict building is generated from rooms and corridors. Kill enough zombies to
open the elevator, ride it down, and get a new weapon on every floor (12 guns, then Mk upgrades).
Every fifth floor is a boss arena (The Butcher, The Broodmother, alternating and scaling).

| | Touch | Keyboard |
|---|---|---|
| Move | Floating stick, left side | WASD / arrows |
| Aim | Drag anywhere on the right (dragging from FIRE also aims) | J/L (or arrows) |
| Fire | Hold FIRE | Space / F |
| Reload / swap | RELOAD / SWAP buttons | R / Q |

- Score leaderboard (`score`, best per user), floor checkpoints, submit at every death.
- Continue Playing via `game.progress.main` (saved on arrival at each floor from floor 2).
- All textures, models and sound effects are procedural; music from `ctx.music`.
- Tuning knobs: aim assist, look speed, difficulty ramp, ammo drops.

Edit `src/*.js`, then `node build.js` to regenerate `main.js`.
Dev: serve this folder, copy three.module.js 0.164.1 to `dev/vendor/`, open `dev/index.html`,
and run `node dev/smoke.js`, `dev/guns.js`, `dev/bot.js`, `dev/exitwalk.js` (Playwright).
