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
    // Geometry language: every aperture shape and every object footprint is
    // a 2D polygon on the XZ plane (angle = atan2(z, x)). Apertures are
    // stored as a radial function r(theta) sampled N times; the rendered
    // hole, the slab cut-out, the shaft walls and the fit test all read the
    // same samples, so what you see is exactly what collides.
    // ------------------------------------------------------------------
    const TAU = Math.PI * 2;
    const N = 120;
    const R0 = 1.05;                  // circle-equivalent aperture radius
    const A0 = Math.PI * R0 * R0;     // aperture area (constant: the hole changes, it does not grow)
    const AX = 4.0;                   // objects live in |x| <= AX
    const SLAB_HX = 4.65, SLAB_Z0 = -8.3, SLAB_Z1 = 8.1;
    const Z_BACK = -7.6, Z_SPAWN = -6.9, Z_EDGE = SLAB_Z1 + 0.25;
    const HOLE_COL_R = 0.92;          // hole vs fixtures collision radius (shape independent)
    const VMAX = 8.0, AMAX = 40, KP = 11;   // identical for touch and motion
    const TAP_TWIST = Math.PI / 6;

    const rand = Math.random;
    const rr = (a, b) => a + rand() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

    function regular(n, r, startDeg) {
      const p = [];
      for (let i = 0; i < n; i++) {
        const a = ((startDeg + (360 * i) / n) * Math.PI) / 180;
        p.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return p;
    }
    function ellipse(rx, rz, n) {
      const p = [];
      for (let i = 0; i < n; i++) { const a = (TAU * i) / n; p.push([Math.cos(a) * rx, Math.sin(a) * rz]); }
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
        const a = ((i + rr(-0.28, 0.28)) / n) * TAU;
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
    function rAt(arr, th) {
      let f = (((th % TAU) + TAU) % TAU) / TAU * N;
      const i0 = Math.floor(f), t = f - i0;
      const a = i0 % N, b = (a + 1) % N;
      return arr[a] + (arr[b] - arr[a]) * t;
    }
    // rotate a local XZ vector the same way Object3D.rotation.y does
    function rotY(x, z, yaw) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return [x * c + z * s, -x * s + z * c];
    }

    const SHAPES = {
      circle:   { name: "CIRCLE",   poly: regular(48, 1, 0),             color: "#2f5d9e", glyph: "\u25cb" },
      square:   { name: "SQUARE",   poly: regular(4, 1, 45),             color: "#cf9426", glyph: "\u25a0" },
      triangle: { name: "TRIANGLE", poly: regular(3, 1, -90),            color: "#c0533a", glyph: "\u25b2" },
      hex:      { name: "HEX",      poly: regular(6, 1, 0),              color: "#5c8d68", glyph: "\u2b22" },
      rect:     { name: "SLOT",     poly: [[1.45, 0.6], [-1.45, 0.6], [-1.45, -0.6], [1.45, -0.6]], color: "#7461a3", glyph: "\u25ac" },
      oval:     { name: "OVAL",     poly: ellipse(1.42, 0.7, 48),         color: "#3a95a2", glyph: "\u2b2d" },
      star:     { name: "STAR",     poly: starPoly(5, 1, 0.5, -90),      color: "#d0708f", glyph: "\u2605" },
      irregular:{ name: "BROKEN",   poly: jagged(9, 0.55, 1.0),          color: "#2b2724", glyph: "\u2736" }
    };
    const THEMES = ["square", "triangle", "hex", "rect", "star", "oval", "circle"];
    const BASE = {};
    function rebuildBase(key) { BASE[key] = radialTable(scaled(SHAPES[key].poly, A0)); }
    Object.keys(SHAPES).forEach(rebuildBase);

    function shapeSvg(key, size, color) {
      const p = scaled(SHAPES[key].poly, Math.PI * 0.8);
      const pts = p.map(([x, z]) => `${(x * 10 + 12).toFixed(2)},${(z * 10 + 12).toFixed(2)}`).join(" ");
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block"><polygon points="${pts}" fill="${color || SHAPES[key].color}"/></svg>`;
    }

    // ------------------------------------------------------------------
    // DOM HUD (overlay, passthrough) \u2014 drawn first so the Bit is never blank
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
  .h-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:rgba(232,226,216,.86);pointer-events:auto;text-align:center;padding:24px}
  .h-cap{font-size:11px;letter-spacing:.24em;text-transform:uppercase;opacity:.6}
  .h-card{pointer-events:auto;cursor:pointer;width:min(40vw,170px);border:1.5px solid ${INK};border-radius:22px;background:${PAPER};padding:14px 10px 16px;display:flex;flex-direction:column;align-items:center;gap:8px}
  .h-card b{font-size:17px;letter-spacing:.18em}
  .h-card span{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.65}
  @keyframes hFinger{0%,100%{transform:translateX(-22px)}50%{transform:translateX(22px)}}
  @keyframes hHoleT{0%,100%{transform:translateX(-22px)}50%{transform:translateX(22px)}}
  @keyframes hPhone{0%,100%{transform:rotate(-16deg)}50%{transform:rotate(16deg)}}
  @keyframes hHoleM{0%,100%{transform:translateX(-24px)}50%{transform:translateX(24px)}}
  .a-f{animation:hFinger 2.2s ease-in-out infinite}
  .a-ht{animation:hHoleT 2.2s ease-in-out infinite;animation-delay:.12s}
  .a-p{animation:hPhone 2.2s ease-in-out infinite;transform-origin:50px 40px;transform-box:view-box}
  .a-hm{animation:hHoleM 2.2s ease-in-out infinite;animation-delay:.25s}
  @keyframes hRing{from{stroke-dashoffset:126}to{stroke-dashoffset:0}}
</style>
<div data-k="hud" style="position:absolute;left:0;right:0;top:0;display:none;padding:14px 16px 0;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
    <div style="min-width:96px">
      <div data-k="score" style="font-size:30px;font-weight:800;letter-spacing:-.02em;line-height:1">0</div>
      <div style="margin-top:7px;width:96px;height:4px;background:rgba(31,28,24,.15);border-radius:2px;overflow:hidden"><div data-k="stab" style="height:100%;width:100%;background:${INK}"></div></div>
      <div data-k="shape" class="h-cap" style="margin-top:6px;opacity:.75">\u25cb CIRCLE</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:2px">
      <div data-k="flow" style="font-size:13px;font-weight:800;letter-spacing:.2em;opacity:0;transition:opacity .2s">FLOW \u00d7 01</div>
      <div data-k="next" style="display:none;align-items:center;gap:7px;border:1.5px solid ${INK};border-radius:999px;padding:4px 10px 4px 6px;background:rgba(239,233,223,.85)"></div>
    </div>
    <button class="h-btn" data-k="pause" style="padding:8px 13px;font-size:12px;letter-spacing:.1em">II</button>
  </div>
</div>
<div data-k="tilt" style="position:absolute;left:16px;display:none;width:44px;height:44px;border:1.5px solid rgba(31,28,24,.45);border-radius:50%">
  <div data-k="tiltdot" style="position:absolute;left:17px;top:17px;width:10px;height:10px;border-radius:50%;background:${INK}"></div>
</div>
<div class="h-panel" data-k="select" style="display:flex;background:rgba(232,226,216,.55)">
  <div style="font-size:54px;font-weight:900;letter-spacing:.3em;margin-right:-.3em">HOLE</div>
  <div class="h-cap">how do you want to move it?</div>
  <div style="display:flex;gap:14px;margin-top:6px">
    <div class="h-card" data-k="pickTouch">
      <svg width="110" height="80" viewBox="0 0 110 80"><ellipse cx="55" cy="58" rx="40" ry="10" fill="rgba(31,28,24,.08)"/>
        <g class="a-ht"><ellipse cx="55" cy="58" rx="12" ry="5" fill="${INK}"/></g>
        <g class="a-f"><circle cx="55" cy="26" r="9" fill="none" stroke="${INK}" stroke-width="2"/><circle cx="55" cy="26" r="3" fill="${INK}"/></g></svg>
      <b>TOUCH</b><span>drag to move</span>
    </div>
    <div class="h-card" data-k="pickMotion">
      <svg width="110" height="80" viewBox="0 0 110 80"><ellipse cx="55" cy="66" rx="40" ry="9" fill="rgba(31,28,24,.08)"/>
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
  <div class="h-cap">the hole closed</div>
  <div data-k="finalScore" style="font-size:64px;font-weight:900;letter-spacing:-.03em;line-height:1">0</div>
  <div data-k="best" class="h-cap"></div>
  <div class="h-cap" style="margin-top:8px">it became</div>
  <div data-k="history" style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;max-width:300px"></div>
  <button class="h-btn on" data-k="again" style="margin-top:14px;font-size:16px;padding:14px 34px">Again</button>
  <button class="h-btn" data-k="changeCtl" style="font-size:10px;padding:8px 14px">change control</button>
</div>`;
    const $ = (k) => ui.querySelector(`[data-k="${k}"]`);
    const el = {};
    ["hud", "score", "stab", "shape", "flow", "next", "pause", "tilt", "tiltdot", "select", "pickTouch", "pickMotion",
      "selectNote", "simBtn", "calib", "ring", "pausePanel", "mTouch", "mMotion", "motionOpts", "recal", "invert",
      "pauseNote", "resume", "restart", "over", "finalScore", "best", "history", "again", "changeCtl"].forEach((k) => { el[k] = $(k); });

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

    // ---- hole state shared with shaders ----
    const rDisp = new Float32Array(N);   // displayed + collidable aperture radii
    const rVel = new Float32Array(N);
    const hole = { x: 0, z: 3.4, vx: 0, vz: 0, yaw: 0, yawT: 0, scale: 1, pulse: 0, clunk: 0, tx: 0, tz: 3.4 };
    for (let i = 0; i < N; i++) rDisp[i] = BASE.circle[i];
    const holeUniforms = {
      uR: { value: rDisp },
      uHole: { value: new THREE.Vector2(hole.x, hole.z) },
      uYaw: { value: 0 }
    };

    // ---- slab: a plaster block with the aperture cut out per-fragment ----
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
    // the emitter slit objects rise out of
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(AX * 2, 0.08), new THREE.MeshBasicMaterial({ color: "#b9b0a2" }));
    slit.rotation.x = -Math.PI / 2;
    slit.position.set(0, 0.002, Z_SPAWN);
    scene.add(slit);

    // ---- shaft: the void's walls, rebuilt from rDisp every frame ----
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
    const pit = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshBasicMaterial({ color: "#0d0b0a" }));
    pit.rotation.x = -Math.PI / 2;
    scene.add(pit);

    // ---- lip: a bevelled rim that follows the aperture ----
    const LIP_W = 0.2;
    const lipGeo = new THREE.BufferGeometry();
    const lipPos = new Float32Array(N * 2 * 3);
    const lipIdx = [];
    for (let i = 0; i < N; i++) {
      const a = i, b = (i + 1) % N, c = N + i, d = N + ((i + 1) % N);
      lipIdx.push(a, b, c, b, d, c);
    }
    lipGeo.setIndex(lipIdx);
    lipGeo.setAttribute("position", new THREE.BufferAttribute(lipPos, 3));
    const lipMat = new THREE.MeshLambertMaterial({ color: "#3d5a80", side: THREE.DoubleSide });
    const lip = new THREE.Mesh(lipGeo, lipMat);
    lip.frustumCulled = false;
    lip.receiveShadow = true;
    scene.add(lip);
    // orientation notch so twisting is readable
    const notch = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshLambertMaterial({ color: "#1f1c18" }));
    scene.add(notch);
    // touch target ghost (touch mode) \u2014 shows where the hole is heading
    const ghost = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 24), new THREE.MeshBasicMaterial({ color: "#1f1c18", transparent: true, opacity: 0.0 }));
    ghost.rotation.x = -Math.PI / 2;
    scene.add(ghost);

    // consumption ripples on the slab
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
      line.rotation.y = hole.yaw;
      scene.add(line);
      ripples.push({ line, t: 0 });
    }

    // ------------------------------------------------------------------
    // Aperture morphing: weights over defined shapes, radii spring toward
    // the blended target so the outline physically transforms.
    // ------------------------------------------------------------------
    let W = { circle: 1 };
    const rTarget = new Float32Array(N);
    let stab = 1;
    let elapsed = 0;
    function dominant() {
      let k = "circle", m = -1;
      for (const key in W) if (W[key] > m) { m = W[key]; k = key; }
      return { key: k, w: m };
    }
    function shiftToward(key, amt) {
      for (const k in W) W[k] *= 1 - amt;
      W[key] = (W[key] || 0) + amt;
      for (const k in W) if (W[k] < 0.02 && k !== key) delete W[k];
      let s = 0; for (const k in W) s += W[k];
      for (const k in W) W[k] /= s;
    }
    function updateAperture(dt, closing) {
      const stabScale = 0.72 + 0.28 * smooth(0, 0.38, stab);
      hole.scale = closing ? Math.max(0, hole.scale - dt * 1.3) : lerp(hole.scale, stabScale, 1 - Math.exp(-dt * 4));
      const wob = Math.pow(1 - stab, 2) * 0.16 + hole.clunk * 0.05;
      for (let i = 0; i < N; i++) {
        let r = 0;
        for (const k in W) r += W[k] * BASE[k][i];
        const th = (TAU * i) / N;
        r = r * hole.scale * (1 + hole.pulse * 0.07) +
          wob * (0.6 * Math.sin(3 * th + elapsed * 2.3) + 0.4 * Math.sin(5 * th - elapsed * 3.4)) * hole.scale;
        rTarget[i] = Math.max(0, r);
      }
      // stiff, slightly underdamped spring per sample (substepped for stability)
      const steps = 3, h = dt / steps;
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < N; i++) {
          const acc = 120 * (rTarget[i] - rDisp[i]) - 15 * rVel[i];
          rVel[i] += acc * h;
          rDisp[i] = Math.max(0, rDisp[i] + rVel[i] * h);
        }
      }
    }
    function apertureArea() {
      let s = 0;
      for (let i = 0; i < N; i++) s += rDisp[i] * rDisp[i];
      return 0.5 * s * (TAU / N);
    }
    function rMaxNow() { let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, rDisp[i]); return m; }

    const tmpCol = new THREE.Color(), blackCol = new THREE.Color("#0b0908");
    function blendedColor(out) {
      out.setRGB(0, 0, 0);
      for (const k in W) { tmpCol.set(SHAPES[k].color); out.r += tmpCol.r * W[k]; out.g += tmpCol.g * W[k]; out.b += tmpCol.b * W[k]; }
      return out;
    }
    const shadeCol = new THREE.Color();
    const lipCol = new THREE.Color(), warnCol = new THREE.Color("#e2471f");
    function updateHoleMeshes() {
      holeUniforms.uHole.value.set(hole.x, hole.z);
      holeUniforms.uYaw.value = hole.yaw;
      blendedColor(lipCol);
      const warn = stab < 0.3 ? (0.5 + 0.5 * Math.sin(elapsed * 9)) * (0.3 - stab) / 0.3 : 0;
      lipCol.lerp(warnCol, Math.max(warn * 0.8, hole.clunk * 0.7));
      lipMat.color.copy(lipCol);
      const c = Math.cos(hole.yaw), s = Math.sin(hole.yaw);
      const shade = shadeCol;
      for (let rI = 0; rI < RING_Y.length; rI++) {
        shade.copy(lipCol).multiplyScalar(RING_SHADE[rI] * 0.7).lerp(blackCol, rI / RING_Y.length * 0.6);
        for (let i = 0; i < N; i++) {
          const th = (TAU * i) / N, r = rDisp[i] * (1 - rI * 0.012);
          const lx = Math.cos(th) * r, lz = Math.sin(th) * r;
          const o = (rI * N + i) * 3;
          shaftPos[o] = hole.x + lx * c + lz * s;
          shaftPos[o + 1] = RING_Y[rI];
          shaftPos[o + 2] = hole.z - lx * s + lz * c;
          shaftCol[o] = shade.r; shaftCol[o + 1] = shade.g; shaftCol[o + 2] = shade.b;
        }
      }
      shaftGeo.attributes.position.needsUpdate = true;
      shaftGeo.attributes.color.needsUpdate = true;
      for (let i = 0; i < N; i++) {
        const th = (TAU * i) / N;
        for (let k = 0; k < 2; k++) {
          const r = rDisp[i] + (k ? LIP_W : 0);
          const lx = Math.cos(th) * r, lz = Math.sin(th) * r;
          const o = (k * N + i) * 3;
          lipPos[o] = hole.x + lx * c + lz * s;
          lipPos[o + 1] = k ? 0.004 : 0.05;
          lipPos[o + 2] = hole.z - lx * s + lz * c;
        }
      }
      lipGeo.attributes.position.needsUpdate = true;
      lipGeo.computeVertexNormals();
      pit.position.set(hole.x, RING_Y[RING_Y.length - 1] + 0.01, hole.z);
      pit.scale.setScalar((rMaxNow() + 0.05) / 2.4);
      // notch sits on the lip at local angle -90deg ("12 o'clock" of the aperture)
      const nr = rDisp[Math.round(N * 0.75) % N] + LIP_W * 0.5;
      const nn = rotY(0, -nr, hole.yaw);
      notch.position.set(hole.x + nn[0], 0.06, hole.z + nn[1]);
      notch.visible = hole.scale > 0.05;
    }

    // ------------------------------------------------------------------
    // Objects
    // ------------------------------------------------------------------
    const CREAM = new THREE.Color("#f3eee6");
    const objects = [];
    let objId = 0;

    function fitPoints(poly) {
      const pts = [];
      const dense = poly.length > 16;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const sub = dense ? 1 : 4;
        for (let k = 0; k < sub; k++) {
          const t = k / sub;
          pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      return pts;
    }

    function buildMesh(o) {
      let geo;
      const BEV = 0.035;
      if (o.shape === "circle") {
        const r = Math.sqrt(o.area / Math.PI);
        geo = new THREE.SphereGeometry(r, 26, 18); geo.translate(0, r, 0);
        o.h = r * 2;
      } else if (o.shape === "oval") {
        const k = Math.sqrt(o.area / (Math.PI * 1.42 * 0.7));
        geo = new THREE.SphereGeometry(1, 26, 16);
        geo.scale(1.42 * k, 0.32 + 0.2 * k, 0.7 * k); geo.translate(0, 0.32 + 0.2 * k, 0);
        o.h = 2 * (0.32 + 0.2 * k);
      } else {
        const sh = new THREE.Shape();
        o.poly.forEach(([x, z], i) => {
          const sx = x * (1 - BEV / o.br), sz = z * (1 - BEV / o.br);
          if (i === 0) sh.moveTo(sx, -sz); else sh.lineTo(sx, -sz);
        });
        sh.closePath();
        o.h = o.kind === "danger" ? 0.36 : o.shape === "star" ? 0.34 : 0.3 + 0.42 * Math.sqrt(o.fill);
        geo = new THREE.ExtrudeGeometry(sh, { depth: o.h, bevelEnabled: true, bevelThickness: BEV, bevelSize: BEV, bevelSegments: 2, curveSegments: 4 });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, BEV, 0);
        o.h += BEV * 2;
      }
      const base = new THREE.Color(SHAPES[o.shape].color);
      if (o.kind === "basic") base.lerp(CREAM, 0.36);
      if (o.kind === "danger") base.set("#2a2522");
      o.mat = new THREE.MeshLambertMaterial({ color: base, emissive: o.kind === "danger" ? new THREE.Color("#ff3c12") : new THREE.Color(0) , emissiveIntensity: 0 });
      o.baseColor = base.clone();
      o.mesh = new THREE.Mesh(geo, o.mat);
      o.mesh.castShadow = true;
      o.mesh.receiveShadow = true;
      scene.add(o.mesh);
      if (o.kind === "transformer") {
        // floating outline of the shape this object will turn the hole into
        const pts = scaled(SHAPES[o.shape].poly, o.area * 1.9).map(([x, z]) => new THREE.Vector3(x, 0, z));
        pts.push(pts[0].clone());
        o.halo = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: SHAPES[o.shape].color }));
        scene.add(o.halo);
      }
    }

    function makeObject(opt) {
      const o = {
        id: ++objId, kind: opt.kind, shape: opt.shape, fill: opt.fill,
        x: opt.x, z: opt.z, y: 0, vx: 0, vz: 0, vy: 0,
        dvx: opt.dvx || 0, dvz: opt.dvz || 0, yaw: opt.yaw != null ? opt.yaw : rr(0, TAU), spin: opt.spin || 0,
        homing: opt.homing || 0, state: "rise", t: 0, clunkCd: 0, fast: !!opt.fast, settleYaw: 0
      };
      o.poly = o.shape === "irregular" ? scaled(jagged(7, 0.62, 1.0), opt.fill * A0) : scaled(SHAPES[o.shape].poly, opt.fill * A0);
      o.area = polyArea(o.poly);
      o.br = 0; o.poly.forEach(([x, z]) => { o.br = Math.max(o.br, Math.hypot(x, z)); });
      o.pts = fitPoints(o.poly);
      if (o.kind === "danger") o.shape = "irregular";
      buildMesh(o);
      o.mass = o.area * o.h;
      o.y = -o.h - 0.05;
      o.vx = o.dvx; o.vz = o.dvz;
      objects.push(o);
      syncMesh(o);
      return o;
    }

    function removeObject(o) {
      scene.remove(o.mesh); o.mesh.geometry.dispose(); o.mat.dispose();
      if (o.halo) { scene.remove(o.halo); o.halo.geometry.dispose(); o.halo.material.dispose(); }
      const i = objects.indexOf(o); if (i >= 0) objects.splice(i, 1);
    }

    function syncMesh(o) {
      o.mesh.position.set(o.x, o.y, o.z);
      o.mesh.rotation.y = o.yaw;
      if (o.halo) {
        o.halo.position.set(o.x, Math.max(o.y, 0) + o.h + 0.35 + Math.sin(elapsed * 3 + o.id) * 0.06, o.z);
        o.halo.rotation.y = o.yaw;
        const match = D.next && D.next === o.shape;
        o.halo.scale.setScalar(match ? 1 + 0.08 * Math.sin(elapsed * 6) : 1);
        o.halo.visible = o.state !== "fall";
      }
      if (o.kind === "danger" && o.state !== "fall") o.mat.emissiveIntensity = 0.18 + 0.18 * Math.sin(elapsed * 5 + o.id);
    }

    // Is this footprint inside the current aperture when centred on it at object yaw `yaw`?
    function fitMargin(o, yaw) {
      const rel = yaw - hole.yaw;
      let m = Infinity;
      for (let i = 0; i < o.pts.length; i++) {
        const p = rotY(o.pts[i][0], o.pts[i][1], rel);
        const r = Math.hypot(p[0], p[1]);
        const room = rAt(rDisp, Math.atan2(p[1], p[0])) - r;
        if (room < m) m = room;
        if (m < 0) return m;
      }
      return m;
    }
    const SETTLE = [0, 0.09, -0.09, 0.17, -0.17, 0.26, -0.26];   // up to \u00b115\u00b0: the toy-like "click" into a hole

    // ------------------------------------------------------------------
    // Fixtures: posts, bars (narrow passages), ramps, turntables. They rise
    // out of / sink into the slab between sections and collide for real.
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
        disc.receiveShadow = true;
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
      return f;
    }
    function clearFixtures() { fixtures.forEach((f) => { f.target = 0; }); }
    function fixturePos(f) {
      if (f.slide) return [f.x + Math.sin(elapsed * f.slide.w + f.slide.p) * f.slide.a, f.z];
      return [f.x, f.z];
    }
    function updateFixtures(dt) {
      for (let i = fixtures.length - 1; i >= 0; i--) {
        const f = fixtures[i];
        f.rise = clamp(f.rise + (f.target ? dt : -dt) * 1.4, 0, 1);
        const [fx, fz] = fixturePos(f);
        f.cx = fx; f.cz = fz;
        f.mesh.position.set(fx, lerp(-f.h - 0.05, 0, smooth(0, 1, f.rise)), fz);
        if (f.type === "turntable") f.mesh.rotation.y += f.omega * dt;
        if (!f.target && f.rise <= 0) {
          scene.remove(f.mesh);
          f.mesh.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
          fixtures.splice(i, 1);
        }
      }
    }
    // push a circle (x,z,r) out of solid fixtures; returns contact normal or null
    function collideCircle(x, z, r, forObject) {
      for (const f of fixtures) {
        if (f.rise < 0.6) continue;
        if (forObject && (f.type === "ramp" || f.type === "turntable")) continue;
        if (f.type === "post" || f.type === "turntable") {
          const dx = x - f.cx, dz = z - f.cz, d = Math.hypot(dx, dz), m = f.r + r;
          if (d < m && d > 1e-6) return { nx: dx / d, nz: dz / d, depth: m - d };
        } else if (f.type === "bar" || f.type === "ramp") {
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

    // ------------------------------------------------------------------
    // Input: one movement model, two mappings. Both produce a desired
    // velocity that goes through the same acceleration-limited integrator.
    // ------------------------------------------------------------------
    let mode = null;                 // "touch" | "motion"
    let simMotion = false;           // dev-only keyboard tilt
    let invertTilt = false;
    let tilt = null;                 // ctx.motion.tiltControl handle
    const simTilt = { x: 0, y: 0, kx: 0, ky: 0 };
    const inp = ctx.input.track(canvas, { tapMaxMs: 230, tapMaxDistance: 12 });
    const ray = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const tv = new THREE.Vector3(), ndc = new THREE.Vector2();
    let drag = null;
    function screenToGround(x, y) {
      ndc.set((x / ctx.width) * 2 - 1, -(y / ctx.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(ground, tv) ? [tv.x, tv.z] : null;
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
      if (!tilt) return { x: 0, y: 0 };
      return { x: tilt.x || 0, y: tilt.y || 0 };
    }
    const shapeCurve = (v) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 1.35);
    function desiredVelocity() {
      if (mode === "motion") {
        const t = readTilt();
        const ty = invertTilt ? -t.y : t.y;
        hole.tx = hole.x; hole.tz = hole.z;
        return [shapeCurve(t.x) * VMAX, shapeCurve(ty) * VMAX];
      }
      if (drag) {
        const dx = hole.tx - hole.x, dz = hole.tz - hole.z;
        let vx = dx * KP, vz = dz * KP;
        const l = Math.hypot(vx, vz);
        if (l > VMAX) { vx *= VMAX / l; vz *= VMAX / l; }
        return [vx, vz];
      }
      return [0, 0];
    }
    function handlePointer() {
      if (state !== "play") { drag = null; return; }
      if (inp.tap) twist();
      if (mode !== "touch") return;
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
    function twist() {
      hole.yawT -= TAP_TWIST;
      ctx.platform.interact({ kind: "twist" });
      sting("tap");
    }
    ctx.listen(window, "keydown", (e) => {
      if (e.key === "ArrowLeft") simTilt.kx = -0.7;
      if (e.key === "ArrowRight") simTilt.kx = 0.7;
      if (e.key === "ArrowUp") simTilt.ky = -0.7;
      if (e.key === "ArrowDown") simTilt.ky = 0.7;
      if (e.key === " " && state === "play") twist();
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
      hole.yaw = lerp(hole.yaw, hole.yawT, 1 - Math.exp(-dt * 14));
      hole.pulse = Math.max(0, hole.pulse - dt * 3.5);
      hole.clunk = Math.max(0, hole.clunk - dt * 3);
    }

    // ------------------------------------------------------------------
    // Scoring / feedback
    // ------------------------------------------------------------------
    const score = ctx.game.score();
    let best = 0, chain = 0, lastEat = -99, flowMult = 1;
    let history = [];
    const projV = new THREE.Vector3();
    function screenOf(x, y, z) {
      projV.set(x, y, z).project(camera);
      return { x: (projV.x + 1) / 2 * ctx.width, y: (1 - projV.y) / 2 * ctx.height };
    }
    function floatText(text, color, big) {
      try {
        const p = screenOf(hole.x, 0.3, hole.z);
        ctx.fx.floatText({ x: p.x, y: p.y - 30, text, color: color || INK, size: big ? 24 : 16 });
      } catch (e) { /* fx is optional */ }
    }
    function haptic(kind) { try { if (ctx.capabilities.haptics) ctx.platform.haptic(kind); } catch (e) { } }
    function sting(name) { try { if (audioOn) ctx.music.sting(name); } catch (e) { } }
    let audioOn = false, twistHinted = false;

    function consume(o, settleYaw) {
      o.state = "fall"; o.t = 0; o.settleYaw = settleYaw; o.vy = 0;
      o.fromX = o.x; o.fromZ = o.z; o.fromYaw = o.yaw;
      o.mesh.castShadow = false;
      const fill = o.area / Math.max(0.01, apertureArea());
      const gap = elapsed - lastEat;
      const fillNow = o.area / Math.max(0.01, apertureArea());
      const intentional = o.kind !== "basic" || fillNow >= 0.58 || o.shape === dominant().key;
      chain = gap < 3.4 ? chain + (intentional ? 2 : 1) : 1;
      lastEat = elapsed;
      flowMult = Math.min(8, 1 + Math.floor(chain / 3));
      const dom = dominant().key;
      let pts = 10, label = "+10", col = INK, big = false;
      const speed = Math.hypot(o.vx, o.vz);
      if (o.kind === "danger") {
        pts = 30; label = "RISK +30"; col = "#d8401b";
        stab = Math.max(0, stab - (0.3 + Math.min(0.12, D.wave * 0.012)));
        shiftToward("irregular", 0.32);
        haptic("warning"); sting("danger");
      } else {
        if (fill >= 0.58) {
          pts = 60; label = "PERFECT +60"; big = true; col = SHAPES[o.shape].color;
          stab = Math.min(1, stab + 0.22); haptic("medium"); sting("success");
        } else if (o.kind === "transformer") {
          pts = 20; label = "\u2192 " + SHAPES[o.shape].name; col = SHAPES[o.shape].color; big = true;
          stab = Math.min(1, stab + 0.12); haptic("medium"); sting("powerup");
        } else {
          if (o.shape === dom) { pts = 15; label = "MATCH +15"; }
          stab = Math.min(1, stab + 0.06); haptic("light"); sting("coin");
        }
        if (speed > 2.6) { pts += 10; label += " FAST"; }
        const amt = o.kind === "transformer" ? 0.62 : o.kind === "themed" ? 0.15 : 0.06 + 0.1 * o.fill;
        shiftToward(o.shape, amt);
      }
      const gained = pts * flowMult;
      score.add(gained, { reason: o.kind });
      floatText(flowMult > 1 ? `${label} \u00d7${flowMult}` : label, col, big);
      hole.pulse = 1;
      spawnRipple(o.kind === "danger" ? "#d8401b" : SHAPES[o.shape].color);
      ctx.platform.interact({ kind: "consume", object: o.kind, shape: o.shape });
      const d = dominant().key;
      if (history[history.length - 1] !== d) history.push(d);
    }

    function clunk(o) {
      o.clunkCd = 0.6;
      let nx = o.x - hole.x, nz = o.z - hole.z, l = Math.hypot(nx, nz);
      if (l < 0.05) { nx = -hole.vx; nz = -hole.vz; l = Math.hypot(nx, nz); }
      if (l < 0.05) { nx = 0; nz = 1; l = 1; }
      nx /= l; nz /= l;
      const push = 2.6 / Math.sqrt(Math.max(0.3, o.mass));
      o.vx += nx * push * 1.4; o.vz += nz * push * 1.4;
      o.x += nx * 0.08; o.z += nz * 0.08;
      o.vy = 1.6; o.y = 0.01;
      hole.clunk = 1;
      if (o.kind === "themed" && !twistHinted) { twistHinted = true; floatText("TAP TO TWIST", INK, true); }
      haptic("light"); sting("tap");
    }

    // ------------------------------------------------------------------
    // Object simulation (identical regardless of control mode)
    // ------------------------------------------------------------------
    function rampHeight(f, x, z) {
      if (f.type !== "ramp" || f.rise < 0.6) return -1;
      if (Math.abs(x - f.cx) > f.hw || Math.abs(z - f.cz) > f.hd) return -1;
      return f.H * ((z - (f.cz - f.hd)) / (f.hd * 2));
    }
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
            o.yaw += (hole.yaw - (o.lastHoleYaw ?? hole.yaw));
            o.mat.color.copy(o.baseColor).lerp(blackCol, clamp(-o.y / 2.2, 0, 0.95));
          }
          o.lastHoleYaw = hole.yaw;
          if (o.y < -3.2) { removeObject(o); continue; }
          syncMesh(o); continue;
        }
        if (o.state === "rise") {
          o.y = lerp(-o.h - 0.05, 0, smooth(0, 0.55, o.t));
          if (o.t >= 0.55) { o.state = "live"; o.y = 0; }
        }
        // drift (objects ride a slow air-table current), homing for dangers
        const k = 1 - Math.exp(-dt * 1.1);
        o.vx += (o.dvx - o.vx) * k; o.vz += (o.dvz - o.vz) * k;
        if (o.homing && o.state === "live") {
          const dx = hole.x - o.x, dz = hole.z - o.z, d = Math.hypot(dx, dz) + 0.001;
          if (d < 6) { o.vx += (dx / d) * o.homing * dt; o.vz += (dz / d) * o.homing * dt; }
        }
        o.x += o.vx * dt; o.z += o.vz * dt; o.yaw += o.spin * dt;
        // vertical: ramps (launch off the lip) and airborne arcs
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
            if (o.state !== "off" && o.y <= ground) {
              o.y = ground; o.vy = o.vy < -2.5 ? -o.vy * 0.25 : 0;
            }
          } else { o.y = ground; }
        }
        if (o.state === "off") {
          if (o.y < -6) { removeObject(o); continue; }
          syncMesh(o); continue;
        }
        // walls
        const lim = AX - o.br * 0.8;
        if (o.x < -lim) { o.x = -lim; o.vx = Math.abs(o.vx) * 0.6; o.dvx = Math.abs(o.dvx); }
        if (o.x > lim) { o.x = lim; o.vx = -Math.abs(o.vx) * 0.6; o.dvx = -Math.abs(o.dvx); }
        if (o.z < Z_BACK + o.br * 0.8 && o.state === "live") { o.z = Z_BACK + o.br * 0.8; o.vz = Math.abs(o.vz) * 0.6; o.dvz = Math.abs(o.dvz) + 0.2; }
        if (o.z > Z_EDGE && o.state === "live") { o.state = "off"; o.vy = 0; }
        // fixtures
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
        o.clunkCd = Math.max(0, o.clunkCd - dt);
        // the hole: consume if the footprint fits, rim-clunk if it doesn't
        if (state === "play" && o.state === "live" && o.y < 0.08) {
          const d = Math.hypot(o.x - hole.x, o.z - hole.z);
          const catchR = Math.max(0.28, 0.42 * hole.scale);
          if (d < catchR) {
            let found = null;
            for (const dy of SETTLE) { if (fitMargin(o, o.yaw + dy) > 0.012) { found = o.yaw + dy; break; } }
            if (found !== null) consume(o, found);
            else if (o.clunkCd <= 0) clunk(o);
          }
        }
        syncMesh(o);
      }
      // object-object contacts
      for (let i = 0; i < objects.length; i++) {
        const a = objects[i];
        if (a.state !== "live" || a.y > 0.3) continue;
        for (let j = i + 1; j < objects.length; j++) {
          const b = objects[j];
          if (b.state !== "live" || b.y > 0.3) continue;
          const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = (a.br + b.br) * 0.78;
          if (d < m && d > 1e-5) {
            const nx = dx / d, nz = dz / d, tot = a.mass + b.mass, pen = m - d;
            a.x -= nx * pen * (b.mass / tot); a.z -= nz * pen * (b.mass / tot);
            b.x += nx * pen * (a.mass / tot); b.z += nz * pen * (a.mass / tot);
            const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
            if (rv < 0) {
              const j2 = (-(1 + 0.45) * rv) / (1 / a.mass + 1 / b.mass);
              a.vx -= (j2 / a.mass) * nx; a.vz -= (j2 / a.mass) * nz;
              b.vx += (j2 / b.mass) * nx; b.vz += (j2 / b.mass) * nz;
              a.spin += rr(-0.4, 0.4); b.spin += rr(-0.4, 0.4);
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Director: scripted first 30 seconds, then endless sections that
    // alternate INTERLUDE (choose & transform) and WAVE (exploit your shape).
    // ------------------------------------------------------------------
    const D = { t: 0, phase: "intro", pt: 0, wave: 0, theme: null, next: null, timers: {}, fired: {} };
    function difficulty() { return Math.min(1, D.wave / 11); }
    function liveCount() { return objects.filter((o) => o.state !== "fall" && o.state !== "off").length; }
    function freeX(br, z) {
      for (let k = 0; k < 10; k++) {
        const x = rr(-AX + br, AX - br);
        if (!objects.some((o) => Math.hypot(o.x - x, o.z - z) < o.br + br + 0.15)) return x;
      }
      return null;
    }
    function spawnStatic(kind, shape, fill, x, z, spin) {
      return makeObject({ kind, shape, fill, x, z, dvx: 0, dvz: 0, spin: spin || 0, yaw: 0 });
    }
    function spawnDrift(kind, shape, fill, o) {
      o = o || {};
      if (liveCount() > 13) return null;
      const d = difficulty();
      const br = Math.sqrt((fill * A0) / Math.PI) * 1.4;
      let x = o.x != null ? o.x : freeX(br, Z_SPAWN);
      if (x == null) return null;
      let v = (o.speed != null ? o.speed : 0.75 + 1.4 * d) * rr(0.8, 1.2);
      const fast = o.fast || (d > 0.45 && kind === "basic" && rand() < 0.14);
      if (fast) v *= 2.1;
      const spinning = o.spin != null ? o.spin : (rand() < 0.12 + 0.5 * d ? rr(0.7, 1.6 + 1.2 * d) * (rand() < 0.5 ? -1 : 1) : rr(-0.15, 0.15));
      return makeObject({
        kind, shape, fill, x, z: Z_SPAWN, dvx: (o.dx != null ? o.dx : rr(-0.22, 0.22)) * v, dvz: v,
        spin: spinning, yaw: o.yaw, homing: kind === "danger" ? 0.5 + 1.0 * d : 0, fast
      });
    }
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    function randomBasic(maxFill) {
      const shape = pick(["circle", "circle", "square", "triangle", "hex", "rect", "oval", "star"]);
      return spawnDrift("basic", shape, rr(0.12, maxFill));
    }
    function chooseNext() {
      const dom = dominant().key;
      const opts = THEMES.filter((s) => s !== dom && s !== D.theme);
      return pick(opts);
    }
    function every(id, period, fn) {
      D.timers[id] = (D.timers[id] || 0) + D.dt;
      if (D.timers[id] >= period) { D.timers[id] -= period; fn(); }
    }
    function once(id, at, fn) { if (!D.fired[id] && D.pt >= at) { D.fired[id] = true; fn(); } }
    function setPhase(p) { D.phase = p; D.pt = 0; D.timers = {}; D.fired = {}; }
    function setFixturesFor(wave) {
      clearFixtures();
      const plans = {
        2: () => { addFixture({ type: "post", x: -2.1, z: -1.2, r: 0.42 }); addFixture({ type: "post", x: 2.1, z: -1.2, r: 0.42 }); },
        3: () => { addFixture({ type: "ramp", x: rr(-1.5, 1.5), z: -3.6, hw: 1.15, hd: 0.8, H: 0.42 }); },
        4: () => { addFixture({ type: "turntable", x: rand() < 0.5 ? -1.7 : 1.7, z: -2.6, r: 1.6, omega: rand() < 0.5 ? 1.3 : -1.3 }); },
        5: () => { addFixture({ type: "bar", x: -2.6, z: -2.2, hw: 1.6, hd: 0.2 }); addFixture({ type: "bar", x: 2.6, z: -2.2, hw: 1.6, hd: 0.2 }); },
        6: () => { addFixture({ type: "post", x: 0, z: -1.5, r: 0.45, slide: { a: 2.6, w: 1.1, p: 0 } }); addFixture({ type: "post", x: 0, z: -4.3, r: 0.38, slide: { a: 2.6, w: 1.1, p: Math.PI } }); }
      };
      if (plans[wave]) { plans[wave](); return; }
      if (wave < 2) return;
      const pool = [plans[2], plans[3], plans[4], plans[5], plans[6]];
      pick(pool)();
      if (rand() < 0.45) {
        const extra = pick([
          () => addFixture({ type: "post", x: rr(-2.5, 2.5), z: rr(0.5, 2.5), r: 0.36 }),
          () => addFixture({ type: "ramp", x: rr(-2, 2), z: -5.2, hw: 1.0, hd: 0.6, H: 0.35 }),
          () => addFixture({ type: "post", x: 0, z: 1.2, r: 0.36, slide: { a: 2.8, w: 1.5, p: 1 } })
        ]);
        extra();
      }
    }
    function startWave() {
      D.wave += 1; D.theme = D.next; D.next = null;
      setPhase("wave");
    }
    function startInterlude() {
      setPhase("interlude");
      D.next = chooseNext();
      setFixturesFor(D.wave + 1);
    }

    function updateDirector(dt) {
      D.dt = dt; D.t += dt; D.pt += dt;
      const d = difficulty();
      if (D.phase === "intro") {
        once("a", 0.15, () => {
          spawnStatic("basic", "circle", 0.2, -1.5, 1.4);
          spawnStatic("basic", "square", 0.92, 1.8, 0.9);
          spawnStatic("basic", "star", 0.78, 0.2, -1.6, 0);
        });
        once("b", 4.2, () => {
          spawnStatic("basic", "hex", 0.34, -2.3, -2.9);
          spawnStatic("transformer", "triangle", 0.27, 2.4, -3.4, 0.25);
          spawnStatic("basic", "square", 0.24, 0.3, -4.7);
        });
        once("loosen", 11, () => objects.forEach((o) => { if (!o.dvz && !o.dvx) { o.dvz = rr(0.35, 0.6); o.dvx = rr(-0.1, 0.1); } }));
        if (D.pt > 8 && D.pt < 15) every("e1", 1.9, () => randomBasic(0.4));
        if (D.pt > 15 && D.pt < 34) every("e2", 1.6, () => {
          const s = pick(["circle", "square", "triangle", "hex", "rect", "oval"]);
          spawnDrift("basic", s, rr(0.14, 0.42), { speed: 1.0 });
        });
        once("n", 24, () => {
          D.next = dominant().key === "square" ? "hex" : "square";
          // the strategic choice: valuable transformer far away, easy snacks close by
          spawnDrift("transformer", D.next, 0.26, { x: rand() < 0.5 ? -3.2 : 3.2, speed: 0.7, dx: 0, spin: 0.5 });
          spawnStatic("basic", "circle", 0.16, hole.x + 1.3 * (hole.x > 0 ? -1 : 1), clamp(hole.z - 1.2, -3, 5));
          spawnStatic("basic", "circle", 0.14, hole.x + 2.2 * (hole.x > 0 ? -1 : 1), clamp(hole.z - 2.4, -4, 4));
        });
        if (D.pt >= 34) startWave();
        return;
      }
      if (D.phase === "wave") {
        const len = 12;
        every("themed", Math.max(0.95, 1.7 - 0.7 * d), () => {
          // themed yaw sits on the 30deg twist grid so a twist can always line it up
          if (D.pt < len - 2) spawnDrift("themed", D.theme, rr(0.64, 0.7 + 0.14 * d), { speed: 0.8 + 1.1 * d, yaw: Math.floor(rand() * 12) * TAP_TWIST, spin: d > 0.5 && rand() < 0.4 ? rr(0.5, 1.2) : 0 });
        });
        every("snack", 3.2 - d, () => randomBasic(0.32));
        if (D.wave >= 2) {
          const n = 1 + Math.floor(d * 2.5);
          for (let i = 0; i < n; i++) once("dg" + i, 1.5 + (i * (len - 3)) / n, () => spawnDrift("danger", "irregular", rr(0.16, 0.26)));
        }
        if (D.pt >= len) startInterlude();
        return;
      }
      if (D.phase === "interlude") {
        const len = Math.max(7.5, 10 - 2.5 * d);
        once("t1", 0.8, () => spawnDrift("transformer", D.next, rr(0.22, 0.3), { x: rand() < 0.5 ? rr(-3.4, -2.4) : rr(2.4, 3.4), speed: 0.9 + 0.8 * d }));
        once("t2", len * 0.5, () => spawnDrift("transformer", D.next, rr(0.22, 0.28), { speed: 1.2 + 1.2 * d, spin: rr(1.0, 2.2) }));
        if (d > 0.3) once("decoy", 2.2, () => spawnDrift("transformer", pick(THEMES.filter((s) => s !== D.next)), 0.26));
        every("snack", Math.max(0.9, 1.5 - 0.5 * d), () => randomBasic(0.36));
        const n = Math.floor(d * 3) + (D.wave >= 1 ? 1 : 0);
        for (let i = 0; i < n; i++) once("dg" + i, 1.2 + (i * (len - 2)) / Math.max(1, n), () => spawnDrift("danger", "irregular", rr(0.16, 0.26)));
        if (D.pt >= len) startWave();
      }
    }

    function hunger() {
      if (D.phase === "intro") return D.pt < 24 ? 0.007 : 0.014;
      return 0.022 + 0.03 * difficulty();
    }

    // ------------------------------------------------------------------
    // HUD
    // ------------------------------------------------------------------
    let hudCache = {};
    function setText(k, v) { if (hudCache[k] !== v) { hudCache[k] = v; el[k].textContent = v; } }
    function updateHud() {
      setText("score", String(Math.round(score.value)));
      el.stab.style.width = `${Math.round(stab * 100)}%`;
      el.stab.style.background = stab < 0.3 ? "#d8401b" : INK;
      const dm = dominant();
      setText("shape", `${dm.w < 0.5 ? "\u2248 " : ""}${SHAPES[dm.key].glyph} ${SHAPES[dm.key].name}`);
      if (elapsed - lastEat > 3.4 && chain) { chain = 0; flowMult = 1; }
      el.flow.style.opacity = flowMult > 1 ? "1" : "0";
      setText("flow", `FLOW \u00d7 ${String(flowMult).padStart(2, "0")}`);
      let chip = "";
      if (D.next) {
        const left = D.phase === "intro" ? Math.max(0, 34 - D.pt) : Math.max(0, Math.max(7.5, 10 - 2.5 * difficulty()) - D.pt);
        const have = dominant().key === D.next;
        chip = `NEXT|${D.next}|${Math.ceil(left)}|${have}`;
      } else if (D.phase === "wave" && D.theme) {
        chip = `WAVE|${D.theme}|${Math.ceil(Math.max(0, 12 - D.pt))}|${dominant().key === D.theme}`;
      }
      if (hudCache.chip !== chip) {
        hudCache.chip = chip;
        if (!chip) el.next.style.display = "none";
        else {
          const [lab, key, secs, have] = chip.split("|");
          el.next.style.display = "flex";
          el.next.style.background = have === "true" ? INK : "rgba(239,233,223,.85)";
          el.next.style.color = have === "true" ? PAPER : INK;
          el.next.innerHTML = `${shapeSvg(key, 18)}<span style="font-size:11px;font-weight:800;letter-spacing:.18em">${lab} ${SHAPES[key].name}</span><span style="font-size:11px;opacity:.6;font-variant-numeric:tabular-nums">${secs}</span>`;
        }
      }
      if (mode === "motion" && state === "play") {
        const t = readTilt();
        el.tilt.style.display = "block";
        const ty = invertTilt ? -t.y : t.y;
        el.tiltdot.style.transform = `translate(${clamp(t.x, -1, 1) * 15}px, ${clamp(ty, -1, 1) * 15}px)`;
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
      SHAPES.irregular.poly = jagged(9, 0.55, 1.0); rebuildBase("irregular");
      W = { circle: 1 }; stab = 1;
      Object.assign(hole, { x: 0, z: 3.4, vx: 0, vz: 0, yaw: 0, yawT: 0, scale: 1, tx: 0, tz: 3.4, pulse: 0, clunk: 0 });
      Object.assign(D, { t: 0, phase: "intro", pt: 0, wave: 0, theme: null, next: null, timers: {}, fired: {} });
      score.reset({ reason: "new_run" });
      chain = 0; lastEat = -99; flowMult = 1; history = ["circle"]; hudCache = {};
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

    // motion: start from the tap, verify data actually flows, then calibrate
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
          } catch (e) { /* fall through, tilt stays null */ }
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
          el.simBtn.style.display = (navigator.maxTouchPoints || 0) === 0 ? "inline-block" : "none";
          state = "select";
          ctx.timeout(() => { if (state === "select" && !mode) { mode = "touch"; startRun(); } }, (navigator.maxTouchPoints || 0) === 0 ? 4000 : 2200);
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
      state = "select"; el.selectNote.textContent = "DEV: arrow keys tilt, space twists";
      calibrateThen(startRun);
    });

    // pause / settings
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
      el.finalScore.textContent = String(final);
      el.best.textContent = final >= best && final > 0 ? "best this session" : `best ${best}`;
      el.history.innerHTML = history.slice(-9).map((k, i) =>
        `${i ? '<span style="opacity:.4">\u2192</span>' : ""}${shapeSvg(k, 26)}`).join("");
      show("over", true);
      try { ctx.platform.fail({ score: final, waves: D.wave, mode }); } catch (e) { }
      if (final > 0) {
        score.submit("score", { label: `${final} pts` }).catch(() => { /* leaderboard is best-effort */ });
      }
    }

    // ------------------------------------------------------------------
    // Layout & camera: fit the whole arena, slightly elevated, never moves
    // ------------------------------------------------------------------
    const lookAt = new THREE.Vector3(0, 0, 0.3);
    const camDir = new THREE.Vector3(0, Math.sin(1.0), Math.cos(1.0)).normalize();
    function fitCamera() {
      camera.aspect = Math.max(0.2, ctx.width / Math.max(1, ctx.height));
      camera.updateProjectionMatrix();
      const topPad = 1 - (2 * (((ctx.safeArea || {}).top || 0) + 96)) / Math.max(1, ctx.height);
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
      el.tilt.style.top = `${(safeArea ? safeArea.top : 0) + 112}px`;
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
          stab = Math.max(0, stab - hunger() * dt);
          if (stab <= 0) { state = "closing"; sting("lose"); haptic("error"); show("hud", false); }
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
      const showGhost = mode === "touch" && drag && playing;
      ghost.material.opacity = lerp(ghost.material.opacity, showGhost ? 0.35 : 0, 0.2);
      ghost.position.set(hole.tx, 0.015, hole.tz);
      if (state === "play") updateHud();
    }

    // first frame before ready
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
        let dt = Math.min(dtMs / 1000, 1 / 20);
        const sub = dt > 1 / 50 ? 2 : 1;
        for (let i = 0; i < sub; i++) step(dt / sub);
      },
      render() {
        if (disposed) return;
        renderer.render(scene, camera);
      }
    });
  }
};
