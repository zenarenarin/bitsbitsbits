// The endless run: streaming, seven lives, invulnerability, safe respawn,
// relays as milestones, game over. Headless, through the real controller.
// Usage: node dev/test_run.js
const { TUNING, World, Cat, Hazards, Run } = require('./load')();
const { routes } = require('./routes.js');
const route = routes();
const DT = 1 / 60;
let ok = 0, bad = 0;
const check = (name, cond, info) => { if (cond) ok++; else bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };

function setup() {
  const w = new World(), hz = new Hazards(w), log = { added: 0, removed: 0 };
  const run = new Run(w, hz, { add: () => log.added++, remove: () => log.removed++ });
  const cat = new Cat(w); place(w, cat, run.spawn, 0);
  return { w, hz, run, cat, log };
}
function place(w, cat, p, speed) {
  const g = w.groundAt(p[0], p[2], p[1] + 0.5, 0.05, 0.05);
  cat.reset([p[0], g.box ? g.y : p[1], p[2]], speed);
  if (g.box) { cat.grounded = true; cat.ground = g.box; cat.lastGroundY = g.y; }
}
// one simulation step of the game: cat, hazards, run, respawn
let prevHeld = false;
function tick(E, inp) {
  const held = !!inp.jump;
  E.cat.step(DT, { steer: inp.steer || 0, pace: inp.pace || 0, jumpPressed: held && !prevHeld, jumpHeld: held }); prevHeld = held;
  const ev = E.hz.step(DT, E.cat).concat(E.cat.events); E.cat.events.length = 0;
  E.run.step(DT, E.cat, ev);
  const out = ev.concat(E.run.events); E.run.events = [];
  if (E.run.respawnAt) { place(E.w, E.cat, E.run.respawnAt, TUNING.cat.cruise * 0.55); E.hz.resetUnstable(); E.run.respawned(); out.push({ type: 'respawn', at: E.cat.pos.slice() }); }
  return out;
}
// the section pilots work in section-local z
function pilotFor(E, name) {
  const p = route(name);
  return () => { const c = E.cat, s = E.run.sectionAt(c.pos[2]) || E.run.sections[0]; return p({ pos: [c.pos[0], c.pos[1], c.pos[2] - s.z0], fwd: c.fwd }, E.hz, TUNING); };
}

// 1. a long journey: sections stream in and out, relays are milestones
{ const E = setup(), drive = pilotFor(E, 'high'); let maxLive = 0, falls = 0, relays = 0, t = 0;
  while (E.run.distance < 1000 && t < 400) {
    for (const e of tick(E, drive())) { if (e.type === 'lifeLost') falls++; if (e.type === 'milestone') relays++; }
    maxLive = Math.max(maxLive, E.run.sections.length); t += DT;
  }
  const alive = E.w.boxes.filter(b => b).length;
  check('1 km journey: sections stream ahead and are disposed behind', E.run.distance >= 1000 && E.log.removed >= 7 && maxLive <= 3,
    `${E.run.distance.toFixed(0)} m in ${t.toFixed(0)} s, ${E.log.added} built / ${E.log.removed} disposed, at most ${maxLive} live, ${alive} shapes in the world now`);
  check('1 km journey: every relay passed is a milestone; no end screen', relays === E.run.relays && relays >= 9 && !E.run.over, `${relays} relays, lives ${E.run.lives}, fragments ${E.run.fragments}, score ${E.run.score}`);
  check('1 km journey: the high road loses no lives', falls === 0, `${falls} lives lost`); }

// 2. a fall costs exactly one life and respawns on safe footing
{ const E = setup(); let lost = 0, resp = null, t = 0;
  while (t < 6 && !resp) { for (const e of tick(E, { steer: 0 })) { if (e.type === 'lifeLost') lost++; if (e.type === 'respawn') resp = e.at; } t += DT; }   // no jump at the alley
  const g = resp && E.w.groundAt(resp[0], resp[2], resp[1] + 0.3, 0.05, 0.05);
  check('a fall costs exactly one life', lost === 1 && E.run.lives === 6, `lives ${E.run.lives}`);
  check('the respawn is on solid, stable footing', resp && g.box && !g.box.unstable && g.box.dx === undefined && Math.abs(g.y - resp[1]) < 0.05, resp && `at z ${resp[2].toFixed(1)} on ${g.box && g.box.kind}`);
  // invulnerable straight after: falling again at once costs nothing
  let lost2 = 0; t = 0; resp = null;
  while (t < 3 && !resp) { for (const e of tick(E, { steer: 0 })) { if (e.type === 'lifeLost') lost2++; if (e.type === 'respawn') resp = e.at; } t += DT; }
  check('a new fall right after a respawn is a new incident: it costs exactly one more life', lost2 === 1 && E.run.lives === 5, `fell again after ${t.toFixed(2)} s, lost ${lost2}, lives ${E.run.lives}`); }

// 3. steam: a scald costs one life; a second burst while invulnerable costs nothing
{ const E = setup(); place(E.w, E.cat, [0.2, 0.5, -38.6], 0); let lost = 0, scalds = 0;
  E.hz.time = 0;
  for (let i = 0; i < 60 * 6; i++) for (const e of tick(E, { steer: Math.max(-1, Math.min(1, (0.2 - E.cat.pos[0]) * 2.5)), pace: E.cat.pos[2] < -39.4 ? -1 : 0 })) { if (e.type === 'lifeLost') lost++; if (e.type === 'scald') scalds++; }
  check('steam: standing in the vent costs one life per incident, not one per burst', lost >= 1 && lost <= Math.ceil(6 / (TUNING.run.invuln + 0.8)) && scalds >= 1, `${scalds} scalds, ${lost} lives lost in 6 s`); }

// 4. seven incidents end the run; never before
{ const E = setup(); let deaths = 0, overAt = -1, t = 0;
  while (!E.run.over && t < 200) { for (const e of tick(E, { steer: 0 })) { if (e.type === 'lifeLost') deaths++; if (e.type === 'gameOver') overAt = deaths; } t += DT; }
  check('the run ends at the seventh life lost, not before', E.run.over && overAt === 7 && E.run.lives === 0, `game over after ${overAt} lives, ${t.toFixed(1)} s`); }

// 5. a relay restores a life
{ const E = setup(), drive = pilotFor(E, 'high'); E.run.lives = 4; let gained = false, t = 0;
  while (!gained && t < 40) { for (const e of tick(E, drive())) if (e.type === 'milestone') gained = e.lifeGained; t += DT; }
  const last = E.run.safe[E.run.safe.length - 1], rz = E.hz.relays[0].z;
  check('a relay restores a life and becomes the checkpoint', gained && E.run.lives === 5 && Math.abs(last[2] - (rz + 2.5)) < 0.01, `lives ${E.run.lives}, checkpoint z ${last[2].toFixed(1)} (relay ${rz.toFixed(1)})`); }

// 6. every respawn over a long sloppy run is safe: grounded, not in steam, survives a moment
{ const E = setup(), drive = pilotFor(E, 'high'); let respawns = 0, unsafe = 0, t = 0, rnd = 1;
  const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  let wobble = 0;
  while (t < 120 && !E.run.over) {
    if (rand() < 0.01) wobble = (rand() - 0.5) * 3;  // a careless thumb now and then
    wobble *= 0.97;
    const inp = drive(); inp.steer = Math.max(-1, Math.min(1, inp.steer + wobble)); if (rand() < 0.15) inp.jump = false;
    for (const e of tick(E, inp)) if (e.type === 'respawn') {
      respawns++;
      const c = E.cat, inSteam = E.hz.vents.some(v => Math.abs(v.z - c.pos[2]) < 1.2 && Math.abs(v.x - c.pos[0]) < 0.8);
      if (!c.grounded || !c.ground || c.ground.unstable || c.ground.dx !== undefined || inSteam) unsafe++;
    }
    t += DT;
  }
  check('sloppy play: every respawn lands on safe footing', respawns > 0 && unsafe === 0, `${respawns} respawns, ${unsafe} unsafe, ${E.run.distance.toFixed(0)} m, lives ${E.run.lives}`); }

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
