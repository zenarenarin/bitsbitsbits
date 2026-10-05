window.plethoraBit = {
  meta: {
    title: "HOLE",
    runtime: "plethora-bit@2",
    tags: ["arcade", "3d", "shapes", "motion"],
    permissions: ["motion", "haptics", "backgroundMusic"]
  },

  async init(ctx) {
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    // ------------------------------------------------------------------
    // RULES (kept deliberately small):
    //  1. Every piece is hole-sized. SAME SHAPE drops in. Size never matters.
    //  2. A piece with a badge on top turns the hole into the badge's shape.
    //  3. A WRONG shape sliding over the hole cracks it. Black shards crack it.
    //     Going hungry (ring around the hole runs out) cracks it.
    //  4. Three cracks and the hole collapses. Run over.
    // Geometry: every outline is a polygon on the XZ plane (angle = atan2(z,x)).
    // The aperture is a radial function sampled N times; slab cut-out, shaft,
    // rim and the morph all read the same samples.
    // ------------------------------------------------------------------
    const TAU = Math.PI * 2;
    const N = 120;
    const R0 = 1.05;
    const A0 = Math.PI * R0 * R0;     // aperture area: the hole changes shape, never size
    const PIECE_FILL = 0.66;          // every piece covers 66% of the aperture
    const AX = 4.0;
    const SLAB_HX = 4.65, SLAB_Z0 = -8.3, SLAB_Z1 = 8.1;
    const Z_BACK = -7.6, Z_SPAWN = -6.9, Z_EDGE = SLAB_Z1 + 0.25;
    const HOLE_COL_R = 0.92;
    const VMAX = 8.0, AMAX = 40, KP = 11;   // identical for touch and motion
    const EAT_R = 0.42, HIT_R = 0.66, SHARD_R = 0.72;
    const ALIGN_TOL = 0.2;            // ~11deg: spinning pieces drop in when lined up
    const MAX_LIVES = 3;

    const rand = Math.random;
    const rr = (a, b) => a + rand() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];

    function regular(n, r, startDeg) {
      const p = [];
      for (let i = 0; i < n; i++) {
        const a = ((startDeg + (360 * i) / n) * Math.PI) / 180;
        p.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return p;
    }
    function starPoly(n, ro, ri, startDeg) {
      const p = [];
      for (let i = 0; i < n * 2; i++) {
        const a = ((startDeg + (180 * i) / n) * Math.PI) / 180;
        const r = i % 2 === 0 ? ro : ri;
        p.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return p;
    }
    function jagged(n, lo, hi) {
      const p = [];
      for (let i = 0; i < n; i++) {
        const a = ((i + rr(-0.25, 0.25)) / n) * TAU;
        const r = rr(lo, hi);
        p.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return p;
    }
    function polyArea(p) {
      let s = 0;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        s += a[0] * b[1] - b[0] * a[1];
      }
      return Math.abs(s) / 2;
    }
    function scaled(p, area) {
      const k = Math.sqrt(area / polyArea(p));
      return p.map(([x, z]) => [x * k, z * k]);
    }
    function radial(p, th) {
      const dx = Math.cos(th), dz = Math.sin(th);
      let best = Infinity;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        const ex = b[0] - a[0], ez = b[1] - a[1];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (a[0] * ez - ex * a[1]) / den;
        const u = (dx * a[1] - dz * a[0]) / -den;
        if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
      }
      return best === Infinity ? 0 : best;
    }
    function radialTable(p) {
      const out = new Float32Array(N);
      for (let i = 0; i < N; i++) out[i] = radial(p, (TAU * i) / N);
      return out;
    }
    // signed yaw error to the nearest orientation where a shape lines up with the hole
    function alignErr(yaw, sym) {
      if (!sym) return 0;
      let a = ((yaw % sym) + sym) % sym;
      if (a > sym / 2) a -= sym;
      return a;
    }

    const SHAPES = {
      circle:   { name: "CIRCLE",   poly: regular(40, 1, 0),          sym: 0,           color: "#2f5d9e" },
      triangle: { name: "TRIANGLE", poly: regular(3, 1, -90),         sym: TAU / 3,     color: "#c4472f" },
      square:   { name: "SQUARE",   poly: regular(4, 1, 45),          sym: TAU / 4,     color: "#d79a1e" },
      star:     { name: "STAR",     poly: starPoly(5, 1, 0.52, -90),  sym: TAU / 5,     color: "#c95f8c" },
      slot:     { name: "SLOT",     poly: [[1.5, 0.58], [-1.5, 0.58], [-1.5, -0.58], [1.5, -0.58]], sym: Math.PI, color: "#3f8f6a" }
    };
    const UNLOCK = [["circle", 0], ["triangle", 0], ["square", 24], ["star", 70], ["slot", 115]];
    const BASE = {};
    Object.keys(SHAPES).forEach((k) => { BASE[k] = radialTable(scaled(SHAPES[k].poly, A0)); });

    function shapeSvg(key, size, color) {
      const p = scaled(SHAPES[key].poly, Math.PI * 0.75);
      const pts = p.map(([x, z]) => `${(x * 10 + 12).toFixed(2)},${(z * 10 + 12).toFixed(2)}`).join(" ");
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block"><polygon points="${pts}" fill="${color || SHAPES[key].color}"/></svg>`;
    }
    const ringSvg = (on) => `<svg width="20" height="20" viewBox="0 0 20 20" style="display:block"><circle cx="10" cy="10" r="7" fill="${on ? "#1f1c18" : "none"}" stroke="#1f1c18" stroke-width="2" ${on ? "" : 'stroke-dasharray="3 3" opacity=".45"'}/></svg>`;

    // ------------------------------------------------------------------
    // DOM HUD
    // ------------------------------------------------------------------
    const INK = "#1f1c18", PAPER = "#efe9df";
    const ui = ctx.createRoot({
      layer: "overlay", input: "passthrough",
      style: `font-family: ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif; color:${INK}; user-select:none; -webkit-user-select:none;`
    });
    ui.innerHTML = `
<style>
  .h-btn{pointer-events:auto;cursor:pointer;border:1.5px solid ${INK};background:${PAPER};color:${INK};font:inherit;font-weight:700;letter-spacing:.14em;text-transform:uppercase;border-radius:999px;padding:12px 22px;font-size:13px}
  .h-btn.on{background:${INK};color:${PAPER}}
  .h-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:rgba(232,226,216,.88);pointer-events:auto;text-align:center;padding:24px}
  .h-cap{font-size:11px;letter-spacing:.24em;text-transform:uppercase;opacity:.6}
  .h-card{pointer-events:auto;cursor:pointer;width:min(40vw,170px);border:1.5px solid ${INK};border-radius:22px;background:${PAPER};padding:14px 10px 16px;display:flex;flex-direction:column;align-items:center;gap:8px}
  .h-card b{font-size:17px;letter-spacing:.18em}
  .h-card span{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.65}
  .h-rule{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;text-align:left}
  @keyframes hSlide{0%,100%{transform:translateX(-22px)}50%{transform:translateX(22px)}}
  @keyframes hPhone{0%,100%{transform:rotate(-16deg)}50%{transform:rotate(16deg)}}
  .a-f{animation:hSlide 2.2s ease-in-out infinite}
  .a-ht{animation:hSlide 2.2s ease-in-out infinite;animation-delay:.12s}
  .a-p{animation:hPhone 2.2s ease-in-out infinite;transform-origin:50px 40px;transform-box:view-box}
  .a-hm{animation:hSlide 2.2s ease-in-out infinite;animation-delay:.25s}
  @keyframes hRing{from{stroke-dashoffset:126}to{stroke-dashoffset:0}}
  @keyframes hTip{0%{opacity:0;transform:translateY(4px)}12%,85%{opacity:1;transform:none}100%{opacity:0}}
</style>
<div data-k="hud" style="position:absolute;left:0;right:0;top:0;display:none;padding:14px 16px 0;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
    <div style="min-width:96px">
      <div data-k="score" style="font-size:30px;font-weight:800;letter-spacing:-.02em;line-height:1">0</div>
      <div data-k="lives" style="display:flex;gap:4px;margin-top:8px"></div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:2px">
      <div data-k="flow" style="font-size:13px;font-weight:800;letter-spacing:.2em;opacity:0;transition:opacity .2s">FLOW \u00d7 01</div>
      <div data-k="next" style="display:none;align-items:center;gap:7px;border:1.5px solid ${INK};border-radius:999px;padding:4px 10px 4px 6px;background:rgba(239,233,223,.85)"></div>
    </div>
    <button class="h-btn" data-k="pause" style="padding:8px 13px;font-size:12px;letter-spacing:.1em">II</button>
  </div>
  <div style="display:flex;justify-content:center;margin-top:10px"><div data-k="tip" style="font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;background:${INK};color:${PAPER};border-radius:999px;padding:7px 14px;opacity:0"></div></div>
</div>
<div data-k="tilt" style="position:absolute;left:16px;display:none;width:44px;height:44px;border:1.5px solid rgba(31,28,24,.45);border-radius:50%">
  <div data-k="tiltdot" style="position:absolute;left:17px;top:17px;width:10px;height:10px;border-radius:50%;background:${INK}"></div>
</div>
<div class="h-panel" data-k="select" style="display:flex;background:rgba(232,226,216,.72)">
  <div style="font-size:54px;font-weight:900;letter-spacing:.3em;margin-right:-.3em">HOLE</div>
  <div style="display:flex;flex-direction:column;gap:7px;margin:2px 0 4px">
    <div class="h-rule">${shapeSvg("triangle", 20)}<span style="opacity:.5">\u2192</span>${shapeSvg("triangle", 20, "#1f1c18")}<span>same shape drops in</span></div>
    <div class="h-rule"><span style="display:inline-flex;position:relative;width:20px;height:20px">${shapeSvg("square", 20)}<span style="position:absolute;left:5px;top:5px">${shapeSvg("triangle", 10, "#f3eee6")}</span></span><span style="opacity:.5">\u2192</span>${shapeSvg("triangle", 20, "#1f1c18")}<span>badge = what you become</span></div>
    <div class="h-rule">${shapeSvg("square", 20)}<span style="opacity:.5">\u2715</span>${shapeSvg("triangle", 20, "#1f1c18")}<span>wrong shape cracks it</span></div>
  </div>
  <div class="h-cap">how do you want to move it?</div>
  <div style="display:flex;gap:14px">
    <div class="h-card" data-k="pickTouch">
      <svg width="110" height="70" viewBox="0 0 110 80"><ellipse cx="55" cy="58" rx="40" ry="10" fill="rgba(31,28,24,.08)"/>
        <g class="a-ht"><ellipse cx="55" cy="58" rx="12" ry="5" fill="${INK}"/></g>
        <g class="a-f"><circle cx="55" cy="26" r="9" fill="none" stroke="${INK}" stroke-width="2"/><circle cx="55" cy="26" r="3" fill="${INK}"/></g></svg>
      <b>TOUCH</b><span>drag to move</span>
    </div>
    <div class="h-card" data-k="pickMotion">
      <svg width="110" height="70" viewBox="0 0 110 80"><ellipse cx="55" cy="66" rx="40" ry="9" fill="rgba(31,28,24,.08)"/>
        <g class="a-hm"><ellipse cx="55" cy="66" rx="11" ry="4.5" fill="${INK}"/></g>
        <g class="a-p"><rect x="30" y="34" width="50" height="12" rx="4" fill="none" stroke="${INK}" stroke-width="2"/></g></svg>
      <b>MOTION</b><span>tilt to move</span>
    </div>
  </div>
  <div data-k="selectNote" class="h-cap" style="min-height:14px;opacity:.8"></div>
  <button class="h-btn" data-k="simBtn" style="display:none;font-size:10px;padding:8px 14px">simulate tilt with arrow keys (dev)</button>
</div>
<div class="h-panel" data-k="calib">
  <svg width="64" height="64" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="none" stroke="rgba(31,28,24,.18)" stroke-width="3"/>
    <circle data-k="ring" cx="24" cy="24" r="20" fill="none" stroke="${INK}" stroke-width="3" stroke-dasharray="126" stroke-dashoffset="126" transform="rotate(-90 24 24)"/></svg>
  <div style="font-size:22px;font-weight:800;letter-spacing:.22em">HOLD PHONE LEVEL</div>
  <div class="h-cap">this becomes centre</div>
</div>
<div class="h-panel" data-k="pausePanel">
  <div style="font-size:26px;font-weight:900;letter-spacing:.3em">PAUSED</div>
  <div class="h-cap">control</div>
  <div style="display:flex;gap:10px"><button class="h-btn" data-k="mTouch">Touch</button><button class="h-btn" data-k="mMotion">Motion</button></div>
  <div data-k="motionOpts" style="display:flex;gap:10px"><button class="h-btn" data-k="recal" style="font-size:11px">Recentre</button><button class="h-btn" data-k="invert" style="font-size:11px">Invert tilt</button></div>
  <div data-k="pauseNote" class="h-cap" style="min-height:14px"></div>
  <div style="display:flex;gap:10px;margin-top:10px"><button class="h-btn on" data-k="resume">Resume</button><button class="h-btn" data-k="restart">Restart</button></div>
</div>
<div class="h-panel" data-k="over">
  <div class="h-cap" data-k="cause">the hole collapsed</div>
  <div data-k="finalScore" style="font-size:64px;font-weight:900;letter-spacing:-.03em;line-height:1">0</div>
  <div data-k="best" class="h-cap"></div>
  <div class="h-cap" style="margin-top:8px">it became</div>
  <div data-k="history" style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;max-width:300px"></div>
  <button class="h-btn on" data-k="again" style="margin-top:14px;font-size:16px;padding:14px 34px">Again</button>
  <button class="h-btn" data-k="changeCtl" style="font-size:10px;padding:8px 14px">change control</button>
</div>`;
    const el = {};
    ["hud", "score", "lives", "flow", "next", "tip", "pause", "tilt", "tiltdot", "select", "pickTouch", "pickMotion",
      "selectNote", "simBtn", "calib", "ring", "pausePanel", "mTouch", "mMotion", "motionOpts", "recal", "invert",
      "pauseNote", "resume", "restart", "over", "cause", "finalScore", "best", "history", "again", "changeCtl"
    ].forEach((k) => { el[k] = ui.querySelector(`[data-k="${k}"]`); });

    // ------------------------------------------------------------------
    // Three.js scene
    // ------------------------------------------------------------------
    const THREE = await ctx.importModule("three", "0.164.1");
    if (disposed) return;

    const canvas = ctx.createCanvas({ layer: "content", touchAction: "none" });
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(ctx.dpr || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#d9d2c6");
    const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 120);
    ctx.onDestroy(() => {
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
    });

    scene.add(new THREE.HemisphereLight("#fffaf0", "#a89d8c", 1.5));
    const sun = new THREE.DirectionalLight("#ffffff", 2.1);
    sun.position.set(-5, 14, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 11, bottom: -11, near: 1, far: 40 });
    sun.shadow.bias = -0.0008;
    sun.shadow.radius = 3;
    scene.add(sun);

    const rDisp = new Float32Array(N);
    const rVel = new Float32Array(N);
    const rTarget = new Float32Array(N);
    const hole = {
      x: 0, z: 3.4, vx: 0, vz: 0, yaw: 0, tx: 0, tz: 3.4,
      shape: "circle", from: "circle", m: 1, scale: 1, pulse: 0, hit: 0,
      lives: MAX_LIVES, invuln: 0, hunger: 12, hungerMax: 12
    };
    for (let i = 0; i < N; i++) rDisp[i] = BASE.circle[i];
    const holeUniforms = { uR: { value: rDisp }, uHole: { value: new THREE.Vector2(hole.x, hole.z) }, uYaw: { value: 0 } };

    // slab: plaster block with the aperture cut out per-fragment
    const slabMat = new THREE.MeshLambertMaterial({ color: "#ece6db" });
    slabMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, holeUniforms);
      sh.vertexShader = "varying vec2 vHW;\n" + sh.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n vHW = (modelMatrix * vec4(transformed, 1.0)).xz;"
      );
      sh.fragmentShader = `uniform float uR[${N}];
uniform vec2 uHole;
uniform float uYaw;
varying vec2 vHW;
float apR(float th){
  float f = mod(th, 6.2831853) / 6.2831853 * ${N}.0;
  int a = int(floor(f)); float t = f - floor(f);
  a = a - (a / ${N}) * ${N};
  int b = a + 1; if (b >= ${N}) b = 0;
  return mix(uR[a], uR[b], t);
}
` + sh.fragmentShader.replace("void main() {", `void main() {
  vec2 d = vHW - uHole;
  float c = cos(uYaw), s = sin(uYaw);
  vec2 l = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
  if (length(l) < apR(atan(l.y, l.x))) discard;`);
    };
    const slab = new THREE.Mesh(new THREE.BoxGeometry(SLAB_HX * 2, 4.6, SLAB_Z1 - SLAB_Z0), slabMat);
    slab.position.set(0, -2.3, (SLAB_Z0 + SLAB_Z1) / 2);
    slab.receiveShadow = true;
    scene.add(slab);

    const railMat = new THREE.MeshLambertMaterial({ color: "#c7bfb2" });
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, SLAB_Z1 - SLAB_Z0 - 0.4), railMat);
      rail.position.set(sx * (AX + 0.36), 0.18, (SLAB_Z0 + SLAB_Z1) / 2 - 0.2);
      rail.castShadow = true; rail.receiveShadow = true;
      scene.add(rail);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(SLAB_HX * 2, 0.55, 0.4), railMat);
    back.position.set(0, 0.27, Z_BACK - 0.35);
    back.castShadow = true;
    scene.add(back);
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(AX * 2, 0.08), new THREE.MeshBasicMaterial({ color: "#b9b0a2" }));
    slit.rotation.x = -Math.PI / 2;
    slit.position.set(0, 0.002, Z_SPAWN);
    scene.add(slit);

    // shaft walls, rebuilt from rDisp every frame
    const RING_Y = [0.05, -0.06, -0.35, -1.1, -2.3, -3.8];
    const RING_SHADE = [0.62, 0.42, 0.24, 0.11, 0.05, 0.02];
    const shaftGeo = new THREE.BufferGeometry();
    const shaftPos = new Float32Array(N * RING_Y.length * 3);
    const shaftCol = new Float32Array(N * RING_Y.length * 3);
    const shaftIdx = [];
    for (let r = 0; r < RING_Y.length - 1; r++) {
      for (let i = 0; i < N; i++) {
        const a = r * N + i, b = r * N + ((i + 1) % N), c = (r + 1) * N + i, d = (r + 1) * N + ((i + 1) % N);
        shaftIdx.push(a, c, b, b, c, d);
      }
    }
    shaftGeo.setIndex(shaftIdx);
    shaftGeo.setAttribute("position", new THREE.BufferAttribute(shaftPos, 3));
    shaftGeo.setAttribute("color", new THREE.BufferAttribute(shaftCol, 3));
    const shaft = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    shaft.frustumCulled = false;
    scene.add(shaft);
    const pit = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: "#0d0b0a" }));
    pit.rotation.x = -Math.PI / 2;
    scene.add(pit);

    // rim (lip) and hunger ring, both follow the aperture outline
    const LIP_W = 0.2;
    function ribbon() {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(N * 2 * 3);
      const idx = [];
      // start at "12 o'clock" (angle -90deg = index 3N/4) so the ring drains like a clock
      for (let k = 0; k < N; k++) {
        const i = (Math.round(N * 0.75) + k) % N, j = (i + 1) % N;
        idx.push(i, j, N + i, j, N + j, N + i);
      }
      geo.setIndex(idx);
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      return { geo, pos };
    }
    const lipR = ribbon();
    const lipMat = new THREE.MeshLambertMaterial({ color: "#2f5d9e", side: THREE.DoubleSide });
    const lip = new THREE.Mesh(lipR.geo, lipMat);
    lip.frustumCulled = false; lip.receiveShadow = true;
    scene.add(lip);
    const hungR = ribbon();
    const hungMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const hung = new THREE.Mesh(hungR.geo, hungMat);
    hung.frustumCulled = false;
    scene.add(hung);
    const ghost = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 24), new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.0 }));
    ghost.rotation.x = -Math.PI / 2;
    scene.add(ghost);

    const ripples = [];
    function spawnRipple(color) {
      const pts = [];
      for (let i = 0; i <= N; i += 2) {
        const th = (TAU * (i % N)) / N, r = rDisp[i % N] + LIP_W * 0.6;
        pts.push(new THREE.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      line.position.set(hole.x, 0.012, hole.z);
      scene.add(line);
      ripples.push({ line, t: 0 });
    }

    // ------------------------------------------------------------------
    // Aperture: morphs from the previous shape to the current one; cracks
    // make it visibly unstable; collapse closes it.
    // ------------------------------------------------------------------
    let elapsed = 0;
    function updateAperture(dt, closing) {
      hole.m = Math.min(1, hole.m + dt / 0.6);
      const e = smooth(0, 1, hole.m);
      hole.scale = closing ? Math.max(0, hole.scale - dt * 1.4) : lerp(hole.scale, 1, 1 - Math.exp(-dt * 5));
      const cracks = MAX_LIVES - hole.lives;
      const wob = [0, 0.035, 0.085, 0.12][clamp(cracks, 0, 3)] + hole.hit * 0.1;
      const A = BASE[hole.from], B = BASE[hole.shape];
      for (let i = 0; i < N; i++) {
        const th = (TAU * i) / N;
        let r = (A[i] + (B[i] - A[i]) * e) * hole.scale * (1 + hole.pulse * 0.06);
        r += wob * (0.6 * Math.sin(3 * th + elapsed * 2.3) + 0.4 * Math.sin(5 * th - elapsed * 3.4)) * hole.scale;
        rTarget[i] = Math.max(0, r);
      }
      const steps = 3, h = dt / steps;
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < N; i++) {
          const acc = 120 * (rTarget[i] - rDisp[i]) - 15 * rVel[i];
          rVel[i] += acc * h;
          rDisp[i] = Math.max(0, rDisp[i] + rVel[i] * h);
        }
      }
    }
    function rMaxNow() { let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, rDisp[i]); return m; }

    const blackCol = new THREE.Color("#0b0908"), warnCol = new THREE.Color("#e2471f");
    const lipCol = new THREE.Color(), tmpCol = new THREE.Color(), shadeCol = new THREE.Color();
    function writeRibbon(R, r0, r1, y0, y1) {
      for (let i = 0; i < N; i++) {
        const th = (TAU * i) / N;
        for (let k = 0; k < 2; k++) {
          const r = rDisp[i] + (k ? r1 : r0);
          const o = (k * N + i) * 3;
          R.pos[o] = hole.x + Math.cos(th) * r;
          R.pos[o + 1] = k ? y1 : y0;
          R.pos[o + 2] = hole.z + Math.sin(th) * r;
        }
      }
      R.geo.attributes.position.needsUpdate = true;
    }
    function updateHoleMeshes() {
      holeUniforms.uHole.value.set(hole.x, hole.z);
      holeUniforms.uYaw.value = 0;
      lipCol.set(SHAPES[hole.from].color).lerp(tmpCol.set(SHAPES[hole.shape].color), smooth(0, 1, hole.m));
      const danger = hole.lives === 1 ? 0.25 + 0.25 * Math.sin(elapsed * 8) : 0;
      lipCol.lerp(warnCol, clamp(Math.max(danger, hole.hit * 0.9), 0, 1));
      lipMat.color.copy(lipCol);
      for (let rI = 0; rI < RING_Y.length; rI++) {
        shadeCol.copy(lipCol).multiplyScalar(RING_SHADE[rI] * 0.7).lerp(blackCol, (rI / RING_Y.length) * 0.6);
        for (let i = 0; i < N; i++) {
          const th = (TAU * i) / N, r = rDisp[i] * (1 - rI * 0.012);
          const o = (rI * N + i) * 3;
          shaftPos[o] = hole.x + Math.cos(th) * r;
          shaftPos[o + 1] = RING_Y[rI];
          shaftPos[o + 2] = hole.z + Math.sin(th) * r;
          shaftCol[o] = shadeCol.r; shaftCol[o + 1] = shadeCol.g; shaftCol[o + 2] = shadeCol.b;
        }
      }
      shaftGeo.attributes.position.needsUpdate = true;
      shaftGeo.attributes.color.needsUpdate = true;
      writeRibbon(lipR, 0, LIP_W, 0.05, 0.004);
      lipR.geo.computeVertexNormals();
      writeRibbon(hungR, LIP_W + 0.07, LIP_W + 0.2, 0.008, 0.008);
      const f = clamp(hole.hunger / hole.hungerMax, 0, 1);
      hungR.geo.setDrawRange(0, Math.floor(f * N) * 6);
      hungMat.color.set(f < 0.3 ? (Math.sin(elapsed * 12) > 0 ? "#e2471f" : INK) : INK);
      hung.visible = state === "play" && hungerOn() && hole.scale > 0.2;
      pit.position.set(hole.x, RING_Y[RING_Y.length - 1] + 0.01, hole.z);
      pit.scale.setScalar(rMaxNow() + 0.05);
    }

    // ------------------------------------------------------------------
    // Pieces: hole-sized pucks. Body = the shape that fits. Optional badge
    // on top = the shape the hole becomes. Shards = black spikes.
    // ------------------------------------------------------------------
    const CREAM = new THREE.Color("#f3eee6");
    const objects = [];
    let objId = 0;
    function shapeFlat(poly, y, color) {
      const sh = new THREE.Shape();
      poly.forEach(([x, z], i) => { if (i === 0) sh.moveTo(x, -z); else sh.lineTo(x, -z); });
      sh.closePath();
      const g = new THREE.ShapeGeometry(sh);
      g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
      return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
    }
    function buildMesh(o) {
      const BEV = 0.035;
      const sh = new THREE.Shape();
      o.poly.forEach(([x, z], i) => {
        const sx = x * (1 - BEV / o.br), sz = z * (1 - BEV / o.br);
        if (i === 0) sh.moveTo(sx, -sz); else sh.lineTo(sx, -sz);
      });
      sh.closePath();
      o.h = o.kind === "shard" ? 0.75 : 0.36;
      const geo = new THREE.ExtrudeGeometry(sh, { depth: o.h, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 2, curveSegments: 4 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, BEV, 0);
      o.h += BEV * 2;
      const base = o.kind === "shard" ? new THREE.Color("#25211e") : new THREE.Color(SHAPES[o.body].color);
      o.mat = new THREE.MeshLambertMaterial({ color: base, emissive: new THREE.Color(o.kind === "shard" ? "#ff3c12" : "#000000"), emissiveIntensity: 0 });
      o.baseColor = base.clone();
      o.mesh = new THREE.Group();
      const body = new THREE.Mesh(geo, o.mat);
      body.castShadow = true; body.receiveShadow = true;
      o.mesh.add(body);
      if (o.kind === "piece" && o.turn !== o.body) {
        // the badge: a cream plate carrying the next shape in its colour
        const plate = scaled(SHAPES[o.turn].poly, A0 * 0.18);
        o.mesh.add(shapeFlat(plate.map(([x, z]) => [x * 1.35, z * 1.35]), o.h + 0.004, CREAM));
        o.mesh.add(shapeFlat(plate, o.h + 0.008, SHAPES[o.turn].color));
      }
      scene.add(o.mesh);
    }
    function makeObject(opt) {
      const o = {
        id: ++objId, kind: opt.kind, body: opt.body, turn: opt.turn || opt.body,
        x: opt.x, z: opt.z, y: 0, vx: 0, vz: 0, vy: 0,
        dvx: opt.dvx || 0, dvz: opt.dvz || 0, yaw: opt.yaw || 0, spin: opt.spin || 0,
        homing: opt.homing || 0, state: "rise", t: 0, hitCd: 0, settleYaw: 0, lastRampH: 0
      };
      o.poly = o.kind === "shard" ? scaled(jagged(7, 0.55, 1.0), A0 * 0.3) : scaled(SHAPES[o.body].poly, A0 * PIECE_FILL);
      o.br = 0; o.poly.forEach(([x, z]) => { o.br = Math.max(o.br, Math.hypot(x, z)); });
      o.area = polyArea(o.poly);
      buildMesh(o);
      o.mass = o.area * o.h;
      o.y = -o.h - 0.05;
      o.vx = o.dvx; o.vz = o.dvz;
      objects.push(o);
      syncMesh(o);
      return o;
    }
    function removeObject(o) {
      scene.remove(o.mesh);
      o.mesh.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });
      const i = objects.indexOf(o); if (i >= 0) objects.splice(i, 1);
    }
    function syncMesh(o) {
      o.mesh.position.set(o.x, o.y, o.z);
      o.mesh.rotation.y = o.yaw;
      if (o.kind === "shard" && o.state !== "fall") o.mesh.rotation.y = o.yaw + elapsed * 1.5;
    }

    // ------------------------------------------------------------------
    // Fixtures: posts, bars (narrow passages), ramps, turntables
    // ------------------------------------------------------------------
    const fixtures = [];
    const woodMat = new THREE.MeshLambertMaterial({ color: "#b98f62" });
    const darkWood = new THREE.MeshLambertMaterial({ color: "#8e6a47" });
    function addFixture(f) {
      f.rise = 0; f.target = 1;
      if (f.type === "post") {
        f.mesh = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r, 0.9, 28), woodMat);
        f.mesh.geometry.translate(0, 0.45, 0); f.h = 0.9;
      } else if (f.type === "bar") {
        f.mesh = new THREE.Mesh(new THREE.BoxGeometry(f.hw * 2, 0.5, f.hd * 2), woodMat);
        f.mesh.geometry.translate(0, 0.25, 0); f.h = 0.5;
      } else if (f.type === "ramp") {
        const g = new THREE.BoxGeometry(f.hw * 2, f.H, f.hd * 2, 1, 1, 1);
        g.translate(0, f.H / 2, 0);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.01 && p.getZ(i) < 0) p.setY(i, 0.001);
        g.computeVertexNormals();
        f.mesh = new THREE.Mesh(g, woodMat); f.h = f.H;
      } else if (f.type === "turntable") {
        f.mesh = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r, 0.05, 48), new THREE.MeshLambertMaterial({ color: "#d9cfbf" }));
        disc.geometry.translate(0, 0.025, 0);
        f.mesh.add(disc);
        for (let i = 0; i < 4; i++) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(f.r * 1.8, 0.012, 0.07), darkWood);
          bar.position.y = 0.056; bar.rotation.y = (i * Math.PI) / 4;
          f.mesh.add(bar);
        }
        f.h = 0.06;
      }
      f.mesh.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      f.mesh.position.set(f.x, -f.h - 0.05, f.z);
      scene.add(f.mesh);
      fixtures.push(f);
    }
    function clearFixtures() { fixtures.forEach((f) => { f.target = 0; }); }
    function updateFixtures(dt) {
      for (let i = fixtures.length - 1; i >= 0; i--) {
        const f = fixtures[i];
        f.rise = clamp(f.rise + (f.target ? dt : -dt) * 1.4, 0, 1);
        f.cx = f.slide ? f.x + Math.sin(elapsed * f.slide.w + f.slide.p) * f.slide.a : f.x;
        f.cz = f.z;
        f.mesh.position.set(f.cx, lerp(-f.h - 0.05, 0, smooth(0, 1, f.rise)), f.cz);
        if (f.type === "turntable") f.mesh.rotation.y += f.omega * dt;
        if (!f.target && f.rise <= 0) {
          scene.remove(f.mesh);
          f.mesh.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
          fixtures.splice(i, 1);
        }
      }
    }
    function collideCircle(x, z, r, forObject) {
      for (const f of fixtures) {
        if (f.rise < 0.6) continue;
        if (forObject && (f.type === "ramp" || f.type === "turntable")) continue;
        if (f.type === "post" || f.type === "turntable") {
          const dx = x - f.cx, dz = z - f.cz, d = Math.hypot(dx, dz), m = f.r + r;
          if (d < m && d > 1e-6) return { nx: dx / d, nz: dz / d, depth: m - d };
        } else {
          const qx = clamp(x, f.cx - f.hw, f.cx + f.hw), qz = clamp(z, f.cz - f.hd, f.cz + f.hd);
          const dx = x - qx, dz = z - qz, d = Math.hypot(dx, dz);
          if (d < r) {
            if (d > 1e-6) return { nx: dx / d, nz: dz / d, depth: r - d };
            return { nx: 0, nz: 1, depth: r + f.hd - (z - f.cz) };
          }
        }
      }
      return null;
    }
    function rampHeight(f, x, z) {
      if (f.type !== "ramp" || f.rise < 0.6) return -1;
      if (Math.abs(x - f.cx) > f.hw || Math.abs(z - f.cz) > f.hd) return -1;
      return f.H * ((z - (f.cz - f.hd)) / (f.hd * 2));
    }

    // ------------------------------------------------------------------
    // Input: one movement model, two mappings (same velocity integrator)
    // ------------------------------------------------------------------
    let mode = null;
    let simMotion = false, invertTilt = false, tilt = null;
    const simTilt = { x: 0, y: 0, kx: 0, ky: 0 };
    const inp = ctx.input.track(canvas, { tapMaxMs: 230, tapMaxDistance: 12 });
    const ray = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const tv = new THREE.Vector3(), ndc = new THREE.Vector2();
    let drag = null;
    function screenToGround(x, y) {
      ndc.set((x / ctx.width) * 2 - 1, -(y / ctx.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(groundPlane, tv) ? [tv.x, tv.z] : null;
    }
    function holeBounds() {
      const m = Math.min(rMaxNow(), 1.7) + LIP_W;
      return { x0: -AX - 0.2 + m, x1: AX + 0.2 - m, z0: -4.3, z1: SLAB_Z1 - m - 0.25 };
    }
    function readTilt() {
      if (simMotion) {
        simTilt.x = lerp(simTilt.x, simTilt.kx, 0.15); simTilt.y = lerp(simTilt.y, simTilt.ky, 0.15);
        return { x: simTilt.x, y: simTilt.y };
      }
      return tilt ? { x: tilt.x || 0, y: tilt.y || 0 } : { x: 0, y: 0 };
    }
    const shapeCurve = (v) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 1.35);
    function desiredVelocity() {
      if (mode === "motion") {
        const t = readTilt();
        hole.tx = hole.x; hole.tz = hole.z;
        return [shapeCurve(t.x) * VMAX, shapeCurve(invertTilt ? -t.y : t.y) * VMAX];
      }
      if (!drag) return [0, 0];
      let vx = (hole.tx - hole.x) * KP, vz = (hole.tz - hole.z) * KP;
      const l = Math.hypot(vx, vz);
      if (l > VMAX) { vx *= VMAX / l; vz *= VMAX / l; }
      return [vx, vz];
    }
    function handlePointer() {
      if (state !== "play" || mode !== "touch") { drag = null; return; }
      if (inp.pressed || (inp.down && !drag)) {
        // anchor at the touch-down point so a fast first swipe isn't lost
        const g = inp.pressed && inp.startX != null ? screenToGround(inp.startX, inp.startY) : screenToGround(inp.x, inp.y);
        if (g) drag = { gx: g[0], gz: g[1], hx: hole.x, hz: hole.z };
      }
      if (inp.down && drag) {
        const g = screenToGround(inp.x, inp.y);
        if (g) {
          const b = holeBounds();
          hole.tx = clamp(drag.hx + (g[0] - drag.gx) * 1.1, b.x0, b.x1);
          hole.tz = clamp(drag.hz + (g[1] - drag.gz) * 1.1, b.z0, b.z1);
        }
      }
      if (!inp.down) drag = null;
    }
    ctx.listen(window, "keydown", (e) => {
      if (e.key === "ArrowLeft") simTilt.kx = -0.7;
      if (e.key === "ArrowRight") simTilt.kx = 0.7;
      if (e.key === "ArrowUp") simTilt.ky = -0.7;
      if (e.key === "ArrowDown") simTilt.ky = 0.7;
    });
    ctx.listen(window, "keyup", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") simTilt.kx = 0;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") simTilt.ky = 0;
    });
    function updateHole(dt) {
      const [dvx, dvz] = desiredVelocity();
      let ax = dvx - hole.vx, az = dvz - hole.vz;
      const al = Math.hypot(ax, az), cap = AMAX * dt;
      if (al > cap) { ax *= cap / al; az *= cap / al; }
      hole.vx += ax; hole.vz += az;
      hole.x += hole.vx * dt; hole.z += hole.vz * dt;
      const b = holeBounds();
      if (hole.x < b.x0) { hole.x = b.x0; hole.vx = Math.max(0, hole.vx); }
      if (hole.x > b.x1) { hole.x = b.x1; hole.vx = Math.min(0, hole.vx); }
      if (hole.z < b.z0) { hole.z = b.z0; hole.vz = Math.max(0, hole.vz); }
      if (hole.z > b.z1) { hole.z = b.z1; hole.vz = Math.min(0, hole.vz); }
      for (let k = 0; k < 2; k++) {
        const c = collideCircle(hole.x, hole.z, HOLE_COL_R, false);
        if (!c) break;
        hole.x += c.nx * c.depth; hole.z += c.nz * c.depth;
        const vn = hole.vx * c.nx + hole.vz * c.nz;
        if (vn < 0) { hole.vx -= vn * c.nx; hole.vz -= vn * c.nz; }
      }
      hole.pulse = Math.max(0, hole.pulse - dt * 3.5);
      hole.hit = Math.max(0, hole.hit - dt * 2.2);
      hole.invuln = Math.max(0, hole.invuln - dt);
    }

    // ------------------------------------------------------------------
    // Scoring, cracks, feedback
    // ------------------------------------------------------------------
    const score = ctx.game.score();
    let best = 0, chain = 0, lastEat = -99, flowMult = 1, streak = 0, history = [], cause = "";
    let audioOn = false;
    const shown = {};
    const projV = new THREE.Vector3();
    function screenOf(x, y, z) {
      projV.set(x, y, z).project(camera);
      return { x: ((projV.x + 1) / 2) * ctx.width, y: ((1 - projV.y) / 2) * ctx.height };
    }
    function floatText(text, color, big) {
      try {
        const p = screenOf(hole.x, 0.3, hole.z);
        ctx.fx.floatText({ x: p.x, y: p.y - 34, text, color: color || INK, size: big ? 24 : 16 });
      } catch (e) { /* fx optional */ }
    }
    function tip(text, onceKey) {
      if (onceKey) { if (shown[onceKey]) return; shown[onceKey] = true; }
      el.tip.textContent = text;
      el.tip.style.animation = "none"; void el.tip.offsetWidth;
      el.tip.style.animation = "hTip 3.6s ease forwards";
    }
    function haptic(kind) { try { if (ctx.capabilities.haptics) ctx.platform.haptic(kind); } catch (e) { } }
    function sting(name) { try { if (audioOn) ctx.music.sting(name); } catch (e) { } }

    function transformTo(shape) {
      if (shape === hole.shape) return;
      hole.from = hole.shape; hole.shape = shape; hole.m = 0;
      hole.invuln = Math.max(hole.invuln, 1.6);   // grace: yesterday's food is today's threat
      history.push(shape);
    }

    function consume(o, settleYaw) {
      o.state = "fall"; o.t = 0; o.settleYaw = settleYaw; o.vy = 0;
      o.fromX = o.x; o.fromZ = o.z; o.fromYaw = o.yaw;
      o.mesh.traverse((m) => { m.castShadow = false; });
      const gap = elapsed - lastEat;
      chain = gap < 4 ? chain + 1 : 1;
      lastEat = elapsed;
      flowMult = Math.min(8, 1 + Math.floor(chain / 3));
      streak += 1;
      hole.hunger = hole.hungerMax;
      let pts = 10, label = "+10", col = SHAPES[o.body].color, big = false;
      if (Math.abs(o.spin) > 0.6) { pts += 15; label = "CLICK +25"; big = true; }
      if (D.phase === "rush" && o.body === D.rushShape) { pts *= 2; label = `RUSH +${pts}`; big = true; }
      if (o.turn !== o.body) {
        pts += 15; label = `\u2192 ${SHAPES[o.turn].name}`; col = SHAPES[o.turn].color; big = true;
        transformTo(o.turn);
        haptic("medium"); sting("powerup");
        tip(`NOW EAT ${SHAPES[o.turn].name}S`, "now" + o.turn);
      } else { haptic("light"); sting("coin"); }
      if (streak % 8 === 0 && hole.lives < MAX_LIVES) {
        hole.lives += 1; label += "  REPAIRED"; sting("success");
      }
      score.add(pts * flowMult, { reason: o.turn !== o.body ? "transform" : "eat" });
      floatText(flowMult > 1 ? `${label} \u00d7${flowMult}` : label, col, big);
      hole.pulse = 1;
      spawnRipple(SHAPES[o.turn].color);
      ctx.platform.interact({ kind: "consume", shape: o.body, turn: o.turn });
    }

    function damageOn() { return D.phase !== "intro" || D.pt > 12; }
    function hungerOn() { return D.phase !== "intro" || D.pt > 12; }
    function crack(why) {
      if (hole.invuln > 0 || state !== "play") return false;
      hole.lives -= 1; hole.invuln = 2.0; hole.hit = 1;
      chain = 0; flowMult = 1; streak = 0;
      haptic("heavy"); sting("danger");
      floatText(hole.lives > 0 ? `CRACK \u2014 ${why}` : "COLLAPSE", "#d8401b", true);
      if (hole.lives === 1) tip("ONE MORE CRACK AND IT CLOSES", "last");
      if (hole.lives <= 0) {
        cause = why === "STARVED" ? "the hole starved" : why === "SHARD" ? "a shard broke the hole" : "a wrong shape broke the hole";
        state = "closing"; sting("lose"); haptic("error");
        show("hud", false);
      }
      return true;
    }
    function bump(o, why) {
      o.hitCd = 0.8;
      let nx = o.x - hole.x, nz = o.z - hole.z, l = Math.hypot(nx, nz);
      if (l < 0.05) { nx = -hole.vx; nz = -hole.vz; l = Math.hypot(nx, nz); }
      if (l < 0.05) { nx = 0; nz = 1; l = 1; }
      nx /= l; nz /= l;
      o.vx += nx * 3.2; o.vz += nz * 3.2;
      o.x += nx * 0.1; o.z += nz * 0.1;
      o.vy = 1.8; o.y = 0.01;
      if (damageOn()) {
        if (!crack(why)) hole.hit = Math.max(hole.hit, 0.4);
        else tip(o.kind === "shard" ? "BLACK SHARDS CRACK IT \u2014 DODGE" : "WRONG SHAPE CRACKS IT \u2014 DODGE", "wrong" + o.kind);
      } else {
        hole.hit = 0.6; floatText("DOESN'T FIT", INK); haptic("light"); sting("tap");
      }
    }

    // ------------------------------------------------------------------
    // Simulation (identical regardless of control mode)
    // ------------------------------------------------------------------
    function updateObjects(dt) {
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        o.t += dt;
        if (o.state === "fall") {
          const st = clamp(o.t / 0.12, 0, 1);
          o.x = lerp(o.fromX, hole.x, st); o.z = lerp(o.fromZ, hole.z, st);
          o.yaw = lerp(o.fromYaw, o.settleYaw, st);
          if (st >= 1) {
            o.vy -= 22 * dt; o.y += o.vy * dt;
            o.mat.color.copy(o.baseColor).lerp(blackCol, clamp(-o.y / 2.2, 0, 0.95));
          }
          if (o.y < -3.2) { removeObject(o); continue; }
          syncMesh(o); continue;
        }
        if (o.state === "rise") {
          o.y = lerp(-o.h - 0.05, 0, smooth(0, 0.55, o.t));
          if (o.t >= 0.55) { o.state = "live"; o.y = 0; }
        }
        const k = 1 - Math.exp(-dt * 1.1);
        o.vx += (o.dvx - o.vx) * k; o.vz += (o.dvz - o.vz) * k;
        if (o.homing && o.state === "live" && state === "play") {
          const dx = hole.x - o.x, dz = hole.z - o.z, d = Math.hypot(dx, dz) + 0.001;
          if (d < 6) { o.vx += (dx / d) * o.homing * dt; o.vz += (dz / d) * o.homing * dt; }
        }
        o.x += o.vx * dt; o.z += o.vz * dt; o.yaw += o.spin * dt;
        // ramps launch pieces into the air (an airborne piece can't drop in, or crack you)
        let ground = 0, onRamp = false;
        for (const f of fixtures) {
          const h = rampHeight(f, o.x, o.z);
          if (h >= 0 && o.y <= h + 0.12) { ground = Math.max(ground, h); onRamp = true; }
          if (f.type === "turntable" && f.rise >= 0.6 && o.y < 0.1) {
            const dx = o.x - f.cx, dz = o.z - f.cz;
            if (Math.hypot(dx, dz) < f.r) {
              const a = f.omega * dt * 0.8, c = Math.cos(a), s = Math.sin(a);
              const vx = o.dvx * c + o.dvz * s, vz = -o.dvx * s + o.dvz * c;
              o.dvx = vx; o.dvz = vz; o.spin = lerp(o.spin, f.omega, 0.05);
              o.vx += -dz * f.omega * 0.6 * dt; o.vz += dx * f.omega * 0.6 * dt;
            }
          }
        }
        if (!onRamp && o.lastRampH > 0.2 && o.vz > 0 && o.vy === 0 && o.state === "live") o.vy = 2.0 + o.vz * 0.6;
        o.lastRampH = onRamp ? ground : 0;
        if (o.state === "live" || o.state === "off") {
          if (o.vy !== 0 || o.y > ground + 0.001 || o.state === "off") {
            o.vy -= 20 * dt; o.y += o.vy * dt;
            if (o.state !== "off" && o.y <= ground) { o.y = ground; o.vy = o.vy < -2.5 ? -o.vy * 0.25 : 0; }
          } else o.y = ground;
        }
        if (o.state === "off") {
          if (o.y < -6) { removeObject(o); continue; }
          syncMesh(o); continue;
        }
        const lim = AX - o.br * 0.8;
        if (o.x < -lim) { o.x = -lim; o.vx = Math.abs(o.vx) * 0.6; o.dvx = Math.abs(o.dvx); }
        if (o.x > lim) { o.x = lim; o.vx = -Math.abs(o.vx) * 0.6; o.dvx = -Math.abs(o.dvx); }
        if (o.z < Z_BACK + o.br * 0.8 && o.state === "live") { o.z = Z_BACK + o.br * 0.8; o.vz = Math.abs(o.vz) * 0.6; o.dvz = Math.abs(o.dvz) + 0.2; }
        if (o.z > Z_EDGE && o.state === "live") { o.state = "off"; o.vy = 0; }
        if (o.y < 0.3) {
          const c = collideCircle(o.x, o.z, o.br * 0.8, true);
          if (c) {
            o.x += c.nx * c.depth; o.z += c.nz * c.depth;
            const vn = o.vx * c.nx + o.vz * c.nz;
            if (vn < 0) { o.vx -= 1.5 * vn * c.nx; o.vz -= 1.5 * vn * c.nz; }
            const dn = o.dvx * c.nx + o.dvz * c.nz;
            if (dn < 0) { o.dvx -= dn * c.nx * 1.2; o.dvz -= dn * c.nz * 1.2; o.dvx += c.nz * 0.15 * Math.sign(o.dvx || 1); }
          }
        }
        o.hitCd = Math.max(0, o.hitCd - dt);
        // the hole
        if (state === "play" && o.state === "live" && o.y < 0.08 && o.hitCd <= 0) {
          const d = Math.hypot(o.x - hole.x, o.z - hole.z);
          if (o.kind === "shard") {
            if (d < SHARD_R) bump(o, "SHARD");
          } else if (o.body === hole.shape && hole.m > 0.8) {
            if (d < EAT_R) {
              const err = alignErr(o.yaw - hole.yaw, SHAPES[o.body].sym);
              if (Math.abs(err) < ALIGN_TOL) consume(o, o.yaw - err);
              // otherwise it rides the rim until its spin lines it up
            }
          } else if (d < HIT_R) {
            bump(o, "WRONG SHAPE");
          }
        }
        syncMesh(o);
      }
      for (let i = 0; i < objects.length; i++) {
        const a = objects[i];
        if (a.state !== "live" || a.y > 0.3) continue;
        for (let j = i + 1; j < objects.length; j++) {
          const b = objects[j];
          if (b.state !== "live" || b.y > 0.3) continue;
          const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = (a.br + b.br) * 0.8;
          if (d < m && d > 1e-5) {
            const nx = dx / d, nz = dz / d, tot = a.mass + b.mass, pen = m - d;
            a.x -= nx * pen * (b.mass / tot); a.z -= nz * pen * (b.mass / tot);
            b.x += nx * pen * (a.mass / tot); b.z += nz * pen * (a.mass / tot);
            const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
            if (rv < 0) {
              const j2 = (-(1 + 0.45) * rv) / (1 / a.mass + 1 / b.mass);
              a.vx -= (j2 / a.mass) * nx; a.vz -= (j2 / a.mass) * nz;
              b.vx += (j2 / b.mass) * nx; b.vz += (j2 / b.mass) * nz;
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Director. Spawns are always relative to the hole's CURRENT shape, so
    // there is always food, always obstacles, always a way to transform.
    // Cycle: FLOW (~15s) -> RUSH WARNING (6.5s, transformers appear) -> RUSH (7.5s).
    // ------------------------------------------------------------------
    const D = { t: 0, phase: "intro", pt: 0, cycle: 0, rushShape: null, timers: {}, fired: {}, dt: 0 };
    function difficulty() { return clamp((D.t - 30) / 200, 0, 1); }
    function unlocked() { return UNLOCK.filter(([, t]) => D.t >= t).map(([k]) => k); }
    function others(shape) { return unlocked().filter((k) => k !== shape); }
    function liveCount() { return objects.filter((o) => o.state === "live" || o.state === "rise").length; }
    function freeX(br, z) {
      for (let k = 0; k < 12; k++) {
        const x = rr(-AX + br, AX - br);
        if (!objects.some((o) => o.state !== "fall" && Math.hypot(o.x - x, o.z - z) < o.br + br + 0.2)) return x;
      }
      return null;
    }
    function spawnStatic(body, turn, x, z) {
      return makeObject({ kind: "piece", body, turn, x, z, yaw: 0 });
    }
    function spawnDrift(kind, body, turn, o) {
      o = o || {};
      if (liveCount() > 12) return null;
      const d = difficulty();
      const br = kind === "shard" ? 0.9 : 1.25;
      const x = o.x != null ? o.x : freeX(br, Z_SPAWN);
      if (x == null) return null;
      const v = (o.speed != null ? o.speed : 0.8 + 1.3 * d) * rr(0.85, 1.15);
      let spin = o.spin;
      if (spin == null) spin = kind === "piece" && body !== "circle" && rand() < 0.08 + 0.35 * d ? rr(0.8, 1.6) * (rand() < 0.5 ? -1 : 1) : 0;
      const sym = kind === "piece" ? SHAPES[body].sym : 0;
      return makeObject({
        kind, body, turn, x, z: Z_SPAWN, dvx: (o.dx != null ? o.dx : rr(-0.2, 0.2)) * v, dvz: v, spin,
        yaw: spin ? rr(0, TAU) : Math.round(rr(0, 4)) * (sym || 0),   // still pieces arrive lined up
        homing: kind === "shard" ? 0.6 + 1.0 * d : 0
      });
    }
    function spawnMix() {
      const d = difficulty();
      const cur = hole.shape, oth = others(cur);
      const r = rand();
      if (D.t > 45 && r < 0.06 + 0.12 * d) return spawnDrift("shard", null, null);
      if (r < 0.46) return spawnDrift("piece", cur, cur);                                         // food
      if (r < 0.64 && oth.length) return spawnDrift("piece", cur, pick(oth));                    // food that transforms you
      const b = oth.length ? pick(oth) : cur;                                                       // obstacle (future food)
      return spawnDrift("piece", b, rand() < 0.3 ? pick(unlocked()) : b);
    }
    function every(id, period, fn) {
      D.timers[id] = (D.timers[id] || 0) + D.dt;
      if (D.timers[id] >= period) { D.timers[id] -= period; fn(); }
    }
    function once(id, at, fn) { if (!D.fired[id] && D.pt >= at) { D.fired[id] = true; fn(); } }
    function setPhase(p) { D.phase = p; D.pt = 0; D.timers = {}; D.fired = {}; }
    function setFixturesFor(cycle) {
      clearFixtures();
      const plans = [
        null,
        () => { addFixture({ type: "post", x: -2.1, z: -1.2, r: 0.42 }); addFixture({ type: "post", x: 2.1, z: -1.2, r: 0.42 }); },
        () => { addFixture({ type: "ramp", x: rr(-1.5, 1.5), z: -3.6, hw: 1.2, hd: 0.8, H: 0.42 }); },
        () => { addFixture({ type: "turntable", x: rand() < 0.5 ? -1.7 : 1.7, z: -2.6, r: 1.6, omega: rand() < 0.5 ? 1.3 : -1.3 }); },
        () => { addFixture({ type: "bar", x: -2.65, z: -2.2, hw: 1.55, hd: 0.2 }); addFixture({ type: "bar", x: 2.65, z: -2.2, hw: 1.55, hd: 0.2 }); },
        () => { addFixture({ type: "post", x: 0, z: -1.5, r: 0.45, slide: { a: 2.6, w: 1.1, p: 0 } }); addFixture({ type: "post", x: 0, z: -4.3, r: 0.38, slide: { a: 2.6, w: 1.1, p: Math.PI } }); }
      ];
      if (cycle < plans.length) { if (plans[cycle]) plans[cycle](); return; }
      pick(plans.slice(1))();
    }
    function startWarn(shape) {
      setPhase("warn");
      D.rushShape = shape || pick(others(hole.shape));
    }

    function updateDirector(dt) {
      D.dt = dt; D.t += dt; D.pt += dt;
      const d = difficulty();
      if (D.phase === "intro") {
        // 0-12s: nothing can hurt you. Learn: same shape drops in; badge transforms.
        once("a", 0.15, () => {
          spawnStatic("circle", "circle", -1.7, 1.3);
          spawnStatic("circle", "circle", 1.7, 0.2);
          spawnStatic("triangle", "triangle", 0, -1.4);
          tip("SAME SHAPE DROPS IN");
        });
        once("b", 4.5, () => {
          spawnStatic("circle", "triangle", 2.2, -2.8);
          tip("BADGE ON TOP = WHAT YOU BECOME");
        });
        once("c1", 6.0, () => spawnDrift("piece", "triangle", "triangle", { speed: 0.6, x: -2.4 }));
        once("c2", 8.0, () => spawnDrift("piece", "triangle", "triangle", { speed: 0.6, x: 0.6 }));
        once("c3", 9.5, () => spawnDrift("piece", "circle", "circle", { speed: 0.6, x: 2.6 }));
        once("loosen", 10, () => objects.forEach((o) => { if (!o.dvz && !o.dvx) { o.dvz = rr(0.45, 0.7); o.dvx = rr(-0.1, 0.1); } }));
        once("dmg", 12, () => tip("WRONG SHAPES CRACK IT \u2014 DODGE"));
        if (D.pt > 11) every("mix", 1.5, () => spawnMix());
        if (D.pt >= 22) startWarn("square");
        return;
      }
      if (D.phase === "flow") {
        every("mix", Math.max(0.8, 1.5 - 0.7 * d), () => spawnMix());
        if (D.pt >= 15 - 3 * d) startWarn();
        return;
      }
      if (D.phase === "warn") {
        // a way into the rush shape: one easy, one harder (fast or spinning)
        once("t1", 0.3, () => spawnDrift("piece", hole.shape, D.rushShape, { x: rand() < 0.5 ? rr(-3.2, -2.2) : rr(2.2, 3.2), speed: 0.9 }));
        once("t2", 3.0, () => spawnDrift("piece", hole.shape, D.rushShape, { speed: 1.4 + d, spin: d > 0.3 ? rr(1, 1.8) : 0 }));
        every("mix", Math.max(0.9, 1.6 - 0.6 * d), () => spawnMix());
        if (D.pt >= 6.5) setPhase("rush");
        return;
      }
      if (D.phase === "rush") {
        every("rush", 0.7, () => { if (D.pt < 6) spawnDrift("piece", D.rushShape, D.rushShape, { speed: 1.4 + 1.2 * d, spin: rand() < d * 0.4 ? rr(0.8, 1.5) : 0 }); });
        if (D.t > 45 && d > 0.2) once("sh", 2.5, () => spawnDrift("shard", null, null));
        if (D.pt >= 7.5) {
          D.cycle += 1; setPhase("flow"); D.rushShape = null;
          setFixturesFor(D.cycle);
        }
      }
    }

    // ------------------------------------------------------------------
    // HUD
    // ------------------------------------------------------------------
    let hudCache = {};
    function setHtml(k, v) { if (hudCache[k] !== v) { hudCache[k] = v; el[k].innerHTML = v; } }
    function updateHud() {
      setHtml("score", String(Math.round(score.value)));
      let lives = "";
      for (let i = 0; i < MAX_LIVES; i++) lives += ringSvg(i < hole.lives);
      setHtml("lives", lives);
      if (elapsed - lastEat > 4 && chain) { chain = 0; flowMult = 1; }
      el.flow.style.opacity = flowMult > 1 ? "1" : "0";
      setHtml("flow", `FLOW \u00d7 ${String(flowMult).padStart(2, "0")}`);
      let chip = "";
      if (D.phase === "warn") chip = `RUSH|${D.rushShape}|${Math.ceil(6.5 - D.pt)}|${hole.shape === D.rushShape}`;
      else if (D.phase === "rush") chip = `RUSH|${D.rushShape}|NOW|${hole.shape === D.rushShape}`;
      if (hudCache.chip !== chip) {
        hudCache.chip = chip;
        if (!chip) el.next.style.display = "none";
        else {
          const [lab, key, secs, have] = chip.split("|");
          el.next.style.display = "flex";
          el.next.style.background = have === "true" ? INK : "rgba(239,233,223,.9)";
          el.next.style.color = have === "true" ? PAPER : INK;
          el.next.innerHTML = `${shapeSvg(key, 18)}<span style="font-size:11px;font-weight:800;letter-spacing:.18em">${lab} ${SHAPES[key].name}</span><span style="font-size:11px;opacity:.7;font-variant-numeric:tabular-nums">${secs}</span>`;
          if (secs !== "NOW" && have !== "true") tip(`BECOME ${SHAPES[key].name} BEFORE THE RUSH`, "rush1");
        }
      }
      if (mode === "motion" && state === "play") {
        const t = readTilt();
        el.tilt.style.display = "block";
        el.tiltdot.style.transform = `translate(${clamp(t.x, -1, 1) * 15}px, ${clamp(invertTilt ? -t.y : t.y, -1, 1) * 15}px)`;
      } else el.tilt.style.display = "none";
    }

    // ------------------------------------------------------------------
    // Flow: select -> (calibrate) -> play -> closing -> over
    // ------------------------------------------------------------------
    let state = "select";
    let attempt = 0;
    function show(k, on, disp) { el[k].style.display = on ? (disp || "flex") : "none"; }

    function resetRun() {
      while (objects.length) removeObject(objects[0]);
      fixtures.slice().forEach((f) => { scene.remove(f.mesh); });
      fixtures.length = 0;
      Object.assign(hole, {
        x: 0, z: 3.4, vx: 0, vz: 0, tx: 0, tz: 3.4, shape: "circle", from: "circle", m: 1, scale: 1,
        pulse: 0, hit: 0, lives: MAX_LIVES, invuln: 0, hunger: 12, hungerMax: 12
      });
      Object.assign(D, { t: 0, phase: "intro", pt: 0, cycle: 0, rushShape: null, timers: {}, fired: {} });
      score.reset({ reason: "new_run" });
      chain = 0; lastEat = -99; flowMult = 1; streak = 0; history = ["circle"]; hudCache = {}; cause = "";
      drag = null;
    }
    function startRun() {
      resetRun();
      attempt += 1;
      state = "play";
      show("hud", true, "block"); show("select", false); show("calib", false); show("over", false); show("pausePanel", false);
      ctx.platform.start({ mode, attempt });
    }
    async function startAudio() {
      if (audioOn) return;
      try {
        if (!ctx.capabilities.backgroundMusic) return;
        await ctx.music.unlock();
        ctx.music.play({ preset: "ambient", volume: 0.28, intensity: 0.35 });
        audioOn = true;
      } catch (e) { /* silent fallback */ }
    }
    async function enableMotion(noteEl) {
      if (simMotion) return true;
      try {
        if (!ctx.capabilities.motion) throw new Error("no motion");
        await ctx.motion.start();
        const t0 = Date.now();
        while (Date.now() - t0 < 1200) {
          const s = ctx.motion.snapshot;
          if (s && s.source && s.source !== "none" && s.atMs) return true;
          await new Promise((r) => ctx.timeout(r, 60));
          if (disposed) return false;
        }
        throw new Error("no data");
      } catch (e) {
        noteEl.textContent = "Motion control isn't available on this device.";
        return false;
      }
    }
    function calibrateThen(fn) {
      state = "calibrate";
      show("calib", true); show("select", false); show("pausePanel", false);
      el.ring.style.animation = "none"; void el.ring.getBoundingClientRect(); el.ring.style.animation = "hRing 1.3s linear forwards";
      ctx.timeout(() => {
        if (disposed) return;
        if (!simMotion) {
          try {
            ctx.motion.calibrate();
            if (!tilt) tilt = ctx.motion.tiltControl({ maxAngle: 16, deadzone: 0.05, smoothing: 0.22 });
          } catch (e) { /* tilt stays null */ }
        }
        show("calib", false);
        fn();
      }, 1300);
    }
    async function choose(m) {
      if (state !== "select") return;
      startAudio();
      if (m === "motion") {
        state = "selecting";
        const ok = await enableMotion(el.selectNote);
        if (disposed) return;
        if (!ok) {
          const noTouch = (navigator.maxTouchPoints || 0) === 0;
          el.simBtn.style.display = noTouch ? "inline-block" : "none";
          state = "select";
          ctx.timeout(() => { if (state === "select" && !mode) { mode = "touch"; startRun(); } }, noTouch ? 4000 : 2200);
          return;
        }
        mode = "motion";
        calibrateThen(startRun);
      } else {
        mode = "touch";
        startRun();
      }
    }
    ctx.input.activate(el.pickTouch, () => choose("touch"));
    ctx.input.activate(el.pickMotion, () => choose("motion"));
    ctx.input.activate(el.simBtn, () => {
      simMotion = true; mode = "motion"; el.simBtn.style.display = "none";
      state = "select"; el.selectNote.textContent = "DEV: arrow keys tilt";
      calibrateThen(startRun);
    });
    function refreshPausePanel() {
      el.mTouch.classList.toggle("on", mode === "touch");
      el.mMotion.classList.toggle("on", mode === "motion");
      el.motionOpts.style.display = mode === "motion" ? "flex" : "none";
      el.invert.classList.toggle("on", invertTilt);
    }
    ctx.input.activate(el.pause, () => {
      if (state !== "play") return;
      state = "paused"; drag = null;
      el.pauseNote.textContent = "";
      refreshPausePanel(); show("pausePanel", true);
    });
    ctx.input.activate(el.resume, () => { if (state === "paused") { state = "play"; show("pausePanel", false); } });
    ctx.input.activate(el.restart, () => { if (state === "paused") startRun(); });
    ctx.input.activate(el.mTouch, () => { if (state === "paused") { mode = "touch"; refreshPausePanel(); } });
    ctx.input.activate(el.mMotion, async () => {
      if (state !== "paused" || mode === "motion") return;
      el.pauseNote.textContent = "";
      const ok = await enableMotion(el.pauseNote);
      if (!ok || disposed) return;
      mode = "motion"; refreshPausePanel();
      calibrateThen(() => { state = "play"; });
    });
    ctx.input.activate(el.recal, () => { if (state === "paused") calibrateThen(() => { state = "play"; }); });
    ctx.input.activate(el.invert, () => { invertTilt = !invertTilt; refreshPausePanel(); });
    ctx.input.activate(el.again, () => { if (state === "over") startRun(); });
    ctx.input.activate(el.changeCtl, () => {
      if (state !== "over") return;
      state = "select"; mode = null; el.selectNote.textContent = "";
      show("over", false); show("hud", false); show("select", true);
    });

    function gameOver() {
      state = "over";
      const final = Math.round(score.value);
      best = Math.max(best, final);
      el.cause.textContent = cause || "the hole collapsed";
      el.finalScore.textContent = String(final);
      el.best.textContent = final >= best && final > 0 ? "best this session" : `best ${best}`;
      el.history.innerHTML = history.slice(-9).map((k, i) =>
        `${i ? '<span style="opacity:.4">\u2192</span>' : ""}${shapeSvg(k, 26)}`).join("");
      show("over", true);
      try { ctx.platform.fail({ score: final, cycles: D.cycle, mode }); } catch (e) { }
      if (final > 0) score.submit("score", { label: `${final} pts` }).catch(() => { /* best-effort */ });
    }

    // ------------------------------------------------------------------
    // Camera: whole arena, slightly elevated, never moves
    // ------------------------------------------------------------------
    const lookAt = new THREE.Vector3(0, 0, 0.3);
    const camDir = new THREE.Vector3(0, Math.sin(1.0), Math.cos(1.0)).normalize();
    function fitCamera() {
      camera.aspect = Math.max(0.2, ctx.width / Math.max(1, ctx.height));
      camera.updateProjectionMatrix();
      const topPad = 1 - (2 * (((ctx.safeArea || {}).top || 0) + 110)) / Math.max(1, ctx.height);
      const corners = [];
      for (const x of [-SLAB_HX, SLAB_HX]) for (const z of [SLAB_Z0, SLAB_Z1]) for (const y of [0, 0.5]) corners.push(new THREE.Vector3(x, y, z));
      let dist = 8;
      for (let it = 0; it < 80; it++) {
        camera.position.copy(lookAt).addScaledVector(camDir, dist);
        camera.lookAt(lookAt); camera.updateMatrixWorld();
        let ok = true;
        for (const c of corners) {
          const p = c.clone().project(camera);
          if (Math.abs(p.x) > 0.97 || p.y > topPad || p.y < -0.9) { ok = false; break; }
        }
        if (ok) break;
        dist *= 1.04;
      }
    }
    ctx.onResize(({ width, height, safeArea }) => {
      renderer.setSize(width, height, false);
      fitCamera();
      el.tilt.style.top = `${(safeArea ? safeArea.top : 0) + 120}px`;
      el.hud.style.paddingTop = `${(safeArea ? safeArea.top : 0) + 12}px`;
    }, { immediate: true });

    // ------------------------------------------------------------------
    // Main loop
    // ------------------------------------------------------------------
    function step(dt) {
      elapsed += dt;
      const playing = state === "play";
      const frozen = state === "paused" || state === "calibrate";
      if (!frozen) {
        if (playing) {
          updateDirector(dt);
          if (hungerOn()) {
            hole.hungerMax = lerp(11, 6.5, difficulty());
            hole.hunger -= dt;
            if (hole.hunger <= 0) {
              hole.hunger = hole.hungerMax;
              crack("STARVED");
              tip("KEEP EATING \u2014 THE RING IS YOUR HUNGER", "hunger");
            }
          }
        }
        if (playing || state === "closing") updateHole(dt);
        updateObjects(dt);
        updateFixtures(dt);
      }
      updateAperture(frozen ? 0 : dt, state === "closing");
      if (state === "closing" && hole.scale <= 0.001) gameOver();
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]; r.t += dt;
        r.line.scale.setScalar(1 + r.t * 1.6);
        r.line.material.opacity = Math.max(0, 0.9 - r.t * 1.8);
        r.line.position.set(hole.x, 0.012, hole.z);
        if (r.t > 0.5) { scene.remove(r.line); r.line.geometry.dispose(); r.line.material.dispose(); ripples.splice(i, 1); }
      }
      updateHoleMeshes();
      ghost.material.opacity = lerp(ghost.material.opacity, mode === "touch" && drag && playing ? 0.35 : 0, 0.2);
      ghost.position.set(hole.tx, 0.015, hole.tz);
      if (state === "play") updateHud();
    }

    updateAperture(0.016, false);
    updateHoleMeshes();
    renderer.render(scene, camera);
    ctx.platform.ready();

    ctx.game.loop({
      input: inp,
      maxDeltaMs: 50,
      update(dtMs) {
        if (disposed) return;
        handlePointer();
        const dt = Math.min(dtMs / 1000, 1 / 20);
        const sub = dt > 1 / 50 ? 2 : 1;
        for (let i = 0; i < sub; i++) step(dt / sub);
      },
      render() {
        if (!disposed) renderer.render(scene, camera);
      }
    });
  }
};
