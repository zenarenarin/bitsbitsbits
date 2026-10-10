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

function makeView(kind, world, W, H, pr) {
  const preset = VIEW_PRESETS[kind] || VIEW_PRESETS.gameplay;
  const spot = world.explorerSpots[kind] || world.explorerSpots.gameplay;
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
