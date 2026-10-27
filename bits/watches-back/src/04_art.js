// =====================================================================
// Art: ink on bone. Ring textures are drawn once per spiral with Canvas
// 2D brush strokes, unwrapped (x = angle around the ring, y = from the
// outer edge inward), and wrapped back onto annuli by a shader that lays
// them over procedural paper. Eyes, the traveller, the gaze thread and
// the sentinels' sight are drawn by shaders, so their state is live.
// =====================================================================

const PAL = {
  ink: '#0f0d0b', bone: '#ece4d2', ivory: '#ddd2ba', olive: '#7d7a45', oliveDeep: '#4d4a28', graphite: '#57524a', void: '#100e0c',
};

// ---------- canvas brushwork ----------
// A brush stroke along a polyline: a body of varying width, plus dry-brush bristle
// streaks that break up toward the tail. pts: [[x,y],...]
function brush(g, pts, w0, w1, rng, o) {
  o = o || {};
  const n = pts.length;
  if (n < 2) return;
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = o.color || PAL.ink; g.fillStyle = o.color || PAL.ink;
  // body: overlapping round segments with a slowly wandering width
  for (let i = 0; i < n - 1; i++) {
    const t = i / (n - 1);
    const wobble = 1 + (rng() - 0.5) * (o.jitter === undefined ? 0.35 : o.jitter);
    g.globalAlpha = (o.alpha || 1) * (o.fade ? 1 - t * o.fade : 1);
    g.lineWidth = Math.max(0.6, lerp(w0, w1, t) * wobble);
    g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.stroke();
  }
  // dry brush: thin bristle lines offset across the stroke, broken by gaps
  const bristles = o.bristles === undefined ? 5 : o.bristles;
  for (let b = 0; b < bristles; b++) {
    const off = (rng() - 0.5) * Math.max(w0, w1) * 1.15;
    g.lineWidth = 0.6 + rng() * 1.2;
    g.globalAlpha = (o.alpha || 1) * (0.35 + rng() * 0.5);
    g.beginPath();
    let drawing = false;
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      if (rng() < 0.12 + i / n * 0.25) { drawing = false; continue; }
      if (!drawing) { g.moveTo(x0 + nx * off, y0 + ny * off); drawing = true; }
      g.lineTo(x1 + nx * off, y1 + ny * off);
    }
    g.stroke();
  }
  g.restore();
}
// sample a straight-ish line into a wobbling polyline
function wline(x0, y0, x1, y1, n, amp, rng) {
  const pts = [];
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  let w = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    w += (rng() - 0.5) * amp; w *= 0.8;
    pts.push([x0 + dx * t + nx * w, y0 + dy * t + ny * w]);
  }
  return pts;
}
// irregular filled ink region between two wavy horizontal edges, x0..x1 (strip space)
function inkBand(g, x0, x1, yTop, yBot, rng, step) {
  step = step || 6;
  if (!(x1 > x0 + 0.5)) return;
  const top = [], bot = [];
  let a = 0, b = 0;
  for (let x = x0; x <= x1 + step; x += step) {
    const xx = Math.min(x, x1);
    a += (rng() - 0.5) * 1.6; a *= 0.86; b += (rng() - 0.5) * 1.6; b *= 0.86;
    top.push([xx, yTop + a]); bot.push([xx, yBot + b]);
    if (xx === x1) break;
  }
  g.beginPath();
  g.moveTo(top[0][0], top[0][1]);
  for (const p of top) g.lineTo(p[0], p[1]);
  for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]);
  g.closePath();
  g.fill();
}

// ---------- ring textures ----------
// Band k covers radii [rIn, rOut]: its groove, plus the wall outside it (wall k-1), which
// it owns. The centre band (k = N) holds the last wall and the pupil.
function bandRadii(G, k) {
  const t = RULES.wallThick;
  if (k >= G.n) return { rIn: 0, rOut: G.Ri + t / 2 };
  const r = G.rings[k].r;
  return { rIn: r - G.w / 2 + t / 2, rOut: r + G.w / 2 + t / 2 };
}

function makeRingStrip(G, k, def, opts) {
  const { rIn, rOut } = bandRadii(G, k);
  const band = rOut - rIn;
  const ppu = opts.ppu || 60;
  const W = Math.min(opts.maxW || 4096, Math.max(512, Math.round(TAU * (rIn + rOut) / 2 * ppu)));
  const H = Math.max(64, Math.round(band * ppu));
  const c = opts.canvas(W, H);
  const g = c.getContext('2d');
  const rng = makeRng((def.seed || 1) * 131 + k * 977);
  g.clearRect(0, 0, W, H);
  // strip helpers: x from angle (radians), y from radius
  const X = a => wrap0(a) / TAU * W;
  const Y = r => (rOut - r) / band * H;
  const pxPerUnitAt = r => W / (TAU * r);
  const t = RULES.wallThick;
  const wallIdx = k - 1;                  // the wall this band owns (outside its groove)
  const rWall = k === 0 ? rOut - t / 2 : G.walls[wallIdx].r;
  const rGroove = k < G.n ? G.rings[k].r : 0;

  // --- olive wash on some grooves (a rare, sick colour) ---
  if (k < G.n && (def.olive || []).includes(k)) {
    g.fillStyle = PAL.olive; g.globalAlpha = 0.28;
    inkBand(g, 0, W, Y(rGroove + G.w / 2 - t / 2), Y(rGroove - G.w / 2 + t / 2), rng, 14);
    g.globalAlpha = 1;
  }
  // --- the groove: a worn path, light graphite, and hatching that thickens toward the walls ---
  if (k < G.n) {
    const yc = Y(rGroove);
    g.strokeStyle = PAL.graphite;
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = 0.07 + rng() * 0.05; g.lineWidth = 1 + rng() * 2;
      g.beginPath(); let w = 0;
      for (let x = 0; x <= W; x += 10) { w += (rng() - 0.5) * 2; w *= 0.9; const y = yc + (i - 1) * H * 0.06 + w; x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
    // shading hatches against the inner wall edge (the wall below belongs to the next band)
    const yIn = Y(rIn), yOutEdge = Y(rWall - t / 2);
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 5 + rng() * 6) {
      const len = (0.12 + rng() * 0.22) * H;
      g.globalAlpha = 0.18 + rng() * 0.18;
      g.beginPath(); g.moveTo(x, yIn); g.lineTo(x + len * 0.35, yIn - len); g.stroke();
      if (rng() < 0.6) { g.globalAlpha *= 0.8; g.beginPath(); g.moveTo(x, yOutEdge); g.lineTo(x - len * 0.25, yOutEdge + len * 0.7); g.stroke(); }
    }
    g.globalAlpha = 1;
    // spiral arms: three, one turn per band, continuous across bands only when the rings align
    for (let arm = 0; arm < 3; arm++) {
      const pts = [];
      for (let i = 0; i <= 160; i++) {
        const u = i / 160;
        const r = rOut - u * (rOut - rIn);
        const a = arm * TAU / 3 + u * TAU;   // one full turn while crossing the band
        pts.push([X(a), Y(r), a]);
      }
      // split where x wraps
      let seg = [];
      g.strokeStyle = PAL.ink;
      const flush = () => { if (seg.length > 1) brush(g, seg, 2.2, 3.4, rng, { alpha: 0.5, bristles: 3, jitter: 0.6 }); seg = []; };
      for (let i = 0; i < pts.length; i++) {
        if (i && Math.abs(pts[i][0] - pts[i - 1][0]) > W / 2) flush();
        seg.push([pts[i][0], pts[i][1]]);
      }
      flush();
    }
  }
  // --- the wall this band owns, with its openings ---
  {
    const yT = Y(rWall + t / 2), yB = Y(rWall - t / 2);
    const doors = k > 0 ? G.walls[wallIdx].doors : [];
    // spans of solid wall between openings
    const cuts = doors.map(d => { const half = RULES.doorHalf * d.wscale / rWall; return [wrap0(d.a - half), wrap0(d.a + half)]; }).sort((a, b) => a[0] - b[0]);
    const spans = [];
    if (!cuts.length) spans.push([0, TAU]);
    else for (let i = 0; i < cuts.length; i++) {
      const from = cuts[i][1], to = cuts[(i + 1) % cuts.length][0];
      if (to > from) spans.push([from, to]); else { spans.push([from, TAU]); spans.push([0, to]); }
    }
    g.fillStyle = PAL.ink;
    const Xr = a => a / TAU * W;   // spans are already within [0, TAU]; do not wrap their ends
    for (const [a0, a1] of spans) {
      if (a1 - a0 < 1e-3) continue;
      inkBand(g, Xr(a0) - (a0 === 0 ? 2 : 0), Xr(a1) + (a1 >= TAU - 1e-6 ? 2 : 0), yT, yB, rng, 5);
    }
    // dry-brush streaks along the wall, light scratches through the ink (a drawing, not a pipe)
    for (let i = 0; i < 26; i++) {
      const y = lerp(yT, yB, rng());
      const x0 = rng() * W, len = W * (0.03 + rng() * 0.12);
      brush(g, wline(x0, y, x0 + len, y + (rng() - 0.5) * 3, 12, 1.5, rng), 1.2, 0.4, rng, { color: PAL.bone, alpha: 0.18 + rng() * 0.2, bristles: 1 });
    }
    // ragged ink flicks off both faces of the wall
    for (let i = 0; i < W / 18; i++) {
      const x = rng() * W, up = rng() < 0.5, l = (3 + rng() * 10) * (H / 120);
      const inGap = cuts.some(([c0, c1]) => { const a = x / W * TAU; return inArc(a, c0, c1); });
      if (inGap) continue;
      g.strokeStyle = PAL.ink; g.globalAlpha = 0.5 + rng() * 0.4; g.lineWidth = 0.8 + rng() * 1.4;
      const y0 = up ? yT : yB;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (rng() - 0.5) * 6, y0 + (up ? -l : l)); g.stroke();
    }
    g.globalAlpha = 1;
    // lips of each opening: a few curling strokes, like an eyelid's edge
    for (const [c0, c1] of cuts) {
      for (const [edge, s] of [[c0, -1], [c1, 1]]) {
        for (let j = 0; j < 4; j++) {
          const x = X(edge), y = lerp(yT, yB, (j + 0.5) / 4);
          brush(g, wline(x, y, x - s * (5 + rng() * 9), y + (rng() - 0.5) * 8, 5, 1.5, rng), 2, 0.5, rng, { bristles: 1 });
        }
      }
    }
    // veils: long lashes rising off the wall on both sides; they block sight
    if (k > 0) for (const v of G.walls[wallIdx].veils) {
      const span = wrap0(v[1] - v[0]);
      const n = Math.max(6, Math.round(span * rWall * 7));
      for (let i = 0; i <= n; i++) {
        const a = v[0] + span * i / n;
        const x = X(a);
        for (const dir of [-1, 1]) {
          const len = (0.45 + rng() * 0.4) * (H * 0.4);
          const lean = (rng() - 0.5) * 18;
          const y0 = dir < 0 ? yT : yB;
          const pts = [];
          for (let q = 0; q <= 8; q++) { const tt = q / 8; pts.push([x + lean * tt * tt, y0 + dir * len * tt]); }
          brush(g, pts, 3.2, 0.6, rng, { bristles: 1, fade: 0.3 });
        }
      }
    }
    // the outermost band: a heavier, older edge
    if (k === 0) {
      for (let i = 0; i < 3; i++) { g.fillStyle = PAL.ink; g.globalAlpha = 0.3; inkBand(g, 0, W, yT - 6 - i * 4, yT, rng, 8); }
      g.globalAlpha = 1;
    }
  }
  // --- barriers: thick stitched strokes across the groove ---
  if (k < G.n) for (const b of G.rings[k].barriers) {
    const x = X(b);
    const yTop = Y(rWall - t / 2) - 2, yBot = Y(rIn) + 2;
    const wpx = 0.26 * pxPerUnitAt(rGroove);
    brush(g, wline(x, yTop, x + (rng() - 0.5) * 6, yBot, 14, 2.5, rng), wpx * 1.2, wpx, rng, { bristles: 4 });
    // cross stitches
    for (let s = 0; s < 3; s++) {
      const y = lerp(yTop, yBot, (s + 0.6) / 3.6);
      brush(g, wline(x - wpx * 1.6, y - 4, x + wpx * 1.6, y + 4, 4, 1, rng), 2.2, 1.6, rng, { bristles: 0 });
    }
  }
  // --- the centre: the last wall and the pupil, with olive fibres of an iris ---
  if (k >= G.n) {
    const rp = G.Ri * RULES.pupilFrac;
    // iris fibres between pupil and wall
    for (let i = 0; i < W / 3; i++) {
      const x = rng() * W;
      const y0 = Y(rp + 0.02), y1 = Y(rp + (G.Ri - t / 2 - rp) * (0.4 + rng() * 0.6));
      g.strokeStyle = rng() < 0.6 ? PAL.olive : PAL.oliveDeep; g.globalAlpha = 0.35 + rng() * 0.4; g.lineWidth = 1 + rng() * 2;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (rng() - 0.5) * 10, y1); g.stroke();
    }
    g.globalAlpha = 1; g.fillStyle = PAL.ink;
    inkBand(g, 0, W, Y(rp + 0.06), H + 2, rng, 6);
  }
  return c;
}

// The world outside the spiral: older rings that have closed, in a dark field.
function makeVoidCanvas(G, def, canvas, size) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const rng = makeRng((def.seed || 3) * 17 + 5);
  const R = 13.5, s = size / (2 * R);
  const cx = size / 2, cy = size / 2;
  g.fillStyle = PAL.void; g.fillRect(0, 0, size, size);
  // faint paper texture showing through the ink
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = PAL.bone; g.globalAlpha = rng() * 0.035;
    g.fillRect(rng() * size, rng() * size, 1 + rng() * 3, 1 + rng() * 3);
  }
  // dead rings: the spiral continues outward, closed, drawn in grey-on-black
  for (let r = G.Ro + 0.35; r < R; r += 0.55 + rng() * 0.5) {
    const pts = [];
    let w = 0;
    const n = Math.round(r * 40);
    for (let i = 0; i <= n; i++) { const a = i / n * TAU; w += (rng() - 0.5) * 0.06; w *= 0.95; pts.push([cx + (r + w) * s * Math.cos(a), cy - (r + w) * s * Math.sin(a)]); }
    brush(g, pts, 1.5 + rng() * 2, 1 + rng() * 2, rng, { color: PAL.bone, alpha: 0.05 + 0.1 * clamp(1 - (r - G.Ro) / 6, 0, 1), bristles: 2 });
  }
  // a single hairline at the boundary, so the spiral's edge is never ambiguous
  g.globalAlpha = 1;
  g.strokeStyle = PAL.bone; g.globalAlpha = 0.25; g.lineWidth = 1.2;
  g.beginPath(); g.arc(cx, cy, (G.Ro + 0.12) * s, 0, TAU); g.stroke();
  g.globalAlpha = 1;
  return c;
}

// ---------- shaders ----------
const GLSL_NOISE = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
`;

function makeRingMaterial(THREE, tex, rIn, rOut, isCentre) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, rIn: { value: rIn }, rOut: { value: rOut }, time: { value: 0 }, dread: { value: 0 }, fade: { value: 1 }, paper: { value: new THREE.Color(PAL.bone) }, paper2: { value: new THREE.Color(PAL.ivory) }, wobble: { value: 1 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLSL_NOISE + `
      uniform sampler2D map; uniform float rIn, rOut, time, dread, fade, wobble; uniform vec3 paper, paper2; varying vec2 vP;
      void main(){
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        // drawn lines breathe a little; more as the spiral closes in
        float wob = (0.012 + 0.05 * dread) * wobble * (vnoise(vec2(a * 6.0, time * 0.35 + r)) - 0.5);
        float rr = r + wob;
        float v = clamp((rOut - rr) / (rOut - rIn), 0.002, 0.998);
        float u = fract(a / 6.2831853);
        vec4 ink = texture2D(map, vec2(u, 1.0 - v));
        float grain = vnoise(vP * 9.0) * 0.6 + vnoise(vP * 31.0) * 0.4;
        vec3 base = mix(paper, paper2, smoothstep(0.35, 0.85, vnoise(vP * 0.7 + 3.0))) * (0.93 + 0.07 * grain);
        ${isCentre ? '' : ''}
        vec3 col = mix(base, ink.rgb, ink.a);
        col *= fade;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// Eyes: one instanced quad each, drawn entirely in the fragment shader.
// type ids
const EYE_ID = { watcher: 0, drifter: 1, collector: 2, liar: 3, mimic: 4, sentinel: 5, warden: 6, choir: 7, crown: 8, falseeye: 9, unblinking: 10, echo: 11, decor: 12 };
function makeEyeMaterial(THREE) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, fade: { value: 1 } },
    vertexShader: `
      attribute vec4 iA; // x, y, rad, rot
      attribute vec4 iB; // type, open, pupilX, pupilY
      attribute vec4 iC; // pupilSize, pinned(0..1), stunned, smear
      attribute vec4 iD; // target(0..1), feign, dead, dim
      attribute vec4 iE; // seed, wall(0/1), stare, knot
      varying vec2 vP; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec4 vE;
      void main(){
        float s = iA.z * 1.9;
        float c = cos(iA.w), sn = sin(iA.w);
        vec2 q = position.xy * s;
        vec2 w = vec2(iA.x + q.x * c - q.y * sn, iA.y + q.x * sn + q.y * c);
        vP = position.xy * 1.9; vB = iB; vC = iC; vD = iD; vE = iE;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 0.0, 1.0);
      }`,
    fragmentShader: GLSL_NOISE + `
      uniform float time, fade;
      varying vec2 vP; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec4 vE;
      float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
      void main(){
        float type = vB.x; float open = vB.y; vec2 pup = vB.zw;
        float psz = vC.x, pinned = vC.y, stun = vC.z, smear = vC.w;
        float tgt = vD.x, feign = vD.y, dead = vD.z, dim = vD.w;
        float seed = vE.x, inWall = vE.y, stare = vE.z, knot = vE.w;
        vec2 p = vP;
        // --- shape by type ---
        float Wd = 1.0, Hu = 0.62, Hl = 0.48, ex = 0.8, ir = 0.42, round_ = 0.0;
        if (abs(type - 1.0) < 0.5) { Hu = 0.55; Hl = 0.45; ir = 0.36; }               // drifter: heavy
        if (abs(type - 2.0) < 0.5) { Hu = 0.8; Hl = 0.8; ex = 0.55; ir = 0.55; }      // collector: round, many pupils
        if (abs(type - 3.0) < 0.5) { Hu = 0.42; Hl = 0.34; ex = 1.1; ir = 0.36; }     // liar: narrow
        if (abs(type - 5.0) < 0.5) { Hu = 0.5; Hl = 0.5; ex = 1.4; ir = 0.34; }       // sentinel: a slit
        if (abs(type - 7.0) < 0.5 || abs(type - 8.0) < 0.5) { Hu = 0.85; Hl = 0.85; ex = 0.5; ir = 0.5; }
        if (abs(type - 10.0) < 0.5) { Hu = 1.0; Hl = 1.0; ex = 0.5; ir = 0.72; open = 1.0; }  // unblinking: lidless
        if (abs(type - 11.0) < 0.5) { Hu = 0.58; Hl = 0.46; }
        // a stunned eye droops; a held one is pinned half-tense
        open *= mix(1.0, 0.45, stun);
        float x = p.x / Wd;
        float prof = pow(max(0.0, 1.0 - x * x), ex);
        // brush wobble on the lids
        float nz = vnoise(vec2(x * 3.0 + seed * 7.0, seed)) - 0.5;
        float up = Hu * prof * open + nz * 0.04;
        float lo = -Hl * prof * open + nz * 0.03;
        float inside = step(abs(x), 1.0) * step(p.y, up) * step(lo, p.y);
        float th = 0.085 + 0.035 * (vnoise(vec2(x * 5.0, seed * 3.0)) - 0.2) + 0.03 * tgt;
        if (abs(type - 10.0) < 0.5) th += 0.04 * (vnoise(vec2(atan(p.y, p.x) * 4.0, seed)) );
        float edge = 0.0;
        if (abs(x) < 1.04) {
          float dU = abs(p.y - up), dL = abs(p.y - lo);
          edge = max(1.0 - smoothstep(th * 0.6, th, dU), (1.0 - smoothstep(th * 0.5, th * 0.9, dL)) * (open > 0.05 ? 1.0 : 0.0));
        }
        // corners
        edge = max(edge, 1.0 - smoothstep(th * 0.35, th * 0.7, length(p - vec2(Wd, 0.0))));
        edge = max(edge, 1.0 - smoothstep(th * 0.35, th * 0.7, length(p - vec2(-Wd, 0.0))));
        // --- sclera, iris, pupil ---
        vec3 col = vec3(0.925, 0.894, 0.824);
        float alpha = 0.0;
        if (inside > 0.5) {
          alpha = 1.0;
          // hatched shade under the upper lid
          float shade = smoothstep(0.0, 0.35, (up - p.y)) ;
          float hatch = step(0.55, fract((p.x * 0.7 + p.y) * 9.0 + seed));
          col *= 1.0 - (1.0 - shade) * 0.35 * hatch;
          if (abs(type - 1.0) < 0.5 || abs(type - 8.0) < 0.5) col = mix(col, vec3(0.80, 0.78, 0.62), 0.25);
          vec2 c = pup;
          float d = length(p - c);
          float irr = ir;
          if (d < irr) {
            float ang = atan(p.y - c.y, p.x - c.x);
            float fib = vnoise(vec2(ang * 9.0, d * 6.0 + seed));
            vec3 irisC = mix(vec3(0.34, 0.33, 0.30), vec3(0.49, 0.48, 0.27), step(0.5, mod(type, 2.0)) * 0.6 + 0.2);
            if (abs(type - 10.0) < 0.5) irisC = vec3(0.30, 0.29, 0.25) + 0.12 * step(0.5, fract(d * 9.0));
            col = mix(col, irisC * (0.75 + 0.5 * fib), 0.9);
            if (d > irr - 0.06) col = vec3(0.06);
          }
          // pupil
          float ps = (0.18 + 0.12 * psz) * (1.0 - 0.35 * pinned) * (1.0 + 0.6 * stare);
          float pd;
          if (abs(type - 3.0) < 0.5) { vec2 q = (p - c) / vec2(1.8, 0.55); pd = length(q) - ps * 0.9; }      // liar: a goat's bar
          else if (abs(type - 5.0) < 0.5) { vec2 q = (p - c) / vec2(0.45, 1.6); pd = length(q) - ps; }      // sentinel: slit
          else if (abs(type - 2.0) < 0.5) {                                                                // collector: three
            pd = 9.0; for (int i = 0; i < 3; i++) { float a = float(i) * 2.094 + seed; pd = min(pd, length(p - c - 0.2 * vec2(cos(a), sin(a))) - ps * 0.55); }
          }
          else pd = d - ps;
          if (stun > 0.01) { // a stunned pupil swirls
            float ang = atan(p.y - c.y, p.x - c.x);
            pd = mix(pd, abs(fract((ang / 6.283) + d * 4.0 - time * 0.5) - 0.5) * 0.25 - 0.04 + d * 0.2 - ps * 0.6, stun);
          }
          if (pd < 0.0) col = vec3(0.03);
          // catchlight for the human-like
          if ((abs(type) < 0.5 || abs(type - 4.0) < 0.5 || abs(type - 6.0) < 0.5) && length(p - c - vec2(-0.09, 0.1)) < 0.05) col = vec3(0.95);
          // a false eye seen for what it is: the drawing runs
          col = mix(col, vec3(0.6, 0.58, 0.52), smear * 0.6);
        }
        float ink = edge;
        // lashes on the upper lid (watcher, liar, mimic, warden, sentinel) — long and curling for the liar
        if ((abs(type) < 0.5 || abs(type - 3.0) < 0.5 || abs(type - 4.0) < 0.5 || abs(type - 6.0) < 0.5 || abs(type - 11.0) < 0.5) && open > 0.02) {
          for (int i = 0; i < 7; i++) {
            float fx = -0.75 + float(i) * 0.25;
            float py = Hu * pow(max(0.0, 1.0 - fx * fx), ex) * open;
            float L = abs(type - 3.0) < 0.5 ? 0.42 : 0.24;
            float tremble = feign * 0.08 * sin(time * 30.0 + float(i) * 2.0);
            vec2 a = vec2(fx, py), b = a + vec2(fx * 0.35 + tremble, L);
            ink = max(ink, 1.0 - smoothstep(0.025, 0.05, seg(p, a, b)));
          }
        }
        // a closed eye: one curved stroke with lashes hanging down
        if (open < 0.06 && dead < 0.5) {
          for (int i = 0; i < 5; i++) {
            float fx = -0.6 + float(i) * 0.3;
            vec2 a = vec2(fx, 0.0), b = a + vec2(fx * 0.2, -0.22);
            ink = max(ink, 1.0 - smoothstep(0.02, 0.045, seg(p, a, b)));
          }
        }
        // drifter: heavy folds above
        if (abs(type - 1.0) < 0.5) {
          float f1 = abs(p.y - (Hu * prof * open + 0.18 + 0.05 * sin(x * 3.0 + seed))) ;
          ink = max(ink, step(abs(x), 0.8) * (1.0 - smoothstep(0.02, 0.05, f1)));
        }
        // crown: spikes
        if (abs(type - 8.0) < 0.5) {
          for (int i = 0; i < 5; i++) {
            float fx = -0.7 + float(i) * 0.35;
            float py = Hu * pow(max(0.0, 1.0 - fx * fx), ex) * open;
            ink = max(ink, 1.0 - smoothstep(0.03, 0.06, seg(p, vec2(fx, py), vec2(fx * 1.2, py + 0.38))));
          }
        }
        // pins: held eyes are pinned like specimens — short radial strokes that grow while acquiring
        if (pinned > 0.01) {
          for (int i = 0; i < 6; i++) {
            float a = float(i) * 1.0472 + 0.5;
            vec2 dir = vec2(cos(a), sin(a));
            vec2 a0 = dir * vec2(1.05, max(Hu, 0.5) * 1.15);
            vec2 b0 = a0 + dir * 0.42 * pinned;
            ink = max(ink, 1.0 - smoothstep(0.03, 0.065, seg(p, a0, b0)));
          }
        }
        // a dead eye: stitched shut
        if (dead > 0.5) {
          ink = max(ink, (1.0 - smoothstep(0.04, 0.08, abs(p.y - 0.1 * (1.0 - x * x)))) * step(abs(x), 1.0));
          for (int i = 0; i < 4; i++) { float fx = -0.6 + float(i) * 0.4; ink = max(ink, 1.0 - smoothstep(0.03, 0.06, seg(p, vec2(fx - 0.1, -0.2), vec2(fx + 0.1, 0.3)))); }
          col = vec3(0.5); alpha = 0.0;
        }
        // false eye drips
        if (smear > 0.01) {
          float drip = step(abs(fract(x * 2.5 + seed) - 0.5), 0.08) * step(p.y, lo) * step(lo - 0.9 * smear * (0.5 + hash(vec2(floor(x * 2.5 + seed), seed))), p.y);
          ink = max(ink, drip * 0.8);
        }
        // wall eyes get a pale halo so they read against ink
        float halo = 0.0;
        if (inWall > 0.5) { float hp = pow(max(0.0, 1.0 - (x * x) / 1.25), ex); float hu = Hu * hp * max(open, 0.3) + 0.18; halo = step(abs(x), 1.15) * step(p.y, hu) * step(-hu, p.y); }
        float a = max(alpha, ink);
        a = max(a, halo * 0.9);
        vec3 c3 = mix(col, vec3(0.04), ink);
        if (halo > 0.5 && alpha < 0.5 && ink < 0.5) c3 = vec3(0.86, 0.82, 0.73);
        if (a < 0.02) discard;
        float al = a * (1.0 - dim * 0.55) * fade;
        if (abs(type - 11.0) < 0.5) { c3 = mix(c3, vec3(0.62, 0.62, 0.6), 0.45); al *= 0.85; }
        gl_FragColor = vec4(c3, al);
      }`,
  });
}

// The traveller: a small standing figure, drawn from signed distances so it can lean,
// turn its head toward its gaze, breathe, flinch, and be swallowed by ink.
function makeFigureMaterial(THREE) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, face: { value: 1 }, look: { value: new THREE.Vector2(1, 0) }, walk: { value: 0 }, speed: { value: 0 }, fear: { value: 0 }, ink: { value: 0 }, exposure: { value: 0 }, lean: { value: 0 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLSL_NOISE + `
      uniform float time, face, walk, speed, fear, ink, exposure, lean; uniform vec2 look; varying vec2 vP;
      float cap(vec2 p, vec2 a, vec2 b, float r){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
      void main(){
        // figure space: feet at y=0, head near y=1.0, facing +x when face=1
        vec2 p = vP; p.x *= face;
        float breath = sin(time * 2.1) * 0.012 * (1.0 + fear * 1.5);
        float hunch = fear * 0.08;
        float sw = sin(walk) * speed;
        p.x -= lean * p.y * 0.12 * face;
        // legs
        float d = cap(p, vec2(0.0, 0.42), vec2(0.07 + sw * 0.12, 0.02), 0.045);
        d = min(d, cap(p, vec2(0.0, 0.42), vec2(-0.06 - sw * 0.12, 0.02), 0.045));
        // a long coat: narrow at rounded shoulders, flaring to the hem, a little ragged
        float cy = p.y - breath;
        float k = clamp((cy - 0.27) / 0.49, 0.0, 1.0);
        float halfW = mix(0.16, 0.065, pow(k, 0.8)) + 0.012 * (vnoise(vec2(cy * 18.0, 2.0)) - 0.5) - hunch * 0.2 * k;
        float coat = max(abs(p.x + hunch * k * 0.3) - halfW, max(0.27 + 0.02 * sin(p.x * 40.0) - cy, cy - 0.76));
        float shoulders = cap(p, vec2(-0.055, 0.735 + breath), vec2(0.055, 0.735 + breath), 0.042);
        float hres = 0.03;
        d = min(d, -log(exp(-coat / hres) + exp(-shoulders / hres)) * hres);
        // arms, close to the body; held tighter when afraid
        d = min(d, cap(p, vec2(0.05, 0.74 + breath), vec2(0.1 - fear * 0.04 + sw * 0.05, 0.47 + fear * 0.1), 0.035));
        d = min(d, cap(p, vec2(-0.05, 0.74 + breath), vec2(-0.09 + fear * 0.04 - sw * 0.05, 0.47 + fear * 0.1), 0.035));
        // neck and head, turned and tilted toward the gaze
        vec2 lk = look; lk.x *= face;
        vec2 hc = vec2(0.02 + hunch * 0.6 + lk.x * 0.035, 0.9 + breath - hunch + lk.y * 0.04);
        d = min(d, cap(p, vec2(0.0, 0.76 + breath), hc - vec2(0.0, 0.05), 0.04));
        float head = length((p - hc) / vec2(1.0, 1.12)) - 0.092;
        d = min(d, head);
        // face direction: a nick of white where the eye is, on the side it looks
        vec2 eyeP = hc + vec2(0.045 * sign(lk.x + 0.001) * min(1.0, abs(lk.x) * 2.0 + 0.3), 0.012 + lk.y * 0.02);
        float eyeD = length(p - eyeP) - 0.016;
        // outline in bone so the figure reads on ink, body in ink so it reads on paper
        float outline = 1.0 - smoothstep(0.0, 0.035, d);
        float body = 1.0 - smoothstep(-0.012, 0.0, d);
        vec3 col = vec3(0.9, 0.87, 0.79);
        col = mix(col, vec3(0.04), body);
        if (eyeD < 0.0 && body > 0.5) col = vec3(0.92);
        // exposure: ink veins climbing the figure
        float veins = step(0.72, vnoise(p * 28.0 + time)) * exposure * body;
        col = mix(col, vec3(0.42, 0.41, 0.22), veins * 0.0);
        float a = max(outline * 0.95, body);
        // capture: ink rises and takes the figure
        float n = vnoise(p * 14.0 + vec2(0.0, -time * 2.0));
        float flood = step(p.y + n * 0.25, ink * 1.4);
        col = mix(col, vec3(0.02), flood);
        a = max(a, flood * smoothstep(0.55, 0.3, length(p - vec2(0.0, 0.5))) );
        if (a < 0.02) discard;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

// A tapered strip from the traveller's eye to what they watch: graphite when looking,
// an ink thread when it holds.
function makeThreadMaterial(THREE) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, held: { value: 0 }, len: { value: 1 }, alpha: { value: 1 } },
    vertexShader: `attribute float t; attribute float side; varying float vT; varying float vS; void main(){ vT = t; vS = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLSL_NOISE + `
      uniform float time, held, len, alpha; varying float vT; varying float vS;
      void main(){
        float dash = step(0.45, fract(vT * len * 3.0 - time * 0.6));
        float a = mix(0.35 * dash * (1.0 - vT * 0.7), 0.85, held);
        float core = 1.0 - smoothstep(0.2, 1.0, abs(vS));
        a *= core * alpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(vec3(0.33, 0.31, 0.28), vec3(0.03), held), a);
      }`,
  });
}

// A sentinel's sight: diagonal ink hatching inside the fan, darkening when it sees you.
function makeConeMaterial(THREE) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `attribute float aT; attribute float aSeen; varying float vT; varying float vSeen; varying vec2 vW; void main(){ vT = aT; vSeen = aSeen; vW = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time; varying float vT; varying float vSeen; varying vec2 vW;
      void main(){
        float h = step(0.62, fract((vW.x - vW.y) * 3.2 + time * 0.15));
        float h2 = step(0.8, fract((vW.x + vW.y) * 3.2)) * vSeen;
        float a = (h * 0.32 + h2 * 0.35) * (1.0 - smoothstep(0.65, 1.0, vT)) * (0.55 + 0.45 * vSeen);
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(vec3(0.05), vec3(0.30, 0.29, 0.13), vSeen * 0.7), a);
      }`,
  });
}
