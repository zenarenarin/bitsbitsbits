// Debug contact sheet: run an encounter (with an optional plan) and draw the sim state as SVG
// every `every` seconds. usage: node dev/sheet.js <id> <out.png> [plan|naive|idle] [every] [frames]
const L = require('./load')('createSim, ENCOUNTERS, buildEncounter, ST, DEG');
const { runPlan, NAIVE } = require('./policy');
const PLANS = require('./plans');
const id = +process.argv[2], out = process.argv[3], which = process.argv[4] || 'idle', every = +(process.argv[5] || 1.5), frames = +(process.argv[6] || 12);
const E = L.ENCOUNTERS.find(e => e.id === id);
const S = L.createSim(L.buildEncounter(E, {}));
const col = { watcher: '#222', drifter: '#7a7', collector: '#a60', liar: '#a0a', mimic: '#06a', sentinel: '#c00', warden: '#c80', choir: '#555', crown: '#990', falseeye: '#bbb', unblinking: '#000', echo: '#69c' };
function svg() {
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10.5 -10.5 21 21" width="300" height="300" style="background:#f3eee2">`);
  p.push(`<g transform="scale(1,-1)">`);
  for (const r of S.rings) {
    p.push(`<circle r="${r.r}" fill="none" stroke="#ddd" stroke-width="${S.G.w - 0.5}"/>`);
    for (const b of r.barriers) { const th = b + S.phi[r.k]; p.push(`<line x1="${(r.r - S.G.w / 2) * Math.cos(th)}" y1="${(r.r - S.G.w / 2) * Math.sin(th)}" x2="${(r.r + S.G.w / 2) * Math.cos(th)}" y2="${(r.r + S.G.w / 2) * Math.sin(th)}" stroke="#000" stroke-width="0.18"/>`); }
  }
  p.push(`<circle r="${S.G.Ro}" fill="none" stroke="#000" stroke-width="0.3"/>`);
  for (const w of S.walls) {
    p.push(`<circle r="${w.r}" fill="none" stroke="#000" stroke-width="0.3"/>`);
    for (const v of w.veils) { const a0 = v[0] + S.phi[w.owner], a1 = v[1] + S.phi[w.owner]; p.push(`<path d="M${w.r * Math.cos(a0)},${w.r * Math.sin(a0)} A${w.r},${w.r} 0 0 1 ${w.r * Math.cos(a1)},${w.r * Math.sin(a1)}" fill="none" stroke="#630" stroke-width="0.7" transform="scale(1,1)"/>`); }
    for (const d of w.doors) { const th = S.doorTheta(w, d), open = S.doorOpen(d); p.push(`<circle cx="${w.r * Math.cos(th)}" cy="${w.r * Math.sin(th)}" r="0.55" fill="${open ? '#f3eee2' : '#c88'}" stroke="${open ? '#0a0' : '#a00'}" stroke-width="0.1"/>`); }
  }
  p.push(`<circle r="${S.G.Ri * 0.62}" fill="#333"/>`);
  for (const s of S.eyes) if (s.type === 'sentinel' && s.state !== 'dead') { const sp = S.eyePos(s); const a0 = s.aim - s.half, a1 = s.aim + s.half; p.push(`<path d="M${sp[0]},${sp[1]} L${sp[0] + s.range * Math.cos(a0)},${sp[1] + s.range * Math.sin(a0)} L${sp[0] + s.range * Math.cos(a1)},${sp[1] + s.range * Math.sin(a1)}Z" fill="${s.seeing ? '#f008' : '#f002'}"/>`); }
  for (const e of S.eyes) {
    if (e.state === 'dead') continue;
    const q = S.eyePos(e), st = e.state;
    const stroke = st === 'pinned' || st === 'releasing' ? '#0c0' : st === 'feign' ? '#f0f' : st === 'stunned' ? '#888' : st === 'knot' ? '#a60' : st === 'dormant' ? '#ccc' : '#fff';
    p.push(`<circle cx="${q[0]}" cy="${q[1]}" r="${e.rad}" fill="${col[e.type]}" stroke="${stroke}" stroke-width="0.14"/>`);
    if (e.group !== null && S.groups[e.group].conductor === e.id) p.push(`<circle cx="${q[0]}" cy="${q[1]}" r="0.15" fill="#ff0"/>`);
  }
  const pp = S.playerPos();
  if (S.gaze.point) p.push(`<line x1="${pp[0]}" y1="${pp[1]}" x2="${S.gaze.point[0]}" y2="${S.gaze.point[1]}" stroke="#09f" stroke-width="0.06"/>`);
  p.push(`<circle cx="${pp[0]}" cy="${pp[1]}" r="0.32" fill="#f40" stroke="#000" stroke-width="0.06"/>`);
  p.push(`</g>`);
  p.push(`<text x="-10.2" y="-9.6" font-size="0.8" font-family="monospace">t=${S.t.toFixed(1)} ${S.over ? 'CAUGHT ' + S.over.type : S.reached ? 'REACHED' : ''} exp=${S.P.exposure.toFixed(2)}</text>`);
  p.push(`<text x="-10.2" y="10.2" font-size="0.6" font-family="monospace">${S.eyes.map(e => e.name + ':' + e.state[0]).join(' ')}</text>`);
  p.push(`</svg>`);
  return p.join('');
}
const shots = [svg()];
let next = every;
const origStep = S.step;
S.step = inp => { origStep(inp); if (S.t >= next && shots.length < frames) { shots.push(svg()); next += every; } };
const plan = which === 'naive' ? NAIVE : which === 'idle' ? [{ wait: every * frames }] : PLANS[id][which];
const r = runPlan(S, plan, { verbose: true, max: every * frames + 1 });
shots.push(svg());
console.log(JSON.stringify({ ok: r.ok, t: r.t, over: r.over, ring: r.ring, step: r.step }));
console.log(r.log.slice(0, 40).join('\n'));
const html = `<html><body style="margin:0;display:flex;flex-wrap:wrap;width:1200px">${shots.join('')}</body></html>`;
(async () => {
  const { chromium } = require('/opt/node-tools/node_modules/playwright');
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1200, height: 300 * Math.ceil(shots.length / 4) } });
  await pg.setContent(html); await pg.screenshot({ path: out, fullPage: true }); await b.close();
})();
