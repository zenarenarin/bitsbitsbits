// Deterministic toss physics for Scene 03. Every throw is simulated in full
// before it plays, so the outcome, its ghost trail and its feedback label are
// known at release — and the auto-demo throws are identical every time.

export const W = {
  g: 1500,
  r: 26,
  launch: { x: 400, y: 700 },
  gapL: 760,
  gapR: 1250,
  groundL: 790,
  groundR: 830,
  cup: { x: 1530, y: 752, r: 62 },
  angle: (-38 * Math.PI) / 180,
};

const DT = 1 / 240;

export function simulate(vx, vy) {
  const { g, r, gapL, gapR, groundL, groundR, cup } = W;
  let x = W.launch.x;
  let y = W.launch.y;
  const pts = [[x, y]];
  let outcome = null;
  let landed = null;
  let bounces = 0;
  for (let i = 0; i < 4000; i++) {
    const py = y;
    vy += g * DT;
    x += vx * DT;
    y += vy * DT;

    // caught by the flower cup
    if (py < cup.y && y >= cup.y && Math.abs(x - cup.x) < cup.r - r * 0.4 && vy > 0) {
      outcome = 'hit';
      pts.push([x, cup.y]);
      pts.push([cup.x, cup.y + 18]);
      landed = { x: cup.x, y: cup.y };
      break;
    }
    // the cup's outer wall
    if (y > cup.y && y < groundR && Math.abs(x - cup.x) < cup.r + r && Math.abs(x - cup.x) > cup.r - r) {
      vx = -vx * 0.45;
      x += vx * DT * 2;
    }
    // fell into the ravine
    if (x > gapL && x < gapR && y > 1160) {
      outcome = outcome || 'short';
      landed = landed || { x: Math.min(Math.max(x, gapL + 40), gapR - 40), y: groundR - 40 };
      pts.push([x, y]);
      break;
    }
    // ravine walls: below the rim, the cliffs push back
    if (y + r > groundR && py + r > groundR + 1 && x + r > gapR && x < gapR + r) {
      x = gapR - r;
      vx = -Math.abs(vx) * 0.4;
    }
    if (y + r > groundL && py + r > groundL + 1 && x - r < gapL && x > gapL - r) {
      x = gapL + r;
      vx = Math.abs(vx) * 0.4;
    }
    // left bank (only from above)
    if (x <= gapL && y + r >= groundL && py + r <= groundL + 1) {
      y = groundL - r;
      vy = -vy * 0.35;
      vx *= 0.7;
    }
    // far bank (only from above)
    if (x >= gapR && y + r >= groundR && py + r <= groundR + 1) {
      y = groundR - r;
      if (!landed) {
        landed = { x, y };
        outcome = x < cup.x ? 'short' : 'long';
      }
      if (Math.abs(vy) > 120 && bounces < 4) {
        vy = -vy * 0.42;
        vx *= 0.75;
        bounces++;
      } else {
        vy = 0;
        vx *= 0.985;
      }
    }
    if (i % 4 === 0) pts.push([x, y]);
    if (x > 2050 || (Math.abs(vx) < 8 && vy === 0)) break;
  }
  pts.push([x, y]);
  return { pts, outcome: outcome || 'short', landed: landed || { x, y } };
}

// Speed that drops the seed into the centre of the cup at the demo angle.
export function idealSpeed() {
  const { g, cup, launch, angle } = W;
  let lo = 200;
  let hi = 3000;
  for (let k = 0; k < 40; k++) {
    const v = (lo + hi) / 2;
    const vx = v * Math.cos(angle);
    const vy0 = v * Math.sin(angle);
    // time to come back down to cup height
    const dy = cup.y - launch.y;
    const t = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * g * dy)) / g;
    const x = launch.x + vx * t;
    if (x < cup.x) lo = v;
    else hi = v;
  }
  return (lo + hi) / 2;
}
