import * as THREE from 'three';
import gsap from 'gsap';

/* An open 3D world the Bit can roam freely. Each constraint is a physical
   change to that world — a fence rises, a clock sweeps the floor, a beacon
   appears, chasers arrive, walls lift out of the ground, fog closes in,
   energy drains. The agent's behaviour responds to whatever is switched on. */

const OPEN_R = 58;
const BOUND_R = 16;
const ROUND = 20; // seconds on the clock

const BLOCKS = [
  [-9, -6, 7, 1.4],
  [-3, 4, 1.4, 8],
  [6, -3, 1.4, 9],
  [9, 8, 7, 1.4],
  [-10, 9, 1.4, 5],
  [1, -11, 8, 1.4],
  [-6, -12, 1.4, 4],
];

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function createWorld(host, { onEvent = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.setSize(1920, 1080, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const BG = new THREE.Color('#0b3a40');
  const scene = new THREE.Scene();
  scene.background = BG.clone();
  scene.fog = new THREE.Fog(BG.clone(), 40, 150);

  const camera = new THREE.PerspectiveCamera(36, 1920 / 1080, 0.5, 400);
  const cam = { dist: 74, height: 30, angle: 0.4, look: new THREE.Vector3() };

  const hemi = new THREE.HemisphereLight('#b8fff0', '#05242a', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd9a0', 1.6);
  sun.position.set(30, 50, 20);
  scene.add(sun);
  const lamp = new THREE.PointLight('#ff9a72', 0, 18, 1.6);
  scene.add(lamp);

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#0f4a4f', roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(400, 100, '#7fe8d6', '#7fe8d6');
  grid.material.transparent = true;
  grid.material.opacity = 0.16;
  grid.position.y = 0.01;
  scene.add(grid);

  // distant landforms: the open world goes on
  const land = new THREE.Group();
  const landMat = new THREE.MeshStandardMaterial({ color: '#126067', roughness: 1, flatShading: true });
  const spireMat = new THREE.MeshStandardMaterial({ color: '#1b7c7a', roughness: 0.9, flatShading: true });
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + Math.sin(i * 7) * 0.2;
    const r = 70 + ((i * 37) % 60);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + (i % 5) * 3, 0), landMat);
    m.scale.y = 0.45 + (i % 3) * 0.2;
    m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    m.rotation.y = i;
    land.add(m);
    if (i % 3 === 0) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(1.6, 14 + (i % 4) * 5, 5), spireMat);
      s.position.set(Math.cos(a + 0.1) * (r - 10), 6, Math.sin(a + 0.1) * (r - 10));
      land.add(s);
    }
  }
  scene.add(land);

  const blobTex = blobTexture();
  const blob = (size) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.02;
    return m;
  };

  // the Bit
  const agent = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 20), new THREE.MeshStandardMaterial({ color: '#ff6a55', emissive: '#c8341f', emissiveIntensity: 0.55, roughness: 0.35 }));
  agent.position.set(0, 0.9, 0);
  scene.add(agent);
  const agentShadow = blob(3.2);
  scene.add(agentShadow);
  const trail = [];
  const trailMat = new THREE.MeshBasicMaterial({ color: '#ff9a72', transparent: true, opacity: 0.5 });
  const trailGeo = new THREE.CircleGeometry(0.18, 8);
  for (let i = 0; i < 40; i++) {
    const d = new THREE.Mesh(trailGeo, trailMat.clone());
    d.rotation.x = -Math.PI / 2;
    d.position.y = 0.03;
    d.visible = false;
    scene.add(d);
    trail.push(d);
  }

  /* ---------- constraint objects ---------- */
  // SPACE: a fence of posts
  const fence = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: '#f5ead3', roughness: 0.6 });
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.6, 0.5), postMat);
    p.position.set(Math.cos(a) * BOUND_R, 1.3, Math.sin(a) * BOUND_R);
    p.scale.y = 0.001;
    p.visible = false;
    fence.add(p);
  }
  scene.add(fence);

  // TIME: a dial sweeping the floor
  const dialMat = new THREE.MeshBasicMaterial({ color: '#ffc94a', transparent: true, opacity: 0.0, side: THREE.DoubleSide });
  const dial = new THREE.Mesh(new THREE.RingGeometry(BOUND_R + 1.2, BOUND_R + 2.6, 96, 1, Math.PI / 2, Math.PI * 2), dialMat);
  dial.rotation.x = -Math.PI / 2;
  dial.position.y = 0.04;
  scene.add(dial);

  // OBJECTIVE: a beacon
  const beacon = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 30, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ffc94a', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 15;
  const pad = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.22, 10, 48), new THREE.MeshStandardMaterial({ color: '#ffc94a', emissive: '#ffb020', emissiveIntensity: 0.8 }));
  pad.rotation.x = Math.PI / 2;
  pad.position.y = 0.3;
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshStandardMaterial({ color: '#fff1c4', emissive: '#ffc94a', emissiveIntensity: 1 }));
  core.position.y = 2.2;
  beacon.add(beam, pad, core);
  beacon.scale.setScalar(0.001);
  beacon.visible = false;
  scene.add(beacon);

  // ENEMIES
  const enemies = [];
  const enemyMat = new THREE.MeshStandardMaterial({ color: '#7a45d6', emissive: '#3a1660', emissiveIntensity: 0.6, roughness: 0.4, flatShading: true });
  for (let i = 0; i < 3; i++) {
    const e = new THREE.Mesh(new THREE.TetrahedronGeometry(1.2), enemyMat);
    e.position.set(Math.cos(i * 2.1) * 12, 1.2, Math.sin(i * 2.1) * 12);
    e.scale.setScalar(0.001);
    e.visible = false;
    const sh = blob(3);
    sh.visible = false;
    scene.add(e, sh);
    enemies.push({ m: e, sh, vx: 0, vz: 0 });
  }

  // LIVES: orbiting hearts
  const lives = [];
  for (let i = 0; i < 3; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10), new THREE.MeshStandardMaterial({ color: '#ff8a6a', emissive: '#ff6a55', emissiveIntensity: 0.9 }));
    l.scale.setScalar(0.001);
    l.visible = false;
    scene.add(l);
    lives.push(l);
  }

  // LEVEL DESIGN: walls rise out of the floor
  const blocks = BLOCKS.map(([x, z, w, d], i) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), new THREE.MeshStandardMaterial({ color: i % 2 ? '#2a8f86' : '#1f6f6c', roughness: 0.7 }));
    b.position.set(x, -1.6, z);
    b.visible = false;
    scene.add(b);
    return { m: b, x, z, w, d };
  });

  // RESOURCES: energy ring and fuel cells
  const energyRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 64, 1, Math.PI / 2, Math.PI * 2), new THREE.MeshBasicMaterial({ color: '#ffc94a', transparent: true, opacity: 0, side: THREE.DoubleSide }));
  energyRing.rotation.x = -Math.PI / 2;
  energyRing.position.y = 0.05;
  scene.add(energyRing);
  const cells = [];
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: '#ffe7a0', emissive: '#ffc94a', emissiveIntensity: 0.7 }));
    c.scale.setScalar(0.001);
    c.visible = false;
    scene.add(c);
    cells.push(c);
  }

  /* ---------- state ---------- */
  const on = {};
  const S = {
    playR: OPEN_R,
    heading: 0,
    speed: 7,
    clock: ROUND,
    score: 0,
    hearts: 3,
    energy: 1,
    hurt: 0,
    fog: { near: 40, far: 150 },
    dark: 0,
    t: 0,
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const randomSpot = (r) => {
    for (let k = 0; k < 40; k++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(3, r);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!on.level || !blocks.some((b) => Math.abs(x - b.x) < b.w / 2 + 1.5 && Math.abs(z - b.z) < b.d / 2 + 1.5)) return [x, z];
    }
    return [0, 0];
  };
  const innerR = () => (on.space ? BOUND_R - 2 : on.level || on.goal || on.enemies || on.resources ? 22 : OPEN_R);

  function pop(obj, show, s = 1, delay = 0) {
    gsap.killTweensOf(obj.scale);
    if (show) {
      obj.visible = true;
      gsap.fromTo(obj.scale, { x: 0.001, y: 0.001, z: 0.001 }, { x: s, y: s, z: s, duration: 0.7, delay, ease: 'back.out(2.2)' });
    } else gsap.to(obj.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35, delay, ease: 'power2.in', onComplete: () => (obj.visible = false) });
  }

  function set(key, value) {
    if (!!on[key] === value) return;
    on[key] = value;
    if (key === 'space') {
      fence.children.forEach((p, i) => {
        gsap.killTweensOf(p.scale);
        if (value) {
          p.visible = true;
          gsap.to(p.scale, { y: 1, duration: 0.55, delay: i * 0.008, ease: 'back.out(2.4)' });
        } else gsap.to(p.scale, { y: 0.001, duration: 0.3, delay: i * 0.004, onComplete: () => (p.visible = false) });
      });
      gsap.to(S, { playR: value ? BOUND_R - 2 : OPEN_R, duration: 1.2, ease: 'power3.inOut' });
    }
    if (key === 'time') {
      S.clock = ROUND;
      gsap.to(dialMat, { opacity: value ? 0.85 : 0, duration: 0.5 });
    }
    if (key === 'goal') {
      if (value) {
        const [x, z] = randomSpot(Math.min(innerR(), 18));
        beacon.position.set(x, 0, z);
        S.score = 0;
      }
      pop(beacon, value);
    }
    if (key === 'enemies') {
      enemies.forEach((e, i) => {
        if (value) {
          const [x, z] = randomSpot(Math.min(innerR(), 18));
          e.m.position.set(x, 1.2, z);
        }
        pop(e.m, value, 1, i * 0.12);
        e.sh.visible = value;
      });
    }
    if (key === 'lives') {
      S.hearts = 3;
      lives.forEach((l, i) => pop(l, value, 1, i * 0.1));
    }
    if (key === 'level') {
      blocks.forEach((b, i) => {
        gsap.killTweensOf(b.m.position);
        if (value) {
          b.m.visible = true;
          gsap.to(b.m.position, { y: 1.5, duration: 0.8, delay: i * 0.07, ease: 'back.out(1.8)' });
        } else gsap.to(b.m.position, { y: -1.6, duration: 0.4, delay: i * 0.03, onComplete: () => (b.m.visible = false) });
      });
    }
    if (key === 'info') {
      gsap.to(S.fog, { near: value ? 20 : 40, far: value ? 90 : 150, duration: 1.4, ease: 'power2.inOut' });
      gsap.to(S, { dark: value ? 0.35 : 0, duration: 1.4 });
    }
    if (key === 'resources') {
      S.energy = 1;
      gsap.to(energyRing.material, { opacity: value ? 0.9 : 0, duration: 0.4 });
      cells.forEach((c, i) => {
        if (value) {
          const [x, z] = randomSpot(Math.min(innerR(), 18));
          c.position.set(x, 0.8, z);
        }
        pop(c, value, 1, i * 0.08);
      });
    }
    onEvent({ type: 'set', key, value });
  }

  /* ---------- simulation ---------- */
  const v2 = (x, z) => ({ x, z });
  function steer(dt) {
    const p = agent.position;
    let dx = Math.cos(S.heading);
    let dz = Math.sin(S.heading);
    // free roaming: a lazy, curving wander
    S.heading += (Math.sin(S.t * 0.7) * 0.9 + Math.sin(S.t * 1.9) * 0.6) * dt;
    let want = null;
    if (on.resources && S.energy < 0.45) {
      let best = null;
      let bd = Infinity;
      cells.forEach((c) => {
        if (!c.visible) return;
        const d = Math.hypot(c.position.x - p.x, c.position.z - p.z);
        if (d < bd) {
          bd = d;
          best = c;
        }
      });
      if (best) want = v2(best.position.x, best.position.z);
    }
    if (!want && on.goal) want = v2(beacon.position.x, beacon.position.z);
    if (want) {
      const wx = want.x - p.x;
      const wz = want.z - p.z;
      const wd = Math.hypot(wx, wz) || 1;
      dx = dx * 0.25 + (wx / wd) * 0.75;
      dz = dz * 0.25 + (wz / wd) * 0.75;
    }
    // flee chasers
    if (on.enemies)
      enemies.forEach((e) => {
        const ex = p.x - e.m.position.x;
        const ez = p.z - e.m.position.z;
        const d = Math.hypot(ex, ez) || 1;
        if (d < 7) {
          dx += (ex / d) * (7 - d) * 0.5;
          dz += (ez / d) * (7 - d) * 0.5;
        }
      });
    // stay in bounds
    const pr = Math.hypot(p.x, p.z);
    const R = Math.min(S.playR, innerR());
    if (pr > R - 4) {
      dx -= (p.x / pr) * (pr - (R - 4)) * 0.6;
      dz -= (p.z / pr) * (pr - (R - 4)) * 0.6;
    }
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    // turn smoothly toward the desired direction
    const target = Math.atan2(dz, dx);
    let da = target - S.heading;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    S.heading += da * Math.min(1, dt * 4);
    let speed = S.speed * (on.resources ? 0.25 + 0.75 * Math.min(1, S.energy * 2.5) : 1);
    if (on.info) speed *= 0.8;
    p.x += Math.cos(S.heading) * speed * dt;
    p.z += Math.sin(S.heading) * speed * dt;

    // hard boundary
    const r2 = Math.hypot(p.x, p.z);
    if (r2 > S.playR) {
      p.x *= S.playR / r2;
      p.z *= S.playR / r2;
      S.heading += Math.PI * 0.6;
    }
    // walls
    if (on.level)
      blocks.forEach((b) => {
        if (b.m.position.y < 0.5) return;
        const cx = Math.max(b.x - b.w / 2, Math.min(p.x, b.x + b.w / 2));
        const cz = Math.max(b.z - b.d / 2, Math.min(p.z, b.z + b.d / 2));
        const ox = p.x - cx;
        const oz = p.z - cz;
        const od = Math.hypot(ox, oz);
        if (od < 1.0) {
          const k = (1.0 - od) / (od || 1);
          p.x += ox * k;
          p.z += oz * k;
          S.heading += 0.9;
        }
      });
    return speed;
  }

  let raf;
  let last = performance.now();
  const tmp = new THREE.Color();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    S.t += dt;
    const speed = steer(dt);
    const p = agent.position;
    // bounce in step with movement: the Bit rolls with weight
    p.y = 0.9 + Math.abs(Math.sin(S.t * 6)) * 0.35 * (speed / S.speed);
    agent.rotation.z -= speed * dt * 0.9;
    agentShadow.position.set(p.x, 0.02, p.z);
    lamp.position.set(p.x, 3, p.z);

    // trail
    if (Math.floor(S.t * 12) !== Math.floor((S.t - dt) * 12)) {
      const d = trail.shift();
      d.position.set(p.x, 0.03, p.z);
      d.visible = true;
      d.material.opacity = 0.55;
      trail.push(d);
    }
    trail.forEach((d) => (d.material.opacity *= 0.985));

    // clock
    if (on.time) {
      S.clock -= dt;
      if (S.clock <= 0) {
        S.clock = ROUND;
        onEvent({ type: 'timeup' });
        gsap.fromTo(dial.scale, { x: 1.15, y: 1.15 }, { x: 1, y: 1, duration: 0.8, ease: 'elastic.out(1, 0.4)' });
        if (on.goal) S.score = 0;
      }
      const f = S.clock / ROUND;
      dial.geometry.dispose();
      const r0 = Math.min(S.playR, innerR()) + (on.space ? 3.5 : 1.5);
      dial.geometry = new THREE.RingGeometry(r0, r0 + 1.2, 96, 1, Math.PI / 2, Math.PI * 2 * f);
      dialMat.color.set(f < 0.25 ? '#ff6a55' : '#ffc94a');
    }
    // beacon
    if (on.goal && beacon.visible) {
      core.rotation.y += dt * 2;
      core.position.y = 2.2 + Math.sin(S.t * 3) * 0.3;
      if (Math.hypot(beacon.position.x - p.x, beacon.position.z - p.z) < 1.8) {
        S.score += 1;
        onEvent({ type: 'goal', score: S.score });
        const [x, z] = randomSpot(Math.min(innerR(), 18));
        gsap.to(beacon.scale, {
          x: 0.001,
          y: 0.001,
          z: 0.001,
          duration: 0.2,
          onComplete: () => {
            beacon.position.set(x, 0, z);
            gsap.to(beacon.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(2.5)' });
          },
        });
      }
    }
    // chasers
    S.hurt = Math.max(0, S.hurt - dt);
    if (on.enemies)
      enemies.forEach((e, i) => {
        const m = e.m;
        const ex = p.x - m.position.x;
        const ez = p.z - m.position.z;
        const d = Math.hypot(ex, ez) || 1;
        const sp = 4.6;
        e.vx += ((ex / d) * sp - e.vx) * dt * 2;
        e.vz += ((ez / d) * sp - e.vz) * dt * 2;
        // keep apart from each other
        enemies.forEach((o, j) => {
          if (i === j) return;
          const ox = m.position.x - o.m.position.x;
          const oz = m.position.z - o.m.position.z;
          const od = Math.hypot(ox, oz) || 1;
          if (od < 3) {
            e.vx += (ox / od) * 3 * dt;
            e.vz += (oz / od) * 3 * dt;
          }
        });
        m.position.x += e.vx * dt;
        m.position.z += e.vz * dt;
        const er = Math.hypot(m.position.x, m.position.z);
        if (er > S.playR) {
          m.position.x *= S.playR / er;
          m.position.z *= S.playR / er;
        }
        m.position.y = 1.2 + Math.sin(S.t * 4 + i) * 0.2;
        m.rotation.y += dt * 3;
        m.rotation.x += dt * 1.3;
        e.sh.position.set(m.position.x, 0.02, m.position.z);
        if (d < 1.9 && S.hurt <= 0) {
          S.hurt = 1.2;
          S.heading = Math.atan2(ez, ex) + Math.PI;
          p.x -= (ex / d) * -2.5;
          p.z -= (ez / d) * -2.5;
          gsap.fromTo(agent.scale, { x: 1.5, y: 0.6, z: 1.5 }, { x: 1, y: 1, z: 1, duration: 0.7, ease: 'elastic.out(1.2, 0.3)' });
          if (on.lives) {
            S.hearts -= 1;
            if (S.hearts <= 0) {
              S.hearts = 3;
              onEvent({ type: 'over' });
              lives.forEach((l, k) => pop(l, true, 1, k * 0.1));
            } else pop(lives[S.hearts], false);
          }
          onEvent({ type: 'hit' });
        }
      });
    // hearts orbit
    if (on.lives)
      lives.forEach((l, i) => {
        const a = S.t * 2.2 + (i / 3) * Math.PI * 2;
        l.position.set(p.x + Math.cos(a) * 1.9, 1.3 + Math.sin(S.t * 3 + i) * 0.2, p.z + Math.sin(a) * 1.9);
      });
    // energy
    if (on.resources) {
      S.energy = Math.max(0, S.energy - dt * 0.07);
      energyRing.position.set(p.x, 0.05, p.z);
      energyRing.geometry.dispose();
      energyRing.geometry = new THREE.RingGeometry(1.5, 1.85, 48, 1, Math.PI / 2, Math.max(0.01, Math.PI * 2 * S.energy));
      energyRing.material.color.set(S.energy < 0.3 ? '#ff6a55' : '#ffc94a');
      cells.forEach((c) => {
        if (!c.visible || c.scale.x < 0.5) return;
        c.rotation.y += dt;
        c.rotation.x += dt * 0.6;
        if (Math.hypot(c.position.x - p.x, c.position.z - p.z) < 1.6) {
          S.energy = Math.min(1, S.energy + 0.5);
          onEvent({ type: 'fuel' });
          const [x, z] = randomSpot(Math.min(innerR(), 18));
          gsap.to(c.scale, {
            x: 0.001,
            y: 0.001,
            z: 0.001,
            duration: 0.2,
            onComplete: () => {
              c.position.set(x, 0.8, z);
              gsap.to(c.scale, { x: 1, y: 1, z: 1, duration: 0.5, delay: 0.6, ease: 'back.out(2.5)' });
            },
          });
        }
      });
    }

    // atmosphere: information hides the world
    scene.fog.near = S.fog.near;
    scene.fog.far = S.fog.far;
    tmp.set('#0b3a40').lerp(new THREE.Color('#03161a'), S.dark);
    scene.background.copy(tmp);
    scene.fog.color.copy(tmp);
    hemi.intensity = 1.1 - S.dark * 0.75;
    sun.intensity = 1.6 - S.dark * 1.3;
    lamp.intensity = S.dark * 40;

    // camera: wide over the open world, closing in as space shrinks
    const tight = 1 - (S.playR - BOUND_R) / (OPEN_R - BOUND_R);
    const busy = on.level || on.goal || on.enemies || on.resources ? 1 : 0;
    const targetDist = 74 - Math.max(tight, busy * 0.45) * 30 - S.dark * 8;
    cam.dist += (targetDist - cam.dist) * dt * 1.5;
    cam.height = cam.dist * 0.48;
    cam.angle += dt * 0.035;
    const follow = tight > 0.5 ? 0.15 : 0.55;
    cam.look.x += (p.x * follow - cam.look.x) * dt * 1.5;
    cam.look.z += (p.z * follow - cam.look.z) * dt * 1.5;
    camera.position.set(cam.look.x + Math.cos(cam.angle) * cam.dist, cam.height, cam.look.z + Math.sin(cam.angle) * cam.dist);
    camera.lookAt(cam.look.x, 0, cam.look.z);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const proj = new THREE.Vector3();
  return {
    set,
    state: S,
    on,
    // the Bit's position on the 1920×1080 stage, for the fog-of-war overlay
    screen() {
      proj.copy(agent.position).project(camera);
      return { x: (proj.x * 0.5 + 0.5) * 1920, y: (-proj.y * 0.5 + 0.5) * 1080 };
    },
    clear() {
      Object.keys(on).forEach((k) => on[k] && set(k, false));
    },
    dispose() {
      cancelAnimationFrame(raf);
      gsap.killTweensOf(S);
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    },
  };
}
