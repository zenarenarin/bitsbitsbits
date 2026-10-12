// ---- Camera: portrait framing that mirrors the reference -------------------
// gameplay:     explorer ~1/14 of the screen height, 60% down, 58% across, so
//               the body mass fills the lower left and sky opens up-right.
// establishing: the title-panel shot - the same world pulled back so the head,
//               ear and closed eye loom over a tiny explorer.
// The horizon (camera height) sits at mid-screen; depth layers converge on it.

const VIEW_PRESETS = {
  gameplay: { spanHeights: 14, ex: 0.58, ey: 0.6 },
  establishing: { spanHeights: 40, focus: "head", fx: 0.6, fy: 0.45 },
  map: { spanHeights: 260, ex: 0.5, ey: 0.6 } // development only: whole-creature layout check
};

function makeView(kind, world, W, H, pr, focus) {
  const preset = VIEW_PRESETS[kind] || VIEW_PRESETS.gameplay;
  const spot = focus || world.explorerSpots[kind] || world.explorerSpots.gameplay;
  const cssH = H / pr;
  const ppm = cssH / (preset.spanHeights * EXPLORER_HEIGHT);
  const k = ppm * pr;
  // Either keep the explorer at a screen anchor, or compose on a named
  // anatomical feature (the establishing shot frames the head).
  const target = preset.focus ? world.focus[preset.focus] : spot;
  const fx = preset.focus ? preset.fx : preset.ex, fy = preset.focus ? preset.fy : preset.ey;
  return {
    kind, W, H, pr, ppm,
    horizon: H * 0.5,
    camX: target.x - (fx - 0.5) * W / k,
    camY: target.y + (fy - 0.5) * H / k,
    explorer: spot
  };
}

function worldToScreen(view, x, y, par) {
  const k = view.ppm * view.pr * (par || 1);
  return [view.W / 2 + (x - view.camX) * k, view.horizon - (y - view.camY) * k];
}

// Follows the explorer smoothly. Leads a little in the direction of travel,
// holds height through ordinary jumps (so the world does not bob), and only
// rises or drops once the explorer has truly changed level.
class FollowCamera {
  constructor(ex) {
    this.x = ex.x;
    this.y = ex.y;
    this.lead = 0;
    this.vx = 0;
    this.vy = 0;
  }

  update(dt, ex) {
    const want = clamp(ex.vx * 0.45, -1.6, 1.6);
    this.lead += (want - this.lead) * (1 - Math.exp(-dt * 1.6));
    let ty = ex.y;
    if (!ex.grounded && ex.y > ex.lastGroundY - 0.5) ty = Math.max(ex.lastGroundY, ex.y - 1.8);
    const kx = 1 - Math.exp(-dt * 3.2), ky = 1 - Math.exp(-dt * (ty < this.y ? 4.5 : 2.6));
    const px = this.x, py = this.y;
    this.x += (ex.x + this.lead - this.x) * kx;
    this.y += (ty - this.y) * ky;
    if (dt > 0) {
      this.vx += ((this.x - px) / dt - this.vx) * 0.2;
      this.vy += ((this.y - py) / dt - this.vy) * 0.2;
    }
  }

  snap(ex) {
    this.x = ex.x;
    this.y = ex.y;
    this.lead = 0;
  }
}
