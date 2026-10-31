// The collection. Each object has authored physical properties and its own
// painting. Coordinates are world units with the origin at the middle of the
// object's base and y up, shared by the collision pieces and the artwork.
//
//   mass        kg-like units (the table's ballast is 24)
//   com         centre of mass, when it differs from the shape's centroid
//   pieces      convex collision polygons (planck takes the hull of each)
//   friction / restitution / angDamp (rolling resistance for round things)
//   weight      what the player is told: light, medium or heavy
//   tier        when it can start appearing (1 first, 3 later)

const MATERIAL_SOUND = { ceramic: 'ceramic', brass: 'brass', glass: 'glass', fruit: 'fruit', books: 'books', wood: 'wood' };

function boxPts(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }

const OBJECTS = [
  // ---------------- Ceramics ----------------
  {
    id: 'vase', name: 'Painted vase', material: 'ceramic', mass: 1.5, weight: 'medium', tier: 2,
    friction: 0.55, restitution: 0.08, com: [0, 0.3],
    pieces: [
      [[-0.11, 0], [0.11, 0], [0.2, 0.18], [0.21, 0.36], [0.14, 0.56], [-0.14, 0.56], [-0.21, 0.36], [-0.2, 0.18]],
      [[-0.14, 0.56], [0.14, 0.56], [0.085, 0.72], [-0.085, 0.72]],
      [[-0.085, 0.72], [0.085, 0.72], [0.135, 0.95], [-0.135, 0.95]]
    ],
    box: [-0.24, 0, 0.24, 0.97],
    paint(B) {
      const rnd = B.rnd;
      const prof = [[0.11, 0], [0.17, 0.06], [0.205, 0.2], [0.215, 0.34], [0.18, 0.5], [0.11, 0.62], [0.085, 0.72], [0.1, 0.84], [0.14, 0.95]];
      const path = wobblePath(lathe(prof), 0.004, rnd);
      B.gouache(path, {
        base: PAL.cobalt, box: this.box, washes: [PAL.cobaltDeep, '#3d66b8'], shadow: 0.7,
        inner: () => {
          // cream band with vermilion flowers around the belly
          B.g.save();
          B.blob([[-0.3, 0.2], [0.3, 0.2], [0.3, 0.44], [-0.3, 0.44]], PAL.cream, 0.94, 0.006);
          for (let i = 0; i < 5; i++) {
            const x = -0.18 + i * 0.09, y = 0.32;
            for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + i; B.petal(x, y, x + Math.cos(a) * 0.04, y + Math.sin(a) * 0.04, 0.016, PAL.vermilion, 0.92); }
            B.dot(x, y, 2.2, PAL.mustard);
          }
          B.stroke([[-0.3, 0.2], [0.3, 0.205]], PAL.ochre, 2.2, 0.9, B.px(1));
          B.stroke([[-0.3, 0.44], [0.3, 0.435]], PAL.ochre, 2.2, 0.9, B.px(1));
          // neck chevrons
          for (let i = 0; i < 4; i++) B.stroke([[-0.09, 0.64 + i * 0.04], [0, 0.66 + i * 0.04], [0.09, 0.64 + i * 0.04]], PAL.cream, 1.6, 0.7);
          // little foot band
          B.stroke([[-0.16, 0.05], [0.16, 0.05]], PAL.mustard, 2.6, 0.85, B.px(1));
          B.g.restore();
        }
      });
      B.shine([[-0.16, 0.12], [-0.19, 0.24], [-0.17, 0.4]], PAL.cream, 3.2, 0.8);
      B.shine([[-0.11, 0.8], [-0.12, 0.9]], PAL.cream, 2, 0.6);
    }
  },
  {
    id: 'teapot', name: 'Porcelain teapot', material: 'ceramic', mass: 1.1, weight: 'medium', tier: 1,
    friction: 0.5, restitution: 0.08,
    pieces: [
      [[-0.13, 0], [0.13, 0], [0.22, 0.11], [0.23, 0.23], [0.17, 0.35], [-0.17, 0.35], [-0.23, 0.23], [-0.22, 0.11]],
      [[-0.08, 0.35], [0.08, 0.35], [0.03, 0.45], [-0.03, 0.45]],
      [[0.2, 0.12], [0.25, 0.17], [0.36, 0.34], [0.33, 0.37], [0.2, 0.27]],
      [[-0.34, 0.1], [-0.22, 0.1], [-0.22, 0.31], [-0.33, 0.3]]
    ],
    box: [-0.36, 0, 0.38, 0.47],
    paint(B) {
      const rnd = B.rnd, g = B.g;
      // handle (behind body)
      g.save(); g.strokeStyle = PAL.cream; g.lineWidth = 0.045; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-0.2, 0.28); g.bezierCurveTo(-0.38, 0.33, -0.38, 0.1, -0.2, 0.1); g.stroke();
      g.strokeStyle = rgba(PAL.umber, 0.6); g.lineWidth = B.px(1.6); g.stroke(); g.restore();
      // spout
      const sp = wobblePath([[0.18, 0.1], [0.27, 0.16], [0.35, 0.33], [0.37, 0.37], [0.31, 0.36], [0.24, 0.26], [0.18, 0.24]], 0.003, rnd);
      B.gouache(sp, { base: PAL.cream, box: [0.18, 0.1, 0.37, 0.37], shadow: 0.4, strokes: 6 });
      const body = wobblePath(ellipsePts(0, 0.18, 0.225, 0.175, 22).map(([x, y]) => [x, Math.max(y, 0.005)]), 0.003, rnd);
      B.gouache(body, {
        base: PAL.cream, box: [-0.23, 0, 0.23, 0.36], washes: [PAL.creamDeep, '#f7eedb'], shadow: 0.45, lit: 0.2,
        inner: () => {
          // cobalt sprays and a tomato red rim
          for (let i = 0; i < 3; i++) {
            const cx = -0.12 + i * 0.12, cy = 0.17 + (i % 2) * 0.03;
            B.stroke([[cx, cy - 0.07], [cx + 0.01, cy], [cx - 0.01, cy + 0.07]], PAL.cobalt, 1.6, 0.9);
            for (let k = 0; k < 4; k++) B.petal(cx, cy - 0.04 + k * 0.03, cx + (k % 2 ? 0.045 : -0.045), cy - 0.02 + k * 0.03, 0.012, PAL.cobalt, 0.85);
            B.dot(cx, cy + 0.075, 2.4, PAL.vermilion);
          }
          B.stroke([[-0.2, 0.31], [0, 0.325], [0.2, 0.31]], PAL.tomato, 3, 0.9);
          B.stroke([[-0.21, 0.05], [0.21, 0.05]], PAL.cobalt, 2, 0.7);
        }
      });
      const lid = wobblePath([[-0.12, 0.34], [0.12, 0.34], [0.08, 0.385], [-0.08, 0.385]], 0.003, rnd);
      B.gouache(lid, { base: PAL.cream, box: [-0.12, 0.34, 0.12, 0.39], strokes: 4 });
      const knob = wobblePath(ellipsePts(0, 0.415, 0.032, 0.035, 10), 0.002, rnd);
      B.gouache(knob, { base: PAL.tomato, box: [-0.04, 0.38, 0.04, 0.45], strokes: 3 });
      B.shine([[-0.17, 0.12], [-0.19, 0.2], [-0.15, 0.28]], '#ffffff', 3, 0.8);
    }
  },
  {
    id: 'bowl', name: 'Decorative bowl', material: 'ceramic', mass: 0.9, weight: 'light', tier: 1,
    friction: 0.55, restitution: 0.06,
    pieces: [
      [[-0.14, 0], [0.14, 0], [0.16, 0.05], [-0.16, 0.05]],
      [[-0.16, 0.05], [0.16, 0.05], [0.39, 0.2], [0.41, 0.27], [-0.41, 0.27], [-0.39, 0.2]]
    ],
    box: [-0.42, 0, 0.42, 0.29],
    paint(B) {
      const rnd = B.rnd;
      const foot = wobblePath([[-0.14, 0], [0.14, 0], [0.16, 0.055], [-0.16, 0.055]], 0.003, rnd);
      B.gouache(foot, { base: PAL.ochre, box: [-0.16, 0, 0.16, 0.06], strokes: 4 });
      const bowl = wobblePath([[-0.16, 0.05], [0.16, 0.05], [0.32, 0.12], [0.4, 0.21], [0.415, 0.27], [0, 0.275], [-0.415, 0.27], [-0.4, 0.21], [-0.32, 0.12]], 0.004, rnd);
      B.gouache(bowl, {
        base: PAL.olive, box: [-0.42, 0.05, 0.42, 0.28], washes: [PAL.forest, '#86913f'], shadow: 0.6,
        inner: () => {
          // mustard scallops and cream dots
          for (let i = 0; i < 7; i++) {
            const x = -0.3 + i * 0.1;
            B.petal(x, 0.24, x, 0.12, 0.04, PAL.mustard, 0.9);
            B.dot(x, 0.21, 2, PAL.cream, 0.95);
            B.dot(x + 0.05, 0.11, 1.4, PAL.vermilion, 0.9);
          }
          B.stroke([[-0.41, 0.255], [0, 0.262], [0.41, 0.255]], PAL.cream, 3.5, 0.95);
        }
      });
      // rim lip: the inside of the bowl seen slightly from above
      const rim = wobblePath(ellipsePts(0, 0.272, 0.41, 0.022, 20), 0.002, rnd);
      B.gouache(rim, { base: mix(PAL.forest, PAL.ink, 0.25), box: [-0.41, 0.25, 0.41, 0.3], strokes: 6, edge: false });
      B.shine([[-0.34, 0.15], [-0.22, 0.09]], PAL.cream, 2.6, 0.7);
    }
  },
  {
    id: 'bottle', name: 'Narrow-necked bottle', material: 'ceramic', mass: 1.0, weight: 'medium', tier: 3,
    friction: 0.5, restitution: 0.08, com: [0, 0.27],
    pieces: [
      [[-0.115, 0], [0.115, 0], [0.12, 0.48], [0.06, 0.6], [-0.06, 0.6], [-0.12, 0.48]],
      [[-0.04, 0.6], [0.04, 0.6], [0.035, 0.84], [-0.035, 0.84]],
      [[-0.055, 0.84], [0.055, 0.84], [0.055, 0.88], [-0.055, 0.88]]
    ],
    box: [-0.13, 0, 0.13, 0.9],
    paint(B) {
      const rnd = B.rnd;
      const prof = [[0.11, 0], [0.122, 0.04], [0.124, 0.44], [0.1, 0.54], [0.05, 0.61], [0.036, 0.66], [0.034, 0.83], [0.055, 0.85], [0.055, 0.885]];
      const path = wobblePath(lathe(prof), 0.003, rnd);
      B.gouache(path, {
        base: PAL.forest, box: this.box, washes: [PAL.olive, '#1f3320'], shadow: 0.7, strokeAngle: Math.PI / 2,
        inner: () => {
          // glaze drips of ochre from the shoulder
          B.blob([[-0.14, 0.62], [0.14, 0.62], [0.14, 0.5], [0.1, 0.46], [0.06, 0.38], [0.03, 0.47], [-0.02, 0.36], [-0.05, 0.45], [-0.1, 0.4], [-0.14, 0.48]], PAL.ochre, 0.9, 0.006);
          B.blob([[-0.14, 0.62], [0.14, 0.62], [0.14, 0.56], [-0.14, 0.56]], PAL.mustard, 0.5, 0.004);
          for (let i = 0; i < 3; i++) B.stroke([[-0.13, 0.14 + i * 0.07], [0.13, 0.15 + i * 0.07]], PAL.cream, 1.3, 0.55, B.px(1));
          B.stroke([[-0.04, 0.8], [0.04, 0.8]], PAL.vermilion, 2.2, 0.9);
        }
      });
      B.shine([[-0.085, 0.1], [-0.095, 0.3], [-0.08, 0.44]], PAL.cream, 2.8, 0.75);
    }
  },
  {
    id: 'cat', name: 'Ceramic cat', material: 'ceramic', mass: 0.7, weight: 'light', tier: 1,
    friction: 0.6, restitution: 0.06,
    pieces: [
      [[-0.15, 0], [0.15, 0], [0.16, 0.12], [0.11, 0.3], [-0.11, 0.3], [-0.16, 0.12]],
      [[-0.11, 0.28], [0.11, 0.28], [0.12, 0.38], [0.1, 0.48], [-0.1, 0.48], [-0.12, 0.38]]
    ],
    box: [-0.24, 0, 0.17, 0.5],
    paint(B) {
      const rnd = B.rnd;
      // curled tail first
      B.stroke([[0.12, 0.04], [-0.05, 0.02], [-0.2, 0.05], [-0.23, 0.13], [-0.19, 0.19]], PAL.ink, 9, 0.9, B.px(0.5));
      B.stroke([[0.12, 0.04], [-0.05, 0.02], [-0.2, 0.05], [-0.23, 0.13], [-0.19, 0.19]], PAL.mustard, 6.5, 1, B.px(0.5));
      const body = wobblePath([[-0.15, 0], [0.15, 0], [0.165, 0.1], [0.13, 0.22], [0.08, 0.3], [-0.08, 0.3], [-0.13, 0.22], [-0.165, 0.1]], 0.004, rnd);
      B.gouache(body, {
        base: PAL.mustard, box: [-0.17, 0, 0.17, 0.31], washes: [PAL.ochre, PAL.orange], shadow: 0.5,
        inner: () => {
          for (let i = 0; i < 4; i++) B.stroke([[0.16, 0.06 + i * 0.05], [0.09, 0.08 + i * 0.05]], PAL.tomato, 2.4, 0.8);
          B.blob(ellipsePts(0, 0.13, 0.065, 0.1, 12), PAL.cream, 0.85);
          for (let i = 0; i < 3; i++) B.dot(0, 0.07 + i * 0.05, 1.6, PAL.cobalt, 0.9);
        }
      });
      const head = wobblePath([[-0.105, 0.27], [0.105, 0.27], [0.12, 0.36], [0.11, 0.42], [0.105, 0.5], [0.06, 0.44], [-0.06, 0.44], [-0.105, 0.5], [-0.11, 0.42], [-0.12, 0.36]], 0.003, rnd);
      B.gouache(head, {
        base: PAL.mustard, box: [-0.12, 0.27, 0.12, 0.5], washes: [PAL.ochre], shadow: 0.45, strokes: 8,
        inner: () => {
          B.petal(-0.09, 0.44, -0.095, 0.48, 0.012, PAL.vermilion, 0.85);
          B.petal(0.09, 0.44, 0.095, 0.48, 0.012, PAL.vermilion, 0.85);
          B.stroke([[0.06, 0.4], [0.1, 0.39]], PAL.tomato, 2, 0.8);
          B.stroke([[0.06, 0.36], [0.11, 0.35]], PAL.tomato, 2, 0.8);
        }
      });
      // sleepy eyes, nose, whiskers
      B.stroke([[-0.065, 0.375], [-0.04, 0.367], [-0.02, 0.375]], PAL.ink, 1.8, 0.95);
      B.stroke([[0.02, 0.375], [0.04, 0.367], [0.065, 0.375]], PAL.ink, 1.8, 0.95);
      B.dot(0, 0.345, 2.2, PAL.tomato);
      B.stroke([[-0.03, 0.335], [-0.11, 0.33]], PAL.ink, 0.9, 0.7);
      B.stroke([[0.03, 0.335], [0.11, 0.33]], PAL.ink, 0.9, 0.7);
      B.shine([[-0.12, 0.08], [-0.13, 0.16]], PAL.cream, 2.4, 0.8);
      B.shine([[-0.08, 0.32], [-0.09, 0.4]], PAL.cream, 2, 0.7);
    }
  },
  {
    id: 'lidpot', name: 'Ornate lidded pot', material: 'ceramic', mass: 1.8, weight: 'medium', tier: 1,
    friction: 0.55, restitution: 0.07,
    pieces: [
      [[-0.15, 0], [0.15, 0], [0.25, 0.14], [0.26, 0.3], [0.2, 0.42], [-0.2, 0.42], [-0.26, 0.3], [-0.25, 0.14]],
      [[-0.2, 0.42], [0.2, 0.42], [0.12, 0.52], [-0.12, 0.52]],
      [[-0.04, 0.52], [0.04, 0.52], [0.03, 0.62], [-0.03, 0.62]]
    ],
    box: [-0.27, 0, 0.27, 0.64],
    paint(B) {
      const rnd = B.rnd;
      const prof = [[0.14, 0], [0.16, 0.035], [0.23, 0.12], [0.26, 0.24], [0.245, 0.34], [0.2, 0.42]];
      const body = wobblePath(lathe(prof), 0.004, rnd);
      B.gouache(body, {
        base: PAL.vermilion, box: [-0.27, 0, 0.27, 0.43], washes: [PAL.orange, PAL.tomato], shadow: 0.6,
        inner: () => {
          // olive and cream medallions with a mustard lattice
          for (let i = 0; i < 3; i++) {
            const x = -0.15 + i * 0.15;
            B.blob(ellipsePts(x, 0.23, 0.055, 0.075, 14), PAL.cream, 0.95);
            B.blob(ellipsePts(x, 0.23, 0.03, 0.045, 10), PAL.olive, 0.95);
            B.dot(x, 0.23, 1.6, PAL.mustard);
          }
          for (let i = 0; i < 9; i++) B.dot(-0.24 + i * 0.06, 0.37, 1.8, PAL.mustard, 0.95);
          for (let i = 0; i < 9; i++) B.dot(-0.22 + i * 0.055, 0.09, 1.6, PAL.cream, 0.9);
          B.stroke([[-0.26, 0.32], [0.26, 0.325]], PAL.burgundy, 2.4, 0.8, B.px(1));
          B.stroke([[-0.24, 0.13], [0.24, 0.135]], PAL.burgundy, 2.4, 0.8, B.px(1));
        }
      });
      const lid = wobblePath([[-0.215, 0.41], [0.215, 0.41], [0.16, 0.47], [0.11, 0.52], [-0.11, 0.52], [-0.16, 0.47]], 0.003, rnd);
      B.gouache(lid, {
        base: PAL.olive, box: [-0.22, 0.41, 0.22, 0.53], washes: [PAL.forest], strokes: 6,
        inner: () => { for (let i = 0; i < 6; i++) B.petal(-0.15 + i * 0.06, 0.42, -0.15 + i * 0.06, 0.48, 0.015, PAL.mustard, 0.9); }
      });
      const fin = wobblePath([[-0.035, 0.515], [0.035, 0.515], [0.045, 0.56], [0, 0.635], [-0.045, 0.56]], 0.002, rnd);
      B.gouache(fin, { base: PAL.mustard, box: [-0.05, 0.51, 0.05, 0.64], strokes: 3 });
      B.shine([[-0.21, 0.14], [-0.235, 0.24], [-0.21, 0.33]], PAL.cream, 3, 0.75);
    }
  },

  // ---------------- Brass and metal ----------------
  {
    id: 'candlestick', name: 'Brass candlestick', material: 'brass', mass: 2.0, weight: 'medium', tier: 3,
    friction: 0.33, restitution: 0.05, com: [0, 0.13],
    pieces: [
      [[-0.14, 0], [0.14, 0], [0.1, 0.06], [-0.1, 0.06]],
      [[-0.035, 0.06], [0.035, 0.06], [0.035, 0.72], [-0.035, 0.72]],
      [[-0.07, 0.72], [0.07, 0.72], [0.06, 0.8], [-0.06, 0.8]],
      [[-0.03, 0.8], [0.03, 0.8], [0.03, 1.0], [-0.03, 1.0]]
    ],
    box: [-0.15, 0, 0.15, 1.1],
    paint(B) {
      const rnd = B.rnd;
      // candle and flame
      const wax = wobblePath([[-0.03, 0.79], [0.03, 0.79], [0.031, 0.99], [0.01, 1.005], [-0.03, 0.995]], 0.002, rnd);
      B.gouache(wax, { base: PAL.cream, box: [-0.03, 0.79, 0.03, 1.0], strokes: 3, shadow: 0.35 });
      B.stroke([[0.02, 0.99], [0.024, 0.95], [0.02, 0.93]], PAL.creamDeep, 2, 0.9);
      B.stroke([[0, 1.0], [0, 1.02]], PAL.ink, 1.4, 0.9);
      B.blob([[0, 1.015], [0.022, 1.04], [0.012, 1.075], [0.002, 1.1], [-0.016, 1.07], [-0.02, 1.04]], PAL.mustard, 0.9, 0.002);
      B.blob([[0, 1.02], [0.01, 1.04], [0.004, 1.07], [-0.008, 1.04]], PAL.cream, 0.95, 0.001);
      const prof = [[0.14, 0], [0.135, 0.025], [0.09, 0.045], [0.05, 0.07], [0.034, 0.1], [0.045, 0.2], [0.03, 0.24], [0.03, 0.4], [0.055, 0.44], [0.03, 0.48], [0.03, 0.68], [0.045, 0.71], [0.072, 0.74], [0.06, 0.8]];
      const path = wobblePath(lathe(prof), 0.0025, rnd);
      brassFill(B, path, this.box, () => {
        for (const y of [0.2, 0.44, 0.74]) B.stroke([[-0.05, y], [0.05, y]], PAL.brassDark, 1.6, 0.8);
        B.stroke([[-0.12, 0.022], [0.12, 0.022]], PAL.brassLight, 2, 0.7);
      });
      B.shine([[-0.018, 0.12], [-0.019, 0.38], [-0.018, 0.66]], '#fff6d2', 2.2, 0.9);
      B.dot(-0.03, 0.44, 2.2, '#fff6d2', 0.9);
    }
  },
  {
    id: 'elephant', name: 'Brass elephant', material: 'brass', mass: 4.0, weight: 'heavy', tier: 3,
    friction: 0.4, restitution: 0.04, com: [0, 0.2],
    pieces: [
      [[-0.27, 0], [0.22, 0], [0.3, 0.3], [0.15, 0.44], [-0.2, 0.44], [-0.31, 0.28]],
      [[0.22, 0.1], [0.28, 0.04], [0.38, 0.26], [0.3, 0.4]]
    ],
    box: [-0.34, 0, 0.4, 0.47],
    paint(B) {
      const rnd = B.rnd, g = B.g;
      // far legs (darker), tail
      for (const x of [-0.2, 0.12]) B.blob(boxPts(x - 0.045, 0, x + 0.045, 0.2), PAL.brassDark, 1, 0.004);
      B.stroke([[-0.29, 0.3], [-0.33, 0.2], [-0.32, 0.14]], PAL.brassDark, 3, 1);
      const body = wobblePath([
        [-0.27, 0], [-0.17, 0], [-0.16, 0.12], [0.06, 0.12], [0.07, 0], [0.18, 0], [0.19, 0.16], [0.26, 0.12], [0.3, 0.04], [0.37, 0.03], [0.36, 0.1],
        [0.33, 0.26], [0.3, 0.38], [0.22, 0.45], [0.12, 0.44], [0.0, 0.43], [-0.18, 0.42], [-0.29, 0.34], [-0.31, 0.22], [-0.28, 0.12]
      ], 0.004, rnd);
      brassFill(B, body, this.box, () => {
        // ornamental saddle blanket in vermilion, cobalt and mustard
        B.blob([[-0.17, 0.42], [0.06, 0.43], [0.07, 0.24], [0.0, 0.2], [-0.1, 0.19], [-0.18, 0.23]], PAL.vermilion, 0.95, 0.005);
        B.blob([[-0.14, 0.38], [0.03, 0.39], [0.04, 0.27], [-0.13, 0.25]], PAL.cobalt, 0.9, 0.004);
        for (let i = 0; i < 6; i++) B.dot(-0.16 + i * 0.045, 0.215, 2.2, PAL.mustard);
        for (let i = 0; i < 3; i++) B.petal(-0.1 + i * 0.05, 0.3, -0.1 + i * 0.05, 0.36, 0.015, PAL.cream, 0.9);
        // ear and engraved lines
        B.blob([[0.13, 0.4], [0.2, 0.42], [0.22, 0.3], [0.17, 0.22], [0.12, 0.27]], PAL.brassDark, 0.55, 0.004);
        B.stroke([[0.14, 0.38], [0.19, 0.38], [0.2, 0.3]], PAL.brassLight, 1.4, 0.7);
        for (let i = 0; i < 4; i++) B.stroke([[0.31, 0.24 - i * 0.05], [0.35, 0.23 - i * 0.05]], PAL.brassDark, 1.2, 0.8);
      });
      B.dot(0.26, 0.33, 2.4, PAL.ink);
      B.stroke([[0.27, 0.22], [0.31, 0.19]], PAL.cream, 3, 0.95); // tusk
      g.save(); B.shine([[-0.25, 0.32], [-0.12, 0.43]], '#fff6d2', 2.6, 0.85); g.restore();
      B.shine([[0.22, 0.42], [0.3, 0.36]], '#fff6d2', 2, 0.8);
    }
  },
  {
    id: 'bell', name: 'Heavy brass bell', material: 'brass', mass: 5.0, weight: 'heavy', tier: 3,
    friction: 0.32, restitution: 0.04, com: [0, 0.22],
    pieces: [
      [[-0.24, 0], [0.24, 0], [0.2, 0.08], [0.17, 0.36], [0.1, 0.46], [-0.1, 0.46], [-0.17, 0.36], [-0.2, 0.08]],
      [[-0.045, 0.46], [0.045, 0.46], [0.045, 0.6], [-0.045, 0.6]]
    ],
    box: [-0.25, -0.02, 0.25, 0.62],
    paint(B) {
      const rnd = B.rnd;
      // handle knob in turned olive wood
      const h = wobblePath([[-0.04, 0.45], [0.04, 0.45], [0.05, 0.52], [0.035, 0.56], [0.05, 0.6], [0, 0.625], [-0.05, 0.6], [-0.035, 0.56], [-0.05, 0.52]], 0.002, rnd);
      B.gouache(h, { base: PAL.wood, box: [-0.05, 0.45, 0.05, 0.63], strokes: 4 });
      // clapper peeking under the rim
      B.blob(ellipsePts(0.02, 0.0, 0.035, 0.03, 10), PAL.brassDark, 1);
      const prof = [[0.245, 0], [0.24, 0.03], [0.2, 0.07], [0.18, 0.16], [0.17, 0.3], [0.15, 0.38], [0.1, 0.45], [0.05, 0.465]];
      const path = wobblePath(lathe(prof), 0.003, rnd);
      brassFill(B, path, [-0.25, 0, 0.25, 0.47], () => {
        B.stroke([[-0.23, 0.05], [0, 0.06], [0.23, 0.05]], PAL.brassDark, 2.2, 0.8);
        B.stroke([[-0.2, 0.1], [0, 0.11], [0.2, 0.1]], PAL.brassDark, 1.2, 0.6);
        // engraved vine band
        for (let i = 0; i < 7; i++) {
          const x = -0.15 + i * 0.05;
          B.stroke([[x, 0.2], [x + 0.025, 0.24], [x + 0.05, 0.2]], PAL.brassDark, 1.3, 0.75);
          B.petal(x + 0.025, 0.24, x + 0.04, 0.27, 0.008, PAL.brassDark, 0.7);
        }
        B.stroke([[-0.18, 0.31], [0, 0.32], [0.18, 0.31]], PAL.brassDark, 1.4, 0.7);
        B.stroke([[-0.17, 0.17], [0, 0.18], [0.17, 0.17]], PAL.brassDark, 1.4, 0.7);
      });
      B.shine([[-0.15, 0.08], [-0.13, 0.25], [-0.09, 0.4]], '#fff6d2', 3.2, 0.9);
      B.shine([[0.205, 0.04], [0.19, 0.08]], PAL.brassLight, 2, 0.8);
    }
  },
  {
    id: 'armillary', name: 'Armillary ornament', material: 'brass', mass: 2.6, weight: 'medium', tier: 3,
    friction: 0.38, restitution: 0.05, com: [0, 0.42],
    pieces: [
      [[-0.13, 0], [0.13, 0], [0.13, 0.1], [-0.13, 0.1]],
      [[-0.03, 0.1], [0.03, 0.1], [0.03, 0.4], [-0.03, 0.4]],
      { circle: [0, 0.56, 0.17] }
    ],
    box: [-0.19, 0, 0.19, 0.76],
    paint(B) {
      const rnd = B.rnd, g = B.g;
      const plinth = handPoly(boxPts(-0.13, 0, 0.13, 0.1), 0.003, rnd);
      B.gouache(plinth, {
        base: PAL.burgundyDeep, box: [-0.13, 0, 0.13, 0.1], washes: [PAL.wine], strokes: 6,
        inner: () => { for (let i = 0; i < 5; i++) B.dot(-0.1 + i * 0.05, 0.05, 1.8, PAL.mustard); }
      });
      const col = wobblePath(lathe([[0.05, 0.1], [0.03, 0.14], [0.026, 0.36], [0.045, 0.4]]), 0.002, rnd);
      brassFill(B, col, [-0.05, 0.1, 0.05, 0.4]);
      // rings: drawn as painted ellipses
      const ring = (rx, ry, rot, col, w) => {
        g.save(); g.translate(0, 0.56); g.rotate(rot);
        g.strokeStyle = PAL.brassDark; g.lineWidth = B.px(w + 2.6); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.stroke();
        g.strokeStyle = col; g.lineWidth = B.px(w); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.stroke();
        g.strokeStyle = rgba('#fff6d2', 0.7); g.lineWidth = B.px(w * 0.4); g.beginPath(); g.ellipse(0, 0, rx, ry, 0, Math.PI * 0.9, Math.PI * 1.35); g.stroke();
        g.restore();
      };
      // a cobalt globe at the centre
      const globe = wobblePath(ellipsePts(0, 0.56, 0.07, 0.07, 14), 0.002, rnd);
      B.gouache(globe, { base: PAL.cobalt, box: [-0.07, 0.49, 0.07, 0.63], strokes: 5, inner: () => B.blob([[-0.03, 0.57], [0.02, 0.6], [0.04, 0.55], [0, 0.53]], PAL.olive, 0.9) });
      ring(0.165, 0.165, 0, PAL.brass, 4.2);
      ring(0.165, 0.06, 0.45, PAL.brass, 3.4);
      ring(0.06, 0.165, 0, PAL.brass, 3);
      ring(0.165, 0.04, -0.3, PAL.ochre, 2.6);
      B.dot(0, 0.735, 3, PAL.brassLight);
      B.dot(0, 0.735, 1.4, PAL.vermilion);
    }
  },
  {
    id: 'oillamp', name: 'Brass oil lamp', material: 'brass', mass: 2.2, weight: 'medium', tier: 3,
    friction: 0.36, restitution: 0.05, com: [-0.03, 0.1],
    pieces: [[[-0.12, 0], [0.12, 0], [0.22, 0.1], [0.4, 0.2], [0.38, 0.23], [0.1, 0.24], [-0.18, 0.22], [-0.27, 0.16], [-0.24, 0.08]]],
    box: [-0.36, 0, 0.42, 0.34],
    paint(B) {
      const rnd = B.rnd, g = B.g;
      g.save(); g.strokeStyle = PAL.brassDark; g.lineWidth = 0.04; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-0.2, 0.2); g.bezierCurveTo(-0.38, 0.3, -0.4, 0.06, -0.22, 0.09); g.stroke();
      g.strokeStyle = PAL.brass; g.lineWidth = 0.022; g.stroke(); g.restore();
      const body = wobblePath([[-0.11, 0], [0.11, 0], [0.13, 0.04], [0.2, 0.1], [0.32, 0.16], [0.41, 0.2], [0.39, 0.235], [0.28, 0.21], [0.12, 0.235], [-0.05, 0.25], [-0.2, 0.22], [-0.26, 0.16], [-0.23, 0.08], [-0.13, 0.04]], 0.003, rnd);
      brassFill(B, body, [-0.27, 0, 0.42, 0.26], () => {
        for (let i = 0; i < 5; i++) B.stroke([[-0.18 + i * 0.07, 0.12], [-0.15 + i * 0.07, 0.17], [-0.12 + i * 0.07, 0.12]], PAL.brassDark, 1.4, 0.8);
        B.stroke([[-0.23, 0.09], [0.1, 0.1], [0.3, 0.17]], PAL.brassDark, 1.4, 0.6);
        B.dot(0, 0.15, 3, PAL.vermilion, 0.95);
        B.dot(0, 0.15, 1.3, PAL.cream, 0.9);
      });
      const lid = wobblePath([[-0.1, 0.24], [0.06, 0.24], [0.03, 0.29], [-0.01, 0.3], [-0.03, 0.34], [-0.05, 0.3], [-0.08, 0.29]], 0.002, rnd);
      brassFill(B, lid, [-0.1, 0.24, 0.06, 0.34]);
      // a little flame at the spout tip
      B.blob([[0.405, 0.22], [0.425, 0.25], [0.415, 0.29], [0.4, 0.31], [0.392, 0.27]], PAL.mustard, 0.85, 0.002);
      B.shine([[-0.2, 0.19], [-0.05, 0.235], [0.1, 0.22]], '#fff6d2', 2.6, 0.9);
    }
  },

  // ---------------- Natural objects ----------------
  {
    id: 'pomegranate', name: 'Pomegranate', material: 'fruit', mass: 0.6, weight: 'light', tier: 2,
    friction: 0.7, restitution: 0.12, angDamp: 1.6,
    pieces: [
      [[-0.06, 0], [0.07, 0.005], [0.17, 0.06], [0.215, 0.17], [0.19, 0.29], [0.1, 0.37], [-0.02, 0.385], [-0.13, 0.35], [-0.2, 0.25], [-0.205, 0.13], [-0.15, 0.04]],
      [[-0.05, 0.37], [0.05, 0.37], [0.06, 0.45], [-0.06, 0.45]]
    ],
    box: [-0.22, 0, 0.22, 0.46],
    paint(B) {
      const rnd = B.rnd;
      const crown = wobblePath([[-0.045, 0.36], [0.045, 0.36], [0.05, 0.43], [0.07, 0.46], [0.03, 0.44], [0, 0.465], [-0.03, 0.44], [-0.07, 0.46], [-0.05, 0.43]], 0.002, rnd);
      B.gouache(crown, { base: PAL.tomato, box: [-0.07, 0.36, 0.07, 0.47], strokes: 4 });
      const body = wobblePath(this.pieces[0], 0.004, rnd);
      B.gouache(body, {
        base: PAL.tomato, box: [-0.22, 0, 0.22, 0.39], washes: [PAL.vermilion, PAL.burgundy, PAL.orange, PAL.mustard], shadow: 0.75, strokeAngle: 0.6, strokes: 34,
        inner: () => {
          // sun-blush and tiny freckles
          B.blob(ellipsePts(-0.07, 0.24, 0.08, 0.06, 12), PAL.mustard, 0.35, 0.01);
          for (let i = 0; i < 26; i++) B.dot(-0.18 + B.rnd() * 0.36, 0.03 + B.rnd() * 0.33, 0.9, PAL.cream, 0.5);
        }
      });
      B.shine([[-0.14, 0.14], [-0.15, 0.22], [-0.11, 0.3]], PAL.cream, 3, 0.75);
    }
  },
  {
    id: 'pear', name: 'Pear', material: 'fruit', mass: 0.45, weight: 'light', tier: 2,
    friction: 0.65, restitution: 0.1, angDamp: 0.9, com: [0, 0.14],
    pieces: [[[-0.07, 0], [0.08, 0], [0.165, 0.07], [0.18, 0.17], [0.12, 0.29], [0.07, 0.42], [-0.04, 0.44], [-0.09, 0.3], [-0.175, 0.17], [-0.15, 0.06]]],
    box: [-0.19, 0, 0.19, 0.52],
    paint(B) {
      const rnd = B.rnd;
      B.stroke([[0.01, 0.43], [0.02, 0.48], [0.045, 0.52]], PAL.umber, 3.4, 1);
      B.petal(0.03, 0.47, 0.13, 0.5, 0.025, PAL.forest, 0.95);
      B.stroke([[0.035, 0.475], [0.12, 0.497]], PAL.olive, 1, 0.8);
      const body = wobblePath([[-0.07, 0], [0.08, 0.002], [0.155, 0.05], [0.18, 0.15], [0.14, 0.25], [0.085, 0.33], [0.06, 0.42], [0.0, 0.445], [-0.055, 0.42], [-0.08, 0.33], [-0.13, 0.25], [-0.175, 0.16], [-0.155, 0.06]], 0.004, rnd);
      B.gouache(body, {
        base: PAL.mustard, box: [-0.18, 0, 0.18, 0.45], washes: [PAL.olive, PAL.orange, '#e9c55a'], shadow: 0.6, strokeAngle: 1.2,
        inner: () => {
          B.blob(ellipsePts(0.08, 0.15, 0.08, 0.1, 12), PAL.vermilion, 0.28, 0.01);
          for (let i = 0; i < 18; i++) B.dot(-0.15 + B.rnd() * 0.3, 0.02 + B.rnd() * 0.38, 0.8, PAL.umber, 0.45);
        }
      });
      B.shine([[-0.13, 0.1], [-0.12, 0.2], [-0.06, 0.32]], PAL.cream, 2.8, 0.75);
    }
  },
  {
    id: 'grapes', name: 'Bunch of grapes', material: 'fruit', mass: 0.6, weight: 'light', tier: 2,
    friction: 0.95, restitution: 0.02, angDamp: 0.8,
    pieces: [[[-0.3, 0.03], [-0.1, 0], [0.15, 0], [0.3, 0.07], [0.29, 0.2], [0.06, 0.3], [-0.2, 0.27], [-0.32, 0.15]]],
    box: [-0.36, 0, 0.38, 0.34],
    paint(B) {
      const rnd = B.rnd;
      // stem and a vine leaf
      B.stroke([[0.26, 0.17], [0.33, 0.22], [0.37, 0.3]], PAL.umber, 3, 1);
      const leaf = wobblePath([[0.24, 0.22], [0.3, 0.33], [0.22, 0.34], [0.16, 0.3], [0.1, 0.33], [0.12, 0.27]], 0.004, rnd);
      B.gouache(leaf, { base: PAL.olive, box: [0.1, 0.22, 0.3, 0.34], strokes: 5, inner: () => B.stroke([[0.24, 0.23], [0.16, 0.3]], PAL.forest, 1.2, 0.9) });
      // individual grapes, back to front
      const gr = [];
      const r = 0.055;
      const rows = [[-0.25, 0.06, 2], [-0.14, 0.055, 3], [-0.02, 0.055, 4], [0.1, 0.06, 4], [0.21, 0.07, 3]];
      for (const [x, y0, n] of rows) for (let k = 0; k < n; k++) gr.push([x + (rnd() - 0.5) * 0.02, y0 + k * 0.065 + (rnd() - 0.5) * 0.01]);
      gr.sort((a, b) => b[1] - a[1]);
      for (const [x, y] of gr) {
        const hue = mix('#5a2a62', PAL.burgundy, rnd() * 0.6);
        const p = wobblePath(ellipsePts(x, y, r * (0.92 + rnd() * 0.15), r * (0.92 + rnd() * 0.15), 12), 0.002, rnd);
        B.gouache(p, { base: hue, box: [x - r, y - r, x + r, y + r], washes: [PAL.cobaltDeep, PAL.wine], strokes: 3, shadow: 0.6, lit: 0.25, grain: 0.2, edgeW: 1.2, bottomShade: false });
        B.dot(x - r * 0.4, y + r * 0.35, 1.6, '#e9d8f0', 0.8);
      }
    }
  },
  {
    id: 'pumpkin', name: 'Small pumpkin', material: 'fruit', mass: 2.4, weight: 'heavy', tier: 2,
    friction: 0.7, restitution: 0.06, angDamp: 0.5,
    pieces: [
      [[-0.2, 0], [0.2, 0], [0.3, 0.08], [0.32, 0.2], [0.25, 0.32], [-0.25, 0.32], [-0.32, 0.2], [-0.3, 0.08]],
      [[-0.03, 0.31], [0.03, 0.31], [0.05, 0.42], [0.0, 0.43]]
    ],
    box: [-0.33, 0, 0.33, 0.44],
    paint(B) {
      const rnd = B.rnd;
      B.stroke([[0, 0.3], [0.015, 0.37], [0.05, 0.42]], PAL.forest, 7, 1);
      B.stroke([[0, 0.3], [0.015, 0.37], [0.05, 0.42]], PAL.olive, 3.5, 0.9);
      // ribs from the outside in
      const ribs = [[-0.21, 0.12], [0.21, 0.12], [-0.1, 0.15], [0.1, 0.15], [0, 0.16]];
      for (const [cx, rx] of ribs) {
        const p = wobblePath(ellipsePts(cx, 0.165, rx, 0.165, 18).map(([x, y]) => [x, Math.max(y, 0.004)]), 0.004, rnd);
        const base = cx === 0 ? PAL.orange : mix(PAL.orange, PAL.tomato, Math.abs(cx) * 2);
        B.gouache(p, { base, box: [cx - rx, 0, cx + rx, 0.33], washes: [PAL.mustard, PAL.vermilion], strokes: 7, shadow: 0.5, lit: 0.3, strokeAngle: Math.PI / 2, edgeW: 1.4 });
      }
      B.shine([[-0.05, 0.08], [-0.06, 0.18], [-0.045, 0.27]], PAL.cream, 2.6, 0.7);
      B.shine([[-0.25, 0.1], [-0.26, 0.18]], PAL.cream, 2, 0.55);
    }
  },
  {
    id: 'coconut', name: 'Coconut', material: 'fruit', mass: 1.4, weight: 'medium', tier: 2,
    friction: 0.6, restitution: 0.1, angDamp: 1.3,
    pieces: [[[-0.07, 0], [0.09, 0.005], [0.18, 0.06], [0.215, 0.17], [0.19, 0.28], [0.1, 0.36], [-0.02, 0.38], [-0.13, 0.34], [-0.2, 0.25], [-0.21, 0.12], [-0.16, 0.04]]],
    box: [-0.22, 0, 0.22, 0.39],
    paint(B) {
      const rnd = B.rnd;
      const body = wobblePath(this.pieces[0], 0.005, rnd);
      B.gouache(body, {
        base: '#6a3f22', box: this.box, washes: [PAL.umber, PAL.wood, PAL.ochre], shadow: 0.7, strokes: 60, strokeLen: 0.12,
        strokeColors: [PAL.ochre, PAL.umber, '#9a6a3c', PAL.creamDeep],
        inner: () => {
          // fibrous hair strokes
          for (let i = 0; i < 70; i++) {
            const x = -0.2 + B.rnd() * 0.4, y = 0.02 + B.rnd() * 0.35, a = 0.4 + B.rnd() * 0.8;
            B.stroke([[x, y], [x + Math.cos(a) * 0.04, y + Math.sin(a) * 0.04]], B.rnd() < 0.5 ? PAL.creamDeep : PAL.umber, 0.9, 0.5);
          }
        }
      });
      // the three eyes
      for (const [x, y] of [[-0.035, 0.3], [0.035, 0.3], [0, 0.26]]) B.dot(x, y, 3.2, PAL.ink, 0.9);
      B.shine([[-0.15, 0.12], [-0.155, 0.2]], PAL.cream, 2.2, 0.45);
    }
  },
  {
    id: 'lemon', name: 'Lemon', material: 'fruit', mass: 0.3, weight: 'light', tier: 1,
    friction: 0.65, restitution: 0.12, angDamp: 1.4,
    pieces: [[[-0.1, 0.005], [0.1, 0.005], [0.155, 0.06], [0.18, 0.12], [0.15, 0.19], [0.09, 0.225], [-0.09, 0.225], [-0.15, 0.19], [-0.18, 0.12], [-0.155, 0.06]]],
    box: [-0.2, 0, 0.2, 0.24],
    paint(B) {
      const rnd = B.rnd;
      const body = wobblePath([[-0.1, 0.005], [0.1, 0.005], [0.15, 0.05], [0.18, 0.1], [0.2, 0.12], [0.18, 0.14], [0.15, 0.19], [0.09, 0.225], [-0.09, 0.225], [-0.15, 0.19], [-0.18, 0.14], [-0.2, 0.12], [-0.18, 0.1], [-0.15, 0.05]], 0.003, rnd);
      B.gouache(body, {
        base: '#efc531', box: this.box, washes: [PAL.mustard, '#f6dc6a', PAL.olive], shadow: 0.55, strokeAngle: 0.1,
        inner: () => { for (let i = 0; i < 30; i++) B.dot(-0.17 + B.rnd() * 0.34, 0.02 + B.rnd() * 0.2, 0.8, PAL.ochre, 0.5); }
      });
      B.petal(0.02, 0.215, -0.1, 0.27, 0.025, PAL.forest, 0.95);
      B.shine([[-0.12, 0.15], [-0.04, 0.19]], PAL.cream, 2.6, 0.85);
    }
  },

  // ---------------- Curiosities ----------------
  {
    id: 'books', name: 'Stack of books', material: 'books', mass: 3.0, weight: 'heavy', tier: 2,
    friction: 0.8, restitution: 0.02,
    pieces: [
      boxPts(-0.4, 0, 0.36, 0.12),
      boxPts(-0.34, 0.12, 0.4, 0.23),
      boxPts(-0.3, 0.23, 0.26, 0.31)
    ],
    box: [-0.41, 0, 0.41, 0.32],
    paint(B) {
      const rnd = B.rnd;
      const book = (x0, y0, x1, y1, cover, band, title) => {
        // page block peeking at the right
        B.blob(boxPts(x1 - 0.03, y0 + 0.012, x1 + 0.005, y1 - 0.012), PAL.cream, 1, 0.002);
        for (let i = 1; i < 4; i++) B.stroke([[x1 - 0.025, y0 + (y1 - y0) * i / 4], [x1, y0 + (y1 - y0) * i / 4]], PAL.creamDeep, 0.8, 0.9);
        const p = handPoly([[x0, y0], [x1 - 0.025, y0], [x1 - 0.025, y1], [x0, y1]], 0.003, rnd);
        B.gouache(p, {
          base: cover, box: [x0, y0, x1, y1], strokeAngle: 0, strokes: 10, shadow: 0.4, bottomShade: false,
          inner: () => {
            const h = y1 - y0;
            B.stroke([[x0 + 0.04, y0], [x0 + 0.04, y1]], band, 3, 0.9);
            B.stroke([[x1 - 0.08, y0], [x1 - 0.08, y1]], band, 3, 0.9);
            if (title) {
              B.blob(boxPts(x0 + 0.1, y0 + h * 0.3, x0 + 0.1 + title, y1 - h * 0.3), band, 0.9, 0.002);
              B.stroke([[x0 + 0.12, y0 + h * 0.5], [x0 + 0.08 + title, y0 + h * 0.5]], cover, 1, 0.7);
            }
            for (let i = 0; i < 3; i++) B.dot(x0 + 0.2 + i * 0.03, y0 + h * 0.5, 1.4, PAL.mustard, 0.9);
          }
        });
      };
      book(-0.4, 0, 0.36, 0.12, PAL.forest, PAL.mustard, 0.18);
      book(-0.34, 0.12, 0.4, 0.23, PAL.vermilion, PAL.cream, 0.22);
      book(-0.3, 0.23, 0.26, 0.31, PAL.cobalt, PAL.ochre, 0.14);
      B.shine([[-0.3, 0.3], [0.1, 0.302]], PAL.cream, 1.6, 0.6);
    }
  },
  {
    id: 'perfume', name: 'Glass perfume bottle', material: 'glass', mass: 0.55, weight: 'light', tier: 2,
    friction: 0.2, restitution: 0.18,
    pieces: [
      [[-0.13, 0], [0.13, 0], [0.14, 0.16], [0.09, 0.24], [-0.09, 0.24], [-0.14, 0.16]],
      [[-0.03, 0.24], [0.03, 0.24], [0.03, 0.29], [-0.03, 0.29]],
      [[-0.07, 0.29], [0.07, 0.29], [0.05, 0.42], [-0.05, 0.42]]
    ],
    box: [-0.15, 0, 0.15, 0.43],
    paint(B) {
      const rnd = B.rnd, g = B.g;
      const bodyPts = [[-0.13, 0], [0.13, 0], [0.142, 0.15], [0.09, 0.24], [-0.09, 0.24], [-0.142, 0.15]];
      const body = handPoly(bodyPts, 0.002, rnd);
      // translucent glass: a thin wash with the backdrop showing through
      g.save();
      g.fillStyle = rgba('#d9a3b5', 0.32); g.fill(body);
      g.clip(body);
      // perfume inside
      B.blob([[-0.14, 0], [0.14, 0], [0.14, 0.13], [0.07, 0.14], [-0.07, 0.13], [-0.14, 0.135]], PAL.vermilion, 0.62, 0.003);
      B.stroke([[-0.14, 0.135], [0, 0.14], [0.14, 0.13]], '#ffb48f', 1.6, 0.8);
      // facets
      B.stroke([[-0.08, 0.02], [-0.07, 0.22]], '#ffffff', 1.2, 0.45);
      B.stroke([[0.08, 0.02], [0.07, 0.22]], PAL.burgundy, 1.4, 0.35);
      B.dryBrush([-0.14, 0, 0.14, 0.24], ['#ffffff', PAL.cream], 8, Math.PI / 2, 0.15);
      g.restore();
      B.edge(body, PAL.wine, 1.3);
      // neck and stopper
      const neck = handPoly(boxPts(-0.03, 0.24, 0.03, 0.29), 0.001, rnd);
      g.fillStyle = rgba(PAL.mustard, 0.85); g.fill(neck); B.edge(neck, PAL.brassDark, 1.1);
      const stop = handPoly([[-0.07, 0.29], [0.07, 0.29], [0.055, 0.36], [0, 0.425], [-0.055, 0.36]], 0.002, rnd);
      g.save(); g.fillStyle = rgba(PAL.cobalt, 0.55); g.fill(stop); g.clip(stop);
      B.stroke([[-0.03, 0.3], [0, 0.42]], '#ffffff', 1.2, 0.6);
      B.stroke([[0.03, 0.3], [0.045, 0.36]], PAL.cobaltDeep, 2, 0.6);
      g.restore();
      B.edge(stop, PAL.cobaltDeep, 1.2);
      // ring highlights that make it read as glass
      B.shine([[-0.115, 0.03], [-0.122, 0.12]], '#ffffff', 2.6, 0.95);
      B.dot(0.1, 0.19, 1.8, '#ffffff', 0.9);
    }
  },
  {
    id: 'frame', name: 'Framed miniature', material: 'wood', mass: 1.2, weight: 'medium', tier: 1,
    friction: 0.5, restitution: 0.05,
    pieces: [
      [[-0.2, 0], [0.2, 0], [0.26, 0.04], [0.26, 0.66], [-0.26, 0.66], [-0.26, 0.04]]
    ],
    box: [-0.28, 0, 0.28, 0.68],
    paint(B) {
      const rnd = B.rnd;
      // feet
      B.blob(boxPts(-0.2, 0, -0.12, 0.05), PAL.brassDark, 1, 0.003);
      B.blob(boxPts(0.12, 0, 0.2, 0.05), PAL.brassDark, 1, 0.003);
      const outer = handPoly(boxPts(-0.26, 0.04, 0.26, 0.66), 0.003, rnd);
      brassFill(B, outer, [-0.26, 0.04, 0.26, 0.66], () => {
        for (let i = 0; i < 9; i++) { B.dot(-0.23, 0.08 + i * 0.065, 1.8, PAL.brassDark, 0.8); B.dot(0.23, 0.08 + i * 0.065, 1.8, PAL.brassDark, 0.8); }
        for (let i = 0; i < 7; i++) { B.dot(-0.19 + i * 0.063, 0.625, 1.8, PAL.brassDark, 0.8); B.dot(-0.19 + i * 0.063, 0.075, 1.8, PAL.brassDark, 0.8); }
      });
      // the painting: a tiny landscape with a cobalt sky and a red sun
      const inner = handPoly(boxPts(-0.2, 0.1, 0.2, 0.6), 0.002, rnd);
      B.gouache(inner, {
        base: PAL.cobalt, box: [-0.2, 0.1, 0.2, 0.6], washes: ['#3d66b8', PAL.cobaltDeep], strokeAngle: 0, strokes: 12, shadow: 0.3, lit: 0.15, bottomShade: false,
        inner: () => {
          B.blob(ellipsePts(0.07, 0.45, 0.05, 0.05, 12), PAL.vermilion, 0.95);
          B.blob([[-0.25, 0.1], [0.25, 0.1], [0.25, 0.3], [0.1, 0.36], [-0.02, 0.3], [-0.12, 0.34], [-0.25, 0.28]], PAL.olive, 0.98, 0.006);
          B.blob([[-0.25, 0.1], [0.25, 0.1], [0.25, 0.2], [0.05, 0.24], [-0.25, 0.19]], PAL.forest, 0.95, 0.006);
          B.blob([[-0.25, 0.1], [0.25, 0.1], [0.25, 0.15], [-0.25, 0.14]], PAL.mustard, 0.9, 0.004);
          for (let i = 0; i < 3; i++) {
            const x = -0.12 + i * 0.07;
            B.stroke([[x, 0.2], [x, 0.3]], PAL.umber, 1.6, 0.9);
            B.blob(ellipsePts(x, 0.32, 0.03, 0.04, 9), PAL.forest, 0.95);
          }
        }
      });
      B.edge(inner, PAL.ink, 1.4);
      B.shine([[-0.245, 0.1], [-0.245, 0.6]], '#fff6d2', 2, 0.8);
    }
  }
];

// Brass: warm metal with strong dark bands, a reflected warm glow from the
// table at the bottom and crisp light streaks.
function brassFill(B, path, box, inner) {
  B.gouache(path, {
    base: PAL.brass, dark: PAL.brassDark, light: PAL.brassLight, box,
    washes: [PAL.ochre, PAL.mustard, '#a8742a'], shadow: 0.85, lit: 0.5,
    strokeColors: [PAL.brassLight, PAL.brassDark, '#e6b955'], strokes: 22,
    edgeColor: '#4a3010',
    inner: () => {
      const w = box[2] - box[0], h = box[3] - box[1];
      // a dark reflected band and a terracotta bounce light from the table
      B.stroke([[box[0] + w * 0.62, box[1]], [box[0] + w * 0.6, box[3]]], PAL.brassDark, Math.max(2, w * B.S * 0.08), 0.35);
      B.stroke([[box[0], box[1] + h * 0.04], [box[2], box[1] + h * 0.04]], PAL.terracotta, Math.max(2, h * B.S * 0.05), 0.3);
      if (inner) inner();
    }
  });
}

const OBJECT_BY_ID = {};
for (const o of OBJECTS) OBJECT_BY_ID[o.id] = o;
