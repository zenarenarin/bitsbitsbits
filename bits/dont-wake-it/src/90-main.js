// ---- Bit entry -------------------------------------------------------------
// Stage 2 (movement): the explorer walks, runs, jumps and lands on the
// creature's painted body; the camera follows; painting streams in ahead of
// the camera within a per-frame budget. Interface stays hidden for now.

const WORLD_SEED = 7331;
// Painting gets what is left of a ~14 ms frame after drawing (3-10 ms).
const FRAME_TARGET_MS = 14;

window.plethoraBit = {
  meta: {
    title: "Don't Wake It",
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
    const applyPhys = () => {
      PHYS.walk = DEFAULT_PHYS.walk * knob("walk_speed", 1);
      PHYS.run = DEFAULT_PHYS.run * knob("run_speed", 1);
      PHYS.jumpHeight = DEFAULT_PHYS.jumpHeight * knob("jump_height", 1);
    };

    let stage = "world";
    let world, scene, ex, cam;
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
      stage = "first-frame";
      scene.prepare(currentView(), ex); // paint everything the first frame needs
      scene.sched.syncMs = 0;
      scene.sched.syncCount = 0;
    } catch (err) {
      ctx.platform.error({ stage, message: String((err && err.message) || err) });
      throw err;
    }

    const controls = new Controls(ctx, canvas, () => ctx.platform.start());

    const draw = () => {
      if (disposed || !canvas.width || !canvas.height) return;
      const view = currentView();
      scene.render(g, view, {
        explorer: { x: ex.x, y: ex.y, facing: ex.facing, pose: ex.pose() },
        collision: !!knob("collision_overlay", false)
      });
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
          pending: scene.sched.jobs.size, syncMs: scene.sched.syncMs || 0, syncCount: scene.sched.syncCount || 0
        };
      }
    };

    ctx.game.loop({
      fixedHz: 120,
      maxSubsteps: 8,
      fixedUpdate: (stepMs) => {
        ex.step(stepMs / 1000, controls);
        controls.consume();
      },
      update: (dtMs) => {
        cam.update(Math.min(dtMs, 100) / 1000, ex);
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
    }
    draw();
    ctx.markVisualReady("stage2-first-frame");
    ctx.platform.ready();
  }
};

// Test hook: lets offline tools drive the world and controller headlessly.
if (typeof globalThis.__dwTestHook === "function") {
  globalThis.__dwTestHook({ buildWorld, Explorer, PHYS, WORLD_SEED });
}
