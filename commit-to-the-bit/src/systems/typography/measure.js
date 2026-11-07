// Rect of an element in 1920×1080 stage coordinates, independent of display scale.
export function rectInStage(el) {
  const stage = document.getElementById('stage');
  const s = stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const k = 1920 / s.width;
  return {
    x: (r.left - s.left) * k,
    y: (r.top - s.top) * k,
    w: r.width * k,
    h: r.height * k,
    cx: (r.left - s.left + r.width / 2) * k,
    cy: (r.top - s.top + r.height / 2) * k,
  };
}

// Point and tangent angle along an SVG path element, 0..1
export function along(path, t) {
  const L = path.getTotalLength();
  const p = path.getPointAtLength(L * t);
  const p2 = path.getPointAtLength(Math.min(L, L * t + 1));
  return { x: p.x, y: p.y, a: Math.atan2(p2.y - p.y, p2.x - p.x) };
}
