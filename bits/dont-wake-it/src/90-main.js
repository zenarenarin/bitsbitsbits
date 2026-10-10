// ---- Bit entry -------------------------------------------------------------
// Stage 1 (visual foundation): one representative scene, interface hidden.
// Draft tuning knobs switch the camera shot and the collision overlay.

const WORLD_SEED = 7331;

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
    const tuneChoice = (id, d) => (tune && tune.has(id) ? tune.choice(id) : d) || d;
    const tuneBool = (id, d) => (tune && tune.has(id) ? !!tune.boolean(id) : d);

    let stage = "world";
    let world, scene;
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    const render = () => {
      if (disposed || !scene) return;
      const W = canvas.width, H = canvas.height;
      if (!W || !H) return;
      const pr = W / Math.max(1, ctx.width);
      const view = makeView(tuneChoice("view", "gameplay"), world, W, H, pr);
      scene.render(g, view, { collision: tuneBool("collision_overlay", false) });
    };

    try {
      world = buildWorld(WORLD_SEED);
      scene = new Scene(world);
      stage = "first-frame";
      render();
    } catch (err) {
      ctx.platform.error({ stage, message: String((err && err.message) || err) });
      throw err;
    }

    ctx.onResize(render, { debounceMs: 120 });
    if (tune) tune.onChange(["view", "collision_overlay"], render);
    ctx.markVisualReady("stage1-scene");
    ctx.platform.ready();
  }
};
