// usage: node dev/losdebug.js e17 X 3,14.2 [moreXZ...]
const api = require('./simload')();
const [id, eid, ...pts] = process.argv.slice(2);
const W = api.createWorld(api.ENCOUNTERS.find(d => d.id === id));
const e = W.eyeById[eid];
for (const p of pts) {
  const [x, z] = p.split(',').map(Number);
  W.player.pos = [x, api.supportAt(W, x, z, 0) ? api.supportAt(W, x, z, 0).y : 0, z];
  const h = api.playerHead(W);
  const tgt = e.pos.map((v, i) => v + (h[i] - v) / Math.hypot(h[0] - e.pos[0], h[1] - e.pos[1], h[2] - e.pos[2]) * e.size * 1.05);
  const bl = W.occluders.filter(o => !e.ignore.has(o.tag) && !api.los({ occluders: [o] }, h, tgt));
  console.log(p, 'gazeLos', api.gazeLosTo(W, e), bl.map(o => `${o.kind}@${(o.wx||0).toFixed(1)},${(o.wz||0).toFixed(1)} tag=${o.tag}`).join(' | '));
}
