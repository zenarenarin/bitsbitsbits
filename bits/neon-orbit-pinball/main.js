window.plethoraBit = {
  meta: {
    title: "Neon Orbit Pinball",
    runtime: "plethora-bit@2",
    tags: ["arcade", "pinball"],
    permissions: ["haptics", "backgroundMusic"]
  },

  async init(ctx) {
    // ---- Table geometry (world units, floor plane = XZ, Y up) ----
    const R = 11;                 // half-width & top-cap radius
    const CAP_Z = 9;               // cap circle center z / straight-side start
    const SIDE_BOTTOM_Z = 32;      // where side walls taper into the funnels
    const FUNNEL_X = 5;            // x of funnel end / flipper pivots
    const FLIPPER_Z = 36;          // flipper pivot z
    const DRAIN_Z = 42;            // past this with no save = ball lost
    const BALL_R = 0.9;
    const FLOOR_Y = 0;

    const GRAVITY = 46;
    const WALL_REST = 0.42;
    const BUMPER_REST = 0.85;
    const BUMPER_KICK = 15;
    const FLIPPER_RADIUS = 1.05;
    const FLIPPER_REST = 0.25;
    const FLIPPER_TRANSFER = 0.85;
    const FLIPPER_SPEED = 80;
    const MAX_SPEED = 62;
    const LAUNCH = { x: 8.0, z: 33.0 };
    const CHARGE_MS = 900;

    function seg(x1, z1, x2, z2) { return { x1, z1, x2, z2 }; }

    const wallSegs = [
      seg(-R, CAP_Z, -R, SIDE_BOTTOM_Z),
      seg(-R, SIDE_BOTTOM_Z, -FUNNEL_X, FLIPPER_Z),
      seg(R, CAP_Z, R, SIDE_BOTTOM_Z),
      seg(R, SIDE_BOTTOM_Z, FUNNEL_X, FLIPPER_Z)
    ];
    const CAP_STEPS = 16;
    for (let i = 0; i < CAP_STEPS; i++) {
      const a0 = Math.PI - (Math.PI * i) / CAP_STEPS;
      const a1 = Math.PI - (Math.PI * (i + 1)) / CAP_STEPS;
      wallSegs.push(seg(
        R * Math.cos(a0), CAP_Z - R * Math.sin(a0),
        R * Math.cos(a1), CAP_Z - R * Math.sin(a1)
      ));
    }

    const bumpers = [
      { x: -4.5, z: 14, r: 2.1, color: 0xff2bd6, flash: 0 },
      { x: 4.5, z: 14, r: 2.1, color: 0x2bd6ff, flash: 0 },
      { x: 0, z: 20, r: 2.3, color: 0xfff02b, flash: 0 }
    ];

    const flippers = [
      {
        side: "left",
        pivot: { x: -FUNNEL_X, z: FLIPPER_Z },
        restTip: { x: -11.2, z: 38.6 },
        activeTip: { x: 1.6, z: 33.4 },
        tip: { x: -11.2, z: 38.6 },
        prevTip: { x: -11.2, z: 38.6 },
        active: false,
        hapticFired: false
      },
      {
        side: "right",
        pivot: { x: FUNNEL_X, z: FLIPPER_Z },
        restTip: { x: 11.2, z: 38.6 },
        activeTip: { x: -1.6, z: 33.4 },
        tip: { x: 11.2, z: 38.6 },
        prevTip: { x: 11.2, z: 38.6 },
        active: false,
        hapticFired: false
      }
    ];

    function closestPoint(px, pz, x1, z1, x2, z2) {
      const dx = x2 - x1, dz = z2 - z1;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq > 0 ? ((px - x1) * dx + (pz - z1) * dz) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      return { x: x1 + dx * t, z: z1 + dz * t, t };
    }

    const canvas = ctx.createCanvas({ touchAction: "none" });

    // ---- HUD (drawn immediately, on top of the canvas, so the first frame is never blank) ----
    const root = ctx.createRoot({ style: { pointerEvents: "none" } });
    root.innerHTML =
      '<style>' +
      '.no-hud{position:absolute;inset:0;font-family:"Press Start 2P",monospace;color:#f2f2ff}' +
      '.hud-top{position:absolute;top:8px;left:0;right:0;display:flex;justify-content:space-between;align-items:flex-start;padding:0 10px;pointer-events:none}' +
      '.hud-score{font-size:20px;text-shadow:0 0 8px #ff2bd6,0 0 2px #fff}' +
      '.hud-balls{font-size:14px;color:#2bd6ff;text-shadow:0 0 6px #2bd6ff;margin-top:4px}' +
      '.hud-info{pointer-events:auto;background:rgba(20,10,40,0.6);border:1px solid #7a3bff;color:#e8d6ff;border-radius:50%;width:26px;height:26px;font-size:12px;line-height:26px;text-align:center}' +
      '.hud-msg{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;text-shadow:0 0 10px #ff2bd6}' +
      '.hud-msg .big{font-size:16px;margin-bottom:10px;color:#fff}' +
      '.hud-msg .small{font-size:10px;color:#2bd6ff;line-height:1.9}' +
      '.hud-msg.tap{pointer-events:auto}' +
      '.charge-wrap{position:absolute;right:14px;bottom:26%;width:10px;height:120px;border:1px solid #7a3bff;background:rgba(20,10,40,0.5);pointer-events:none}' +
      '.charge-fill{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(#fff02b,#ff2bd6);height:0%}' +
      '</style>' +
      '<div class="no-hud">' +
      '<div class="hud-top">' +
      '<div><div class="hud-score" id="score">0</div><div class="hud-balls" id="balls">● ● ●</div></div>' +
      '<div class="hud-info" id="info">i</div>' +
      '</div>' +
      '<div class="hud-msg tap" id="msg"><div class="big">NEON ORBIT</div><div class="small">TAP TO START</div></div>' +
      '<div class="charge-wrap" id="chargeWrap" style="display:none"><div class="charge-fill" id="chargeFill"></div></div>' +
      '</div>';

    const scoreEl = root.querySelector("#score");
    const ballsEl = root.querySelector("#balls");
    const msgEl = root.querySelector("#msg");
    const infoEl = root.querySelector("#info");
    const chargeWrap = root.querySelector("#chargeWrap");
    const chargeFill = root.querySelector("#chargeFill");

    ctx.markVisualReady("hud-shown");

    // ---- Three.js scene ----
    const THREE = await ctx.importModule("three", "0.164.1");

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || 1, 2));
    renderer.setSize(ctx.width, ctx.height);
    renderer.setClearColor(0x05010f, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x05010f, 42, 95);

    const camera = new THREE.PerspectiveCamera(56, ctx.width / ctx.height, 0.1, 200);
    camera.position.set(0, 42, FLIPPER_Z + 28);
    camera.lookAt(0, 0, 17);

    scene.add(new THREE.AmbientLight(0x40406a, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(12, 40, -8);
    scene.add(key);
    const rim = new THREE.PointLight(0xff2bd6, 1.4, 60);
    rim.position.set(0, 14, 14);
    scene.add(rim);

    const floorSpan = R * 2 + 6;
    const floorLen = DRAIN_Z - CAP_Z + R + 6;
    const floorCenterZ = (CAP_Z - R + DRAIN_Z) / 2;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSpan, floorLen),
      new THREE.MeshStandardMaterial({ color: 0x0b0620, metalness: 0.25, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y - 0.5, floorCenterZ);
    scene.add(floor);

    const grid = new THREE.GridHelper(Math.max(floorSpan, floorLen), 22, 0xff2bd6, 0x22164a);
    grid.position.set(0, FLOOR_Y - 0.45, floorCenterZ);
    scene.add(grid);

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x2bd6ff, emissive: 0x2bd6ff, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.4
    });
    const wallGroup = new THREE.Group();
    for (const s of wallSegs) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.001) continue;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, 0.6), wallMat);
      mesh.position.set((s.x1 + s.x2) / 2, FLOOR_Y + 1.1, (s.z1 + s.z2) / 2);
      mesh.rotation.y = -Math.atan2(dz, dx);
      wallGroup.add(mesh);
    }
    scene.add(wallGroup);

    const bumperMeshes = bumpers.map(b => {
      const mat = new THREE.MeshStandardMaterial({
        color: b.color, emissive: b.color, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.35
      });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 2.4, 20), mat);
      mesh.position.set(b.x, FLOOR_Y + 1.2, b.z);
      scene.add(mesh);
      return { mesh, mat, base: b };
    });

    const flipperMat = new THREE.MeshStandardMaterial({
      color: 0xfff02b, emissive: 0xfff02b, emissiveIntensity: 0.5, metalness: 0.25, roughness: 0.4
    });
    const flipperMeshes = flippers.map(() => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 1.7), flipperMat);
      scene.add(mesh);
      return mesh;
    });

    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xe8e8ff, emissive: 0x3a3a6a, emissiveIntensity: 0.5, metalness: 0.5, roughness: 0.35
    });
    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 16), ballMat);
    scene.add(ballMesh);
    const ballLight = new THREE.PointLight(0xffffff, 0.6, 6);
    ballMesh.add(ballLight);

    // ---- Game state ----
    const ball = { x: LAUNCH.x, z: LAUNCH.z, vx: 0, vz: 0 };
    let score = 0;
    let ballsLeft = 3;
    let state = "boot"; // boot | idle | charging | playing | gameOver
    let chargePointerId = null;
    let chargeStart = 0;
    let lastMilestone = 0;
    let toastUntil = 0;

    function setScoreDisplay() {
      scoreEl.textContent = String(score);
    }
    function setBallsDisplay() {
      let s = "";
      for (let i = 0; i < 3; i++) s += i < ballsLeft ? "● " : "○ ";
      ballsEl.textContent = s.trim();
    }
    setScoreDisplay();
    setBallsDisplay();

    function resetBall() {
      ball.x = LAUNCH.x; ball.z = LAUNCH.z; ball.vx = 0; ball.vz = 0;
    }

    function beginPlaySession() {
      score = 0; ballsLeft = 3; lastMilestone = 0;
      setScoreDisplay(); setBallsDisplay();
      resetBall();
      state = "idle";
      msgEl.style.display = "none";
    }

    async function startMusic() {
      if (!ctx.capabilities.backgroundMusic) return;
      try {
        await ctx.music.unlock();
        ctx.music.play({ preset: "synthwave", volume: 0.45, intensity: 0.5 });
      } catch (e) {}
    }

    function haptic(kind) {
      if (ctx.capabilities.haptics) ctx.platform.haptic(kind);
    }
    function sting(name) {
      if (ctx.capabilities.backgroundMusic) {
        try { ctx.music.sting(name); } catch (e) {}
      }
    }

    function onBumperHit(b) {
      b.flash = 1;
      score += 100;
      setScoreDisplay();
      ctx.platform.setScore(score);
      haptic("medium");
      sting("coin");
      ctx.platform.interact({ type: "bumper" });
      if (score - lastMilestone >= 1000) {
        lastMilestone = Math.floor(score / 1000) * 1000;
        ctx.platform.milestone("combo_" + lastMilestone);
        sting("powerup");
      }
    }

    async function onBallLost() {
      state = "ballLost";
      resetBall();
      ballsLeft -= 1;
      setBallsDisplay();
      haptic("warning");
      if (ballsLeft > 0) {
        toastUntil = performance.now() + 900;
        msgEl.querySelector(".big").textContent = "BALL LOST";
        msgEl.querySelector(".small").textContent = "";
        msgEl.classList.remove("tap");
        msgEl.style.display = "block";
        setTimeout(() => {
          if (state === "ballLost") {
            msgEl.style.display = "none";
            state = "idle";
          }
        }, 900);
      } else {
        state = "gameOver";
        sting("fail");
        ctx.platform.fail({ score });
        ctx.platform.complete({ score });
        try { await ctx.memory.record("score").submit(score, { label: score + " pts" }); } catch (e) {}
        msgEl.querySelector(".big").textContent = "GAME OVER · " + score;
        msgEl.querySelector(".small").textContent = "TAP TO PLAY AGAIN";
        msgEl.classList.add("tap");
        msgEl.style.display = "block";
      }
    }

    // ---- Pointer input: left half = left flipper, right half = right flipper + plunger ----
    const pointers = new Map();

    function recomputeFlippers() {
      let left = false, right = false;
      for (const p of pointers.values()) {
        if (p.x < ctx.width / 2) left = true; else right = true;
      }
      for (const f of flippers) {
        const wantActive = f.side === "left" ? left : right;
        if (wantActive && !f.active) ctx.platform.interact({ type: "flip", side: f.side });
        f.active = wantActive;
      }
    }

    function handleFirstStart() {
      if (state !== "boot") return;
      ctx.platform.start();
      startMusic();
      beginPlaySession();
    }

    function handleGameOverTap() {
      if (state !== "gameOver") return;
      beginPlaySession();
    }

    ctx.listen(canvas, "pointerdown", (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      pointers.set(event.pointerId, { x });
      recomputeFlippers();

      if (state === "boot") { handleFirstStart(); return; }
      if (state === "gameOver") { handleGameOverTap(); return; }
      if (state === "idle" && x >= ctx.width / 2 && chargePointerId === null) {
        chargePointerId = event.pointerId;
        chargeStart = performance.now();
        state = "charging";
        chargeWrap.style.display = "block";
      }
    }, { passive: false });

    function releaseCharge() {
      const power = Math.max(0, Math.min(1, (performance.now() - chargeStart) / CHARGE_MS));
      ball.vx = -3 - power * 2.4;
      ball.vz = -(22 + power * 32);
      state = "playing";
      chargePointerId = null;
      chargeWrap.style.display = "none";
      haptic("light");
      ctx.platform.interact({ type: "launch", power: Math.round(power * 100) });
    }

    function endPointer(event) {
      pointers.delete(event.pointerId);
      recomputeFlippers();
      if (event.pointerId === chargePointerId) releaseCharge();
    }
    ctx.listen(canvas, "pointerup", endPointer);
    ctx.listen(canvas, "pointercancel", endPointer);
    ctx.listen(canvas, "pointerleave", endPointer);

    ctx.listen(infoEl, "pointerdown", (event) => {
      event.stopPropagation();
      const wasBoot = state === "boot";
      msgEl.querySelector(".big").textContent = "HOW TO PLAY";
      msgEl.querySelector(".small").innerHTML =
        "LEFT SIDE → LEFT FLIPPER<br>RIGHT SIDE → RIGHT FLIPPER<br>HOLD RIGHT (BALL WAITING) → CHARGE LAUNCH<br>HIT BUMPERS FOR COMBOS";
      msgEl.classList.add("tap");
      msgEl.style.display = "block";
      const closeOnce = () => {
        msgEl.style.display = "none";
        if (wasBoot) {
          msgEl.querySelector(".big").textContent = "NEON ORBIT";
          msgEl.querySelector(".small").textContent = "TAP TO START";
        }
      };
      const onNext = (e2) => { e2.stopPropagation(); closeOnce(); };
      ctx.listen(msgEl, "pointerdown", onNext, { once: true });
    });

    // ---- Simulation ----
    function updateFlipperTips(dt) {
      for (const f of flippers) {
        f.prevTip.x = f.tip.x; f.prevTip.z = f.tip.z;
        const target = f.active ? f.activeTip : f.restTip;
        const dx = target.x - f.tip.x, dz = target.z - f.tip.z;
        const dist = Math.hypot(dx, dz);
        const step = FLIPPER_SPEED * dt;
        if (dist <= step || dist < 1e-5) { f.tip.x = target.x; f.tip.z = target.z; }
        else { f.tip.x += (dx / dist) * step; f.tip.z += (dz / dist) * step; }
      }
    }

    function resolveWalls() {
      for (const s of wallSegs) {
        const cp = closestPoint(ball.x, ball.z, s.x1, s.z1, s.x2, s.z2);
        const dx = ball.x - cp.x, dz = ball.z - cp.z;
        const dist = Math.hypot(dx, dz);
        if (dist < BALL_R && dist > 1e-6) {
          const nx = dx / dist, nz = dz / dist;
          const overlap = BALL_R - dist;
          ball.x += nx * overlap; ball.z += nz * overlap;
          const vn = ball.vx * nx + ball.vz * nz;
          if (vn < 0) {
            ball.vx -= (1 + WALL_REST) * vn * nx;
            ball.vz -= (1 + WALL_REST) * vn * nz;
            ball.vx *= 0.985; ball.vz *= 0.985;
          }
        }
      }
    }

    function resolveBumpers() {
      for (const b of bumpers) {
        const dx = ball.x - b.x, dz = ball.z - b.z;
        const dist = Math.hypot(dx, dz);
        const minD = BALL_R + b.r;
        if (dist < minD && dist > 1e-6) {
          const nx = dx / dist, nz = dz / dist;
          ball.x = b.x + nx * minD; ball.z = b.z + nz * minD;
          const vn = ball.vx * nx + ball.vz * nz;
          if (vn < 0) {
            ball.vx -= (1 + BUMPER_REST) * vn * nx;
            ball.vz -= (1 + BUMPER_REST) * vn * nz;
          }
          ball.vx += nx * BUMPER_KICK;
          ball.vz += nz * BUMPER_KICK;
          onBumperHit(b);
        }
      }
    }

    function resolveFlippers(dt) {
      for (const f of flippers) {
        const cp = closestPoint(ball.x, ball.z, f.pivot.x, f.pivot.z, f.tip.x, f.tip.z);
        const dx = ball.x - cp.x, dz = ball.z - cp.z;
        const dist = Math.hypot(dx, dz);
        const minD = BALL_R + FLIPPER_RADIUS;
        if (dist < minD) {
          const nx = dist > 1e-6 ? dx / dist : 0;
          const nz = dist > 1e-6 ? dz / dist : 1;
          const overlap = minD - dist;
          ball.x += nx * overlap; ball.z += nz * overlap;
          const tipVx = (f.tip.x - f.prevTip.x) / dt;
          const tipVz = (f.tip.z - f.prevTip.z) / dt;
          const influence = 0.35 + 0.65 * cp.t;
          ball.vx += tipVx * influence * FLIPPER_TRANSFER;
          ball.vz += tipVz * influence * FLIPPER_TRANSFER;
          const vn = ball.vx * nx + ball.vz * nz;
          if (vn < 0) {
            ball.vx -= (1 + FLIPPER_REST) * vn * nx;
            ball.vz -= (1 + FLIPPER_REST) * vn * nz;
          }
          if (f.active && !f.hapticFired) { haptic("light"); f.hapticFired = true; }
        } else {
          f.hapticFired = false;
        }
      }
    }

    function step(dt) {
      updateFlipperTips(dt);
      if (state === "charging") {
        const power = Math.max(0, Math.min(1, (performance.now() - chargeStart) / CHARGE_MS));
        chargeFill.style.height = Math.round(power * 100) + "%";
      }
      if (state === "playing") {
        ball.vz += GRAVITY * dt;
        ball.x += ball.vx * dt;
        ball.z += ball.vz * dt;
        resolveWalls();
        resolveBumpers();
        resolveFlippers(dt);
        const speed = Math.hypot(ball.vx, ball.vz);
        if (speed > MAX_SPEED) {
          const s = MAX_SPEED / speed;
          ball.vx *= s; ball.vz *= s;
        }
        if (ball.z > DRAIN_Z) onBallLost();
      }
      for (const b of bumpers) {
        if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 3.2);
      }
    }

    function render() {
      ballMesh.position.set(ball.x, FLOOR_Y + BALL_R, ball.z);
      for (let i = 0; i < flippers.length; i++) {
        const f = flippers[i];
        const mesh = flipperMeshes[i];
        const dx = f.tip.x - f.pivot.x, dz = f.tip.z - f.pivot.z;
        const len = Math.hypot(dx, dz) || 0.001;
        mesh.position.set((f.pivot.x + f.tip.x) / 2, FLOOR_Y + 0.9, (f.pivot.z + f.tip.z) / 2);
        mesh.rotation.y = -Math.atan2(dz, dx);
        mesh.scale.set(len, 1, 1);
      }
      for (const bm of bumperMeshes) {
        bm.mat.emissiveIntensity = 0.6 + bm.base.flash * 2.2;
      }
      renderer.render(scene, camera);
    }

    let lastT = performance.now();
    ctx.onFrame(() => {
      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.033);
      lastT = now;
      step(dt);
      render();
    });

    render();
    ctx.platform.ready();

    ctx.loadFont("Press Start 2P", "press-start-2p", "1.0.0", { weight: "400", style: "normal" })
      .catch(() => {});
  }
};
