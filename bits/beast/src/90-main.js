// ---- Bit entry -------------------------------------------------------------
// Beast. Stage 3 (alertness): the explorer climbs the sleeping beast's body;
// every step, launch and landing makes noise; the beast breathes, stirs and
// settles; stillness lets it calm, slowly, never fully. Interface stays
// hidden; the world itself is the feedback.

const WORLD_SEED = 7331;
// Painting gets what is left of a ~14 ms frame after drawing (3-10 ms).
const FRAME_TARGET_MS = 14;

window.plethoraBit = {
  meta: {
    title: "Beast",
    runtime: "plethora-bit@2",
    tags: ["adventure", "climbing", "atmospheric"],
    permissions: []
  },

  async init(ctx) {
    const canvas = ctx.createCanvas2D({ maxDpr: 2, alpha: false, layer: "content", touchAction: "none" });
    const g = canvas.getContext("2d");
    const tune = ctx.tune;
    const knob = (id, d) => {
      const v = tune && tune.has(id) ? tune.get(id) : undefined;
      return v === undefined || v === null ? d : v;
    };
    const DEFAULT_PHYS = { walk: PHYS.walk, run: PHYS.run, jumpHeight: PHYS.jumpHeight };
    const applyNoise = () => {
      if (!alert) return;
      alert.scale = knob("noise_scale", 1);
      alert.recovery = knob("recovery_rate", 1);
    };
    const applyPhys = () => {
      PHYS.walk = DEFAULT_PHYS.walk * knob("walk_speed", 1);
      PHYS.run = DEFAULT_PHYS.run * knob("run_speed", 1);
      PHYS.jumpHeight = DEFAULT_PHYS.jumpHeight * knob("jump_height", 1);
    };

    let stage = "world";
    let world, scene, ex, cam, alert, life;
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    const startSpot = () => {
      const s = knob("start", "back");
      return s === "base" ? world.explorerSpots.base : s === "head" ? world.explorerSpots.establishing : world.explorerSpots.gameplay;
    };
    const currentView = () => {
      const pr = canvas.width / Math.max(1, ctx.width);
      const v = makeView("gameplay", world, canvas.width, canvas.height, pr, { x: cam.x, y: cam.y });
      // Where the camera will be in ~0.8 s, in screen px of the play layer.
      const k = v.ppm * v.pr;
      v.aheadX = clamp(cam.vx * 0.8, -6, 6) * k;
      v.aheadY = -clamp(cam.vy * 0.8, -6, 6) * k;
      return v;
    };

    try {
      applyPhys();
      world = buildWorld(WORLD_SEED);
      scene = new Scene(world);
      stage = "explorer";
      ex = new Explorer(world.layers.play, startSpot(), world.props.mushrooms.map((m) => m.cap));
      cam = new FollowCamera(ex);
      alert = new Alertness(world);
      life = new Life(world);
      stage = "first-frame";
      scene.prepare(currentView(), ex); // paint everything the first frame needs
      scene.sched.syncMs = 0;
      scene.sched.syncCount = 0;
    } catch (err) {
      ctx.platform.error({ stage, message: String((err && err.message) || err) });
      throw err;
    }

    const controls = new Controls(ctx, canvas, () => ctx.platform.start());
    applyNoise();

    // Temporary stand-in for the awakening (Stage 6 builds the real
    // sequence): the body heaves, one impact, the explorer loses footing,
    // the world fades into mist, and the climb restarts.
    let wake = null, shake = 0, fade = 0;
    const still = { dir: 0, run: false, jumpPressed: false };
    const restart = () => {
      ex.reset(startSpot());
      alert.reset();
      cam.snap(ex);
      life.parts.length = 0;
      wake = null;
    };

    let lastView = null;
    const draw = () => {
      if (disposed || !canvas.width || !canvas.height) return;
      const view = currentView();
      if (shake > 0.01) {
        view.camX += Math.sin(alert.time * 47) * shake * 0.35;
        view.camY += Math.cos(alert.time * 39) * shake * 0.25;
      }
      lastView = view;
      scene.render(g, view, {
        explorer: { x: ex.x, y: ex.y, facing: ex.facing, pose: ex.pose() },
        collision: !!knob("collision_overlay", false),
        alert,
        life
      });
      if (fade > 0.001) {
        g.fillStyle = css(PAL.mistWarm, fade);
        g.fillRect(0, 0, view.W, view.H);
      }
      if (knob("show_alertness", false)) {
        const s = view.pr;
        g.font = `${12 * s}px sans-serif`;
        g.fillStyle = "rgba(40,30,60,0.75)";
        g.fillText(`${alert.state} ${alert.level.toFixed(2)}  floor ${alert.floor.toFixed(2)}  height ${ex.y.toFixed(0)} m`, 12 * s, (ctx.safeArea.top + 22) * s);
      }
      // Faint marks where fingers are held: feedback without a HUD.
      for (const p of controls.touches()) {
        const s = view.pr;
        dab(g, p.sx * s, p.sy * s, 22 * s, 22 * s, 0, [255, 244, 228], 0.12);
        dab(g, p.x * s, p.y * s, 7 * s, 7 * s, 0, [255, 244, 228], 0.28);
      }
      if (globalThis.__dwProfile) {
        globalThis.__dwState = {
          x: ex.x, y: ex.y, vx: ex.vx, vy: ex.vy, grounded: ex.grounded, state: ex.state,
          feetSd: ex.sd(ex.x, ex.y + PHYS.feetR) - PHYS.feetR, bodySd: ex.sd(ex.x, ex.y + PHYS.bodyY) - PHYS.bodyR,
          pending: scene.sched.jobs.size, syncMs: scene.sched.syncMs || 0, syncCount: scene.sched.syncCount || 0,
          alert: alert.level, alertState: alert.state, floor: alert.floor
        };
        globalThis.__dwAlert = alert; // test harness only (profile flag)
      }
    };

    ctx.game.loop({
      fixedHz: 120,
      maxSubsteps: 8,
      fixedUpdate: (stepMs) => {
        ex.step(stepMs / 1000, wake ? still : controls);
        controls.consume();
      },
      update: (dtMs) => {
        const dt = Math.min(dtMs, 100) / 1000;
        cam.update(dt, ex);
        alert.update(dt, ex, wake ? still : controls);
        if (alert.state === "awake" && !wake) wake = { t: 0, hit: false };
        if (wake) {
          wake.t += dt;
          alert.heave = Math.sin(wake.t * 3.4) * 0.9 * smoothstep(0, 0.6, wake.t);
          if (!wake.hit && wake.t > 1) {
            wake.hit = true;
            shake = 1;
            ex.vx = -ex.facing * 2.5;
            ex.vy = 7;
            ex.grounded = false;
            ex.airLock = 0.3;
          }
          fade = smoothstep(1.9, 2.9, wake.t);
          // Paint the restart point while the world fades, so the cut is clean.
          if (wake.t > 0.8 && lastView) {
            const s = startSpot();
            const v = makeView("gameplay", world, lastView.W, lastView.H, lastView.pr, { x: s.x, y: s.y });
            scene.prefetch(v);
          }
          if (wake.t > 3.1) restart();
        } else {
          fade = Math.max(0, fade - dt * 1.2);
        }
        shake *= Math.exp(-dt * 5);
        life.update(dt, alert, ex, lastView);
        ex.events.length = 0;
      },
      render: () => {
        const t0 = performance.now();
        draw();
        const t1 = performance.now();
        scene.sched.pump(clamp(FRAME_TARGET_MS - (t1 - t0), 3, 10));
        if (globalThis.__dwProfile) {
          const p = (globalThis.__dwPerf = globalThis.__dwPerf || { n: 0, draw: 0, pump: 0, maxDraw: 0, maxPump: 0 });
          const d = t1 - t0, q = performance.now() - t1;
          p.n++; if (d > 40) (p.spikes = p.spikes || []).push([p.n, Math.round(d)]); p.draw += d; p.pump += q; p.maxDraw = Math.max(p.maxDraw, d); p.maxPump = Math.max(p.maxPump, q);
        }
      }
    });

    if (tune) {
      tune.onChange(["start"], () => { ex.reset(startSpot()); cam.snap(ex); });
      tune.onChange(["walk_speed", "run_speed", "jump_height"], applyPhys);
      tune.onChange(["noise_scale", "recovery_rate"], applyNoise);
    }
    draw();
    ctx.markVisualReady("first-frame");
    ctx.platform.ready();
  }
};

// Test hook: lets offline tools drive the world and controller headlessly.
if (typeof globalThis.__dwTestHook === "function") {
  globalThis.__dwTestHook({ buildWorld, Explorer, PHYS, WORLD_SEED, Alertness, NOISE });
}
