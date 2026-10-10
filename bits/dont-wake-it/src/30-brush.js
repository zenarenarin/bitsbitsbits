// ---- Brush primitives -------------------------------------------------------
// All marks are filled shapes with soft value shifts, not outlines: tapered
// fur locks, round dabs for moss and leaves, and long thin streaks.

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// A tapered lock of fur: rounded root, swelling body, pointed tip.
// (x, y) root in px, (dx, dy) unit direction in px space, bend in [-0.5, 0.5].
function lockPath(g, x, y, dx, dy, len, w, bend) {
  const px = -dy, py = dx;
  const bx = px * bend * len, by = py * bend * len;
  const tx = x + dx * len + bx, ty = y + dy * len + by;
  const mx = x + dx * len * 0.42 + bx * 0.5, my = y + dy * len * 0.42 + by * 0.5;
  g.beginPath();
  g.moveTo(x - px * w * 0.45, y - py * w * 0.45);
  g.quadraticCurveTo(mx - px * w * 0.7, my - py * w * 0.7, tx, ty);
  g.quadraticCurveTo(mx + px * w * 0.7, my + py * w * 0.7, x + px * w * 0.45, y + py * w * 0.45);
  g.quadraticCurveTo(x - dx * w * 0.55, y - dy * w * 0.55, x - px * w * 0.45, y - py * w * 0.45);
  g.closePath();
}

function drawLock(g, x, y, dx, dy, len, w, bend, col, alpha) {
  lockPath(g, x, y, dx, dy, len, w, bend);
  g.fillStyle = css(col, alpha);
  g.fill();
}

function dab(g, x, y, rx, ry, rot, col, alpha) {
  g.beginPath();
  g.ellipse(x, y, Math.max(rx, 0.3), Math.max(ry, 0.3), rot, 0, Math.PI * 2);
  g.fillStyle = css(col, alpha);
  g.fill();
}

function streak(g, x, y, dx, dy, len, width, col, alpha) {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + dx * len, y + dy * len);
  g.lineCap = "round";
  g.lineWidth = Math.max(width, 0.5);
  g.strokeStyle = css(col, alpha);
  g.stroke();
}
