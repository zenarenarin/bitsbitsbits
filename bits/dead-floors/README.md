# DEAD FLOORS

A first-person zombie survival shooter Bit for Plethora (`plethora-bit@2`, three.js 0.164.1).
Each run takes place in one randomly generated building. The horde hunts you from the moment it
spawns and grows over time; ammo is scarce (a few respawning boxes, rare drops, better odds on
headshot kills). Weapon crates appear around the building with the next of 12 guns (then Mk
upgrades), a boss arrives every three minutes, and your score is the time you survive.

| | Touch | Keyboard |
|---|---|---|
| Move | Floating stick, left side | WASD / arrows |
| Aim | Drag anywhere on the right (dragging from FIRE also aims) | J/L (or arrows) |
| Fire | Hold FIRE | Space / F |
| Reload / swap | RELOAD / SWAP buttons | R / Q |

- Leaderboard `survival`: whole seconds survived (best per user), checkpoint each minute, submit on every death or quit.
- Survival time uses `ctx.game.stopwatch` (active play only).
- All textures, models and sound effects are procedural; music from `ctx.music`.
- Tuning knobs: aim assist, look speed, horde growth rate, ammo supply.

Edit `src/*.js`, then `node build.js` to regenerate `main.js`.
Dev: serve this folder, copy three.module.js 0.164.1 to `dev/vendor/`, open `dev/index.html`,
and run `node dev/smoke.js`, `dev/guns.js`, `dev/bot.js` (Playwright).
