// Visual theme engine. Completely independent of the puzzle: a theme only says
// how hue family i of ring k looks, never where it is.
//
// A theme is assembled from curated registries:
//   colour universes (palette laws in OKLCH + names + compatible looks),
//   materials, grounds (backgrounds), separations, lights and completion styles.
// Every assembled theme passes visual QC or is re-drawn deterministically.

const ThemeRegistry = {
  universes: [],
  materials: {},
  grounds: {},
  authored: {},   // key -> theme spec override (hand art-directed editions)
  registerUniverse(u) { this.universes.push(u); return u; },
  registerMaterial(id, m) { this.materials[id] = Object.assign({ id }, m); },
  registerGround(id, g) { this.grounds[id] = Object.assign({ id }, g); },
  registerAuthored(key, spec) { this.authored[key] = spec; }
};

// ---- Materials --------------------------------------------------------------
// Rendering recipes the board renderer understands. Values are 0..1 strengths.
[
  ['matte',      { label: 'matte pigment',       alpha: 1,    bevel: 0.16, gloss: 0.04, spec: 0.0,  sheen: null,      texture: 'grain',    texAlpha: 0.05, rim: 0.10 }],
  ['satin',      { label: 'satin lacquer',       alpha: 1,    bevel: 0.24, gloss: 0.14, spec: 0.10, sheen: null,      texture: 'grain',    texAlpha: 0.035, rim: 0.16 }],
  ['ceramic',    { label: 'glazed ceramic',      alpha: 1,    bevel: 0.30, gloss: 0.22, spec: 0.30, sheen: null,      texture: 'crackle',  texAlpha: 0.05, rim: 0.22 }],
  ['glass',      { label: 'cast glass',          alpha: 0.64, bevel: 0.18, gloss: 0.20, spec: 0.38, sheen: null,      texture: null,       texAlpha: 0,    rim: 0.42 }],
  ['metal',      { label: 'anodised metal',      alpha: 1,    bevel: 0.30, gloss: 0.10, spec: 0.22, sheen: 'brushed', texture: 'brushed',  texAlpha: 0.10, rim: 0.30 }],
  ['opal',       { label: 'opalescent resin',    alpha: 0.94, bevel: 0.20, gloss: 0.18, spec: 0.20, sheen: 'opal',    texture: null,       texAlpha: 0,    rim: 0.24 }],
  ['holo',       { label: 'holographic film',    alpha: 1,    bevel: 0.14, gloss: 0.10, spec: 0.16, sheen: 'holo',    texture: 'lines',    texAlpha: 0.07, rim: 0.20 }],
  ['print',      { label: 'risograph ink',       alpha: 1,    bevel: 0.0,  gloss: 0.0,  spec: 0.0,  sheen: null,      texture: 'halftone', texAlpha: 0.13, rim: 0.0, misregister: 1 }],
  ['watercolour',{ label: 'watercolour wash',    alpha: 0.86, bevel: 0.0,  gloss: 0.0,  spec: 0.0,  sheen: null,      texture: 'paper',    texAlpha: 0.16, rim: 0.0, pool: 1 }],
  ['enamel',     { label: 'cloisonné enamel',    alpha: 1,    bevel: 0.26, gloss: 0.20, spec: 0.26, sheen: null,      texture: 'grain',    texAlpha: 0.03, rim: 0.30 }],
  ['velvet',     { label: 'flocked velvet',      alpha: 1,    bevel: -0.22, gloss: 0.0, spec: 0.0,  sheen: 'velvet',  texture: 'grain',    texAlpha: 0.10, rim: 0.06 }],
  ['stone',      { label: 'honed stone',         alpha: 1,    bevel: 0.18, gloss: 0.06, spec: 0.04, sheen: null,      texture: 'speckle',  texAlpha: 0.12, rim: 0.12 }]
].forEach(m => ThemeRegistry.registerMaterial(m[0], m[1]));

// ---- Grounds (backgrounds) ---------------------------------------------------
// L/C/h is the base tone; `light` grounds flip the interface ink.
[
  ['graphite',  { L: 0.175, C: 0.006, h: 70,  label: 'graphite' }],
  ['ink',       { L: 0.165, C: 0.022, h: 262, label: 'midnight ink' }],
  ['aubergine', { L: 0.175, C: 0.030, h: 330, label: 'aubergine' }],
  ['forest',    { L: 0.180, C: 0.022, h: 165, label: 'forest dark' }],
  ['oxblood',   { L: 0.185, C: 0.040, h: 22,  label: 'oxblood' }],
  ['slate',     { L: 0.225, C: 0.014, h: 240, label: 'slate' }],
  ['umber',     { L: 0.190, C: 0.020, h: 55,  label: 'raw umber' }],
  ['bone',      { L: 0.925, C: 0.014, h: 85,  label: 'bone', light: true }],
  ['paper',     { L: 0.950, C: 0.012, h: 92,  label: 'cotton paper', light: true }],
  ['putty',     { L: 0.860, C: 0.012, h: 70,  label: 'putty', light: true }]
].forEach(g => ThemeRegistry.registerGround(g[0], g[1]));

const GROUND_PATTERNS = ['orbits', 'ticks', 'grid', 'rays', 'none'];
const COMPLETIONS = ['radiance', 'sweep', 'bloom', 'chime'];
const SEPARATIONS = {
  gap:      { style: 'gap',      width: 2.2 },
  fine:     { style: 'gap',      width: 1.2 },
  hairline: { style: 'hairline', width: 1.4 },
  engraved: { style: 'engraved', width: 2.0 },
  cloison:  { style: 'metal',    width: 2.4 },
  flush:    { style: 'gap',      width: 0.7 }
};

// ---- Palette laws --------------------------------------------------------------
// Each law maps family index i (0..11) to OKLCH. `p` holds the drawn parameters.
const PaletteLaws = {
  // Full hue circle; lightness follows a gentle wave so warm hues sit brighter.
  wheel(i, p) {
    const t = i / SEGMENTS;
    const h = p.h0 + 360 * t * p.dir;
    return [p.L0 + p.Lamp * Math.cos(TAU * (t - p.Lph)), p.C0 + p.Camp * Math.cos(TAU * (t - p.Cph)), h];
  },
  // Hue swings across an arc while lightness travels the other axis of an ellipse,
  // so every family is unique even though hues repeat.
  arc(i, p) {
    const x = TAU * i / SEGMENTS + p.ph;
    return [p.L0 + p.Lamp * Math.cos(x), p.C0 + p.Camp * Math.sin(x + 0.6), p.h0 + p.span * Math.sin(x)];
  },
  // Monochrome study: one hue, a closed loop through lightness and chroma.
  mono(i, p) {
    const x = TAU * i / SEGMENTS + p.ph;
    return [p.L0 + p.Lamp * Math.cos(x), p.C0 + p.Camp * Math.sin(x), p.h0 + p.span * Math.sin(x)];
  },
  // A graded ramp with one deliberate seam (brutalist / gradient studies).
  ramp(i, p) {
    const t = i / (SEGMENTS - 1);
    const L = p.Lmin + (p.Lmax - p.Lmin) * t;
    if (p.accent && i === 0) return [p.accentL, p.accentC, p.accentH];
    return [L, p.C0 + p.Camp * Math.sin(Math.PI * t), p.h0 + p.span * t];
  },
  // Optical: alternating light and dark around the circle, hue turning slowly.
  optical(i, p) {
    const t = i / SEGMENTS;
    const hi = i % 2 === 0;
    return [hi ? p.Lhi : p.Llo, hi ? p.Chi : p.Clo, p.h0 + 360 * t];
  }
};

// ---- Colour universes ----------------------------------------------------------
// Curated: each defines a palette law with bounded parameters, the looks that
// suit it and its own vocabulary. Add a universe here; nothing else changes.
function U(def) { return ThemeRegistry.registerUniverse(def); }

U({ id: 'prism', title: 'Prism', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.70, 0.74), Lamp: r.range(0.06, 0.09), Lph: r.range(0.17, 0.25), C0: r.range(0.125, 0.15), Camp: 0.02, Cph: 0.2 }),
  materials: ['satin', 'matte', 'ceramic'], grounds: ['graphite', 'ink'], seps: ['gap', 'fine'],
  names: ['Prime Meridian', 'Spectral Index', 'Chromatic Survey', 'Twelve Lights', 'Colour Field', 'Refraction Study'],
  blurb: 'A full turn of the spectrum, tuned so no hue shouts over its neighbours.' });

U({ id: 'pastel', title: 'Pastel', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.79, 0.81), Lamp: 0.05, Lph: 0.2, C0: r.range(0.1, 0.108), Camp: 0.015, Cph: r.range(0, 1) }),
  materials: ['matte', 'ceramic', 'satin', 'velvet'], grounds: ['ink', 'aubergine', 'slate'], seps: ['gap', 'fine', 'engraved'],
  names: ['Sugared Almond', 'Morning Chalk', 'Powder Room', 'Macaron Theory', 'Soft Machine', 'Pale Fire'],
  blurb: 'Chalky pastels, all at one lightness, so colour does the talking.' });

U({ id: 'earth', title: 'Earth Pigment', law: 'arc',
  params: r => ({ h0: r.range(50, 62), span: r.range(54, 62), ph: r.range(0, TAU), L0: r.range(0.60, 0.63), Lamp: r.range(0.18, 0.2), C0: r.range(0.1, 0.11), Camp: 0.035 }),
  materials: ['matte', 'stone', 'print', 'velvet'], grounds: ['umber', 'graphite', 'paper'], seps: ['gap', 'engraved'],
  names: ['Ochre & Umber', 'Terra di Siena', 'Kiln Dust', 'Iron Oxide', 'Field Notes', 'Red Earth'],
  blurb: 'Iron oxides, ochres and umbers: the oldest paints there are.' });

U({ id: 'alloy', title: 'Alloy', law: 'arc',
  params: r => ({ h0: r.range(55, 75), span: r.range(74, 84), ph: r.range(0, TAU), L0: r.range(0.66, 0.68), Lamp: r.range(0.18, 0.2), C0: r.range(0.088, 0.096), Camp: 0.04 }),
  materials: ['metal'], grounds: ['ink', 'graphite', 'slate'], seps: ['engraved', 'fine'],
  names: ['Brass & Steel', 'Anodised', 'Foundry Light', 'Rose Gold Engine', 'Titanium Bloom', 'Bronze Age'],
  blurb: 'Brass, copper, steel and bronze, turned and brushed like a watch movement.' });

U({ id: 'glass', title: 'Glasswork', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: r.chance(0.5) ? 1 : -1, L0: r.range(0.70, 0.74), Lamp: 0.05, Lph: 0.2, C0: r.range(0.13, 0.15), Camp: 0.02, Cph: 0.6 }),
  materials: ['glass'], grounds: ['slate', 'ink', 'graphite'], seps: ['fine', 'gap'],
  names: ['Murano', 'Leaded Light', 'Cathedral', 'Dichroic', 'Blown Glass', 'Lantern'],
  blurb: 'Coloured glass held in light; the ground shows through every segment.' });

U({ id: 'opal', title: 'Opaline', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.77, 0.79), Lamp: 0.05, Lph: 0.2, C0: r.range(0.105, 0.115), Camp: 0.015, Cph: 0.3 }),
  materials: ['opal', 'holo'], grounds: ['ink', 'aubergine', 'graphite'], seps: ['fine', 'gap'],
  names: ['Mother of Pearl', 'Moonstone', 'Opaline', 'Nacre', 'Fire Opal', 'Abalone'],
  blurb: 'Milky colour with a shifting sheen that moves as the rings turn.' });

U({ id: 'fluoro', title: 'Fluorescent', law: 'arc',
  params: r => ({ h0: r.range(30, 50), span: r.range(95, 110), ph: r.range(0, TAU), L0: r.range(0.70, 0.72), Lamp: r.range(0.12, 0.14), C0: r.range(0.17, 0.2), Camp: 0.03 }),
  materials: ['print', 'matte'], grounds: ['paper', 'graphite', 'bone'], seps: ['gap', 'fine'],
  names: ['Fluorescent Pink', 'Day-Glo Press', 'Hi-Vis Garden', 'Signal Ink', 'Laser Lemon', 'Riso Bloom'],
  blurb: 'Fluorescent print inks: pink, orange and yellow pressed onto paper.' });

U({ id: 'mono', title: 'Monochrome', law: 'ramp',
  params: r => ({ h0: r.range(0, 360), span: r.range(-16, 16), Lmin: r.range(0.36, 0.38), Lmax: r.range(0.9, 0.92), C0: r.range(0.04, 0.06), Camp: r.range(0.06, 0.08) }),
  materials: ['satin', 'matte', 'ceramic', 'stone'], grounds: ['graphite', 'ink', 'slate'], seps: ['gap', 'engraved', 'hairline'],
  names: ['Monochrome Study', 'Single Note', 'Tonal Scale', 'One Colour Only', 'Value Study', 'Grisaille'],
  blurb: 'One hue only. Read the rings by value, from shadow to highlight.' });

U({ id: 'vintage', title: 'Vintage Print', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.58, 0.62), Lamp: r.range(0.08, 0.1), Lph: 0.2, C0: r.range(0.1, 0.11), Camp: 0.02, Cph: 0.5 }),
  materials: ['print', 'matte'], grounds: ['paper', 'bone', 'putty'], seps: ['gap', 'fine'],
  names: ['Letterpress', 'Travel Poster', 'Atlas Plate', 'Seed Catalogue', 'Matchbox', 'Off-Register'],
  blurb: 'Muted offset inks, halftone dots and a little misregistration.' });

U({ id: 'porcelain', title: 'Porcelain', law: 'ramp',
  params: r => ({ h0: r.range(258, 266), span: r.range(-14, -8), Lmin: r.range(0.3, 0.32), Lmax: r.range(0.84, 0.86), C0: r.range(0.03, 0.04), Camp: r.range(0.1, 0.12) }),
  materials: ['ceramic'], grounds: ['bone', 'putty', 'paper'], seps: ['gap', 'fine'],
  names: ['Kiln Blue', 'Delft', 'Blue & White', 'Cobalt Glaze', 'Jingdezhen', 'Willow'],
  blurb: 'Cobalt underglaze on white porcelain, from deep wash to pale blush.' });

U({ id: 'watercolour', title: 'Watercolour', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.70, 0.73), Lamp: 0.05, Lph: 0.2, C0: r.range(0.1, 0.12), Camp: 0.02, Cph: 0.4 }),
  materials: ['watercolour'], grounds: ['paper', 'bone'], seps: ['gap', 'fine'],
  names: ['Wet on Wet', 'Field Sketch', 'Pigment Bloom', 'Plein Air', 'Wash Study', 'Rainy Studio'],
  blurb: 'Transparent washes pooling at their edges on cold-pressed paper.' });

U({ id: 'mineral', title: 'Mineral', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.56, 0.6), Lamp: r.range(0.07, 0.09), Lph: 0.2, C0: r.range(0.13, 0.155), Camp: 0.02, Cph: 0.2 }),
  materials: ['ceramic', 'satin', 'glass', 'stone'], grounds: ['ink', 'graphite', 'aubergine'], seps: ['engraved', 'gap'],
  names: ['Mineral Cabinet', 'Lapis & Garnet', 'Gem Index', 'Cut Stone', 'Malachite Hour', 'Crystal Habit'],
  blurb: 'Deep gemstone colour: garnet, citrine, peridot, lapis, amethyst.' });

U({ id: 'botanical', title: 'Botanical', law: 'arc',
  params: r => ({ h0: r.range(70, 90), span: r.range(66, 80), ph: r.range(0, TAU), L0: r.range(0.63, 0.67), Lamp: r.range(0.16, 0.19), C0: r.range(0.095, 0.115), Camp: 0.03 }),
  materials: ['matte', 'watercolour', 'velvet'], grounds: ['forest', 'paper', 'graphite'], seps: ['gap', 'fine'],
  names: ['Herbarium', 'Glasshouse', 'Pressed Flowers', 'Moss & Rose', 'Seed Head', 'Kitchen Garden'],
  blurb: 'Leaf, stem and petal: a botanist’s study in greens and pinks.' });

U({ id: 'duotone', title: 'Duotone', law: 'arc',
  params: r => { const pair = r.pick([[200, 34], [265, 75], [320, 160], [180, 350], [240, 50], [150, 20]]); return { h0: (pair[0] + pair[1]) / 2 + (Math.abs(pair[0] - pair[1]) > 180 ? 180 : 0), span: Math.min(85, Math.abs(((pair[0] - pair[1] + 540) % 360) - 180) / 2), ph: r.range(0, TAU), L0: r.range(0.64, 0.68), Lamp: r.range(0.17, 0.2), C0: r.range(0.1, 0.12), Camp: 0.035 }; },
  materials: ['print', 'matte', 'satin'], grounds: ['graphite', 'paper', 'ink'], seps: ['gap', 'fine'],
  names: ['Two Inks', 'Split Tone', 'Duotone No.', 'Positive Negative', 'Twin Pigment', 'Counterpoint'],
  blurb: 'Two inks, and every blend between them, run through light and shade.' });

U({ id: 'holo', title: 'Holographic', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: -1, L0: r.range(0.76, 0.78), Lamp: 0.05, Lph: 0.2, C0: r.range(0.11, 0.12), Camp: 0.015, Cph: 0.4 }),
  materials: ['holo', 'opal'], grounds: ['ink', 'graphite', 'aubergine'], seps: ['fine', 'gap'],
  names: ['Hologram', 'Diffraction', 'Foil Proof', 'Iridescence', 'Interference', 'Light Grating'],
  blurb: 'Diffraction foil: a rainbow that slides across the surface as you turn.' });

U({ id: 'concrete', title: 'Brutalist', law: 'ramp',
  params: r => ({ Lmin: 0.36, Lmax: r.range(0.9, 0.93), h0: r.range(40, 90), span: r.range(-20, 20), C0: 0.008, Camp: r.range(0.008, 0.016), accent: true, accentL: r.range(0.6, 0.65), accentC: r.range(0.17, 0.2), accentH: r.pick([28, 35, 255, 140]) }),
  materials: ['stone', 'matte'], grounds: ['graphite', 'slate'], seps: ['engraved', 'gap'],
  names: ['Béton Brut', 'Concrete Scale', 'Grey Matter', 'Formwork', 'Raw Grade', 'Civic Grey'],
  blurb: 'Eleven greys cast in concrete, and a single painted mark.' });

U({ id: 'retro', title: 'Retro-Futurist', law: 'arc',
  params: r => ({ h0: r.range(110, 125), span: r.range(80, 92), ph: r.range(0, TAU), L0: r.range(0.68, 0.72), Lamp: r.range(0.15, 0.18), C0: r.range(0.1, 0.12), Camp: 0.03 }),
  materials: ['satin', 'enamel', 'matte'], grounds: ['ink', 'graphite', 'oxblood'], seps: ['gap', 'engraved'],
  names: ['Space Age', 'Atomic Kitchen', 'Moonbase', 'Formica Future', 'Tomorrowland', 'Jet Set'],
  blurb: 'Tangerine, avocado and teal, as the 1960s imagined the future.' });

U({ id: 'optical', title: 'Op Art', law: 'optical',
  params: r => ({ h0: r.range(0, 360), Lhi: r.range(0.86, 0.9), Llo: r.range(0.42, 0.46), Chi: r.range(0.05, 0.07), Clo: r.range(0.12, 0.14) }),
  materials: ['matte', 'satin'], grounds: ['graphite', 'ink'], seps: ['flush', 'fine'],
  names: ['Op Art', 'Current', 'Retinal', 'Moiré Hour', 'Flicker', 'Afterimage'],
  blurb: 'High and low tones alternate so the wheel seems to vibrate.' });

U({ id: 'aurora', title: 'Aurora', law: 'arc',
  params: r => ({ h0: r.range(205, 225), span: r.range(70, 84), ph: r.range(0, TAU), L0: r.range(0.68, 0.72), Lamp: r.range(0.14, 0.17), C0: r.range(0.12, 0.14), Camp: 0.03 }),
  materials: ['glass', 'opal', 'satin'], grounds: ['ink', 'forest', 'slate'], seps: ['fine', 'gap'],
  names: ['Aurora', 'Polar Night', 'Magnetosphere', 'Solar Wind', 'Northern Field', 'Borealis'],
  blurb: 'Green into violet, like charged light over a polar sky.' });

U({ id: 'celadon', title: 'Celadon', law: 'ramp',
  params: r => ({ h0: r.range(150, 170), span: r.range(10, 22), Lmin: r.range(0.38, 0.4), Lmax: r.range(0.9, 0.92), C0: r.range(0.03, 0.04), Camp: r.range(0.06, 0.075) }),
  materials: ['ceramic', 'stone'], grounds: ['bone', 'graphite', 'umber'], seps: ['gap', 'engraved'],
  names: ['Celadon', 'Jade Glaze', 'Longquan', 'Sea Glass', 'Crackle Green', 'Tea Bowl'],
  blurb: 'Jade-green glazes, from shallow pools to deep, crazed celadon.' });

U({ id: 'cloisonne', title: 'Cloisonné', law: 'wheel',
  params: r => ({ h0: r.range(0, 360), dir: 1, L0: r.range(0.60, 0.64), Lamp: 0.07, Lph: 0.2, C0: r.range(0.13, 0.15), Camp: 0.02, Cph: 0.2 }),
  materials: ['enamel'], grounds: ['ink', 'oxblood', 'graphite'], seps: ['cloison'],
  names: ['Cloisonné', 'Enamel Cell', 'Gold Wire', 'Champlevé', 'Byzantine', 'Jewel Box'],
  blurb: 'Vitreous enamel fired between fine gold wires.' });

U({ id: 'nocturne', title: 'Nocturne', law: 'arc',
  params: r => ({ h0: r.range(268, 290), span: r.range(60, 75), ph: r.range(0, TAU), L0: r.range(0.58, 0.62), Lamp: r.range(0.17, 0.2), C0: r.range(0.1, 0.12), Camp: 0.03 }),
  materials: ['velvet', 'satin', 'glass'], grounds: ['ink', 'aubergine'], seps: ['gap', 'fine'],
  names: ['Nocturne', 'Blue Hour', 'Velvet Night', 'Indigo Hours', 'Dusk Index', 'After Dark'],
  blurb: 'Indigo, plum and midnight blue, the colours of a late evening.' });

// Hand art-directed editions (keyed by theme key) take precedence over generation.
ThemeRegistry.registerAuthored('level:1', { universe: 'prism', material: 'satin', ground: 'graphite', sep: 'gap', pattern: 'ticks', completion: 'radiance', name: 'First Light', params: { h0: 20, dir: 1, L0: 0.72, Lamp: 0.07, Lph: 0.2, C0: 0.14, Camp: 0.02, Cph: 0.2 } });
ThemeRegistry.registerAuthored('daily:1', { universe: 'prism', material: 'satin', ground: 'graphite', sep: 'gap', pattern: 'orbits', completion: 'radiance', name: 'Prime Meridian', params: { h0: 28, dir: 1, L0: 0.72, Lamp: 0.08, Lph: 0.2, C0: 0.14, Camp: 0.02, Cph: 0.2 } });

// ---- Assembly and quality control ---------------------------------------------

function buildBase(universe, params) {
  const law = PaletteLaws[universe.law];
  const base = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const lch = law(i, params);
    base.push(colour(lch[0], lch[1], lch[2]));
  }
  return base;
}

// Ring variants: same families, slightly different light and chroma, inner to outer.
function ringVariant(c, t, depth) {
  return colour(c.L + (t - 0.5) * depth.L, c.C * (1 + (t - 0.5) * depth.C), c.h + (t - 0.5) * depth.h);
}

const QC = {
  minAdjacent: 0.042,   // OKLab distance between neighbouring segments in a ring
  minPair: 0.03,      // any two families in a ring
  minBoardContrast: 0.17,
  minInkContrast: 4.5
};

function qcTheme(t) {
  const issues = [];
  for (let n = 4; n <= 6; n++) {
    const pal = t.paletteFor(n);
    for (let k = 0; k < n; k++) {
      const row = pal[k];
      for (let i = 0; i < SEGMENTS; i++) {
        if (deltaE(row[i], row[(i + 1) % SEGMENTS]) < QC.minAdjacent) { issues.push('adjacent ' + n + '/' + k + '/' + i); break; }
        for (let j = i + 2; j < SEGMENTS; j++) {
          if (deltaE(row[i], row[j]) < QC.minPair) { issues.push('pair ' + n + '/' + k + '/' + i + '-' + j); j = SEGMENTS; i = SEGMENTS; }
        }
      }
    }
  }
  let sum = 0;
  t.base.forEach(c => { sum += Math.abs(c.L - t.bg.base.L); });
  const boardContrast = sum / SEGMENTS;
  if (boardContrast < QC.minBoardContrast) issues.push('board contrast ' + boardContrast.toFixed(3));
  if (contrastRatio(t.ink, t.bg.base) < QC.minInkContrast) issues.push('ink contrast');
  if (contrastRatio(t.inkDim, t.bg.base) < 3) issues.push('dim ink contrast');
  return issues;
}

// Deterministic, non-repeating universe order. Adjacent editions never share a
// universe because the order is a fixed shuffle and we step through it.
const _universeOrder = (function () {
  const r = makeRng('orbit-universe-order-v1');
  const idx = ThemeRegistry.universes.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
  return idx;
})();

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
function universeFor(edition, stride) {
  const n = _universeOrder.length;
  // The stride must be coprime with the universe count so the walk visits every
  // universe before repeating, and consecutive editions always differ.
  while (gcd(stride, n) !== 1) stride++;
  return ThemeRegistry.universes[_universeOrder[mod(edition * stride, n)]];
}

// Build a complete theme. `key` identifies it (e.g. "daily:10", "level:7").
function createTheme(key, edition, stride) {
  const authored = ThemeRegistry.authored[key];
  let universe = authored ? ThemeRegistry.universes.find(u => u.id === authored.universe) : universeFor(edition, stride || 1);
  const rng = makeRng('orbit-theme:' + key);
  let theme = null;
  for (let attempt = 0; attempt < 24 && !theme; attempt++) {
    const r = attempt === 0 ? rng : makeRng('orbit-theme:' + key + ':' + attempt);
    const t = assemble(key, edition, universe, r, attempt === 0 ? authored : null);
    if (!qcTheme(t).length) theme = t;
  }
  if (!theme) {
    // Every universe is tested across thousands of keys (dev/test_themes.js); this
    // is a last resort that is known to pass.
    theme = assemble(key, edition, ThemeRegistry.universes[0], makeRng('orbit-safe'), ThemeRegistry.authored['level:1']);
    theme.fallback = true;
  }
  return theme;
}

function assemble(key, edition, universe, r, authored) {
  const params = authored && authored.params ? authored.params : universe.params(r);
  const base = buildBase(universe, params);
  const materialId = authored ? authored.material : r.pick(universe.materials);
  const material = ThemeRegistry.materials[materialId];
  const groundId = authored ? authored.ground : r.pick(universe.grounds);
  const g = ThemeRegistry.grounds[groundId];
  const light = !!g.light;

  // Ground colour; a whisper of the palette's mean hue in the glow behind the board.
  let ma = 0, mb = 0;
  base.forEach(c => { ma += c.lab[1]; mb += c.lab[2]; });
  const meanHue = Math.atan2(mb, ma) * 180 / Math.PI;
  const bgBase = colour(g.L, g.C, g.h);
  const bg = {
    id: groundId,
    label: g.label,
    light,
    base: bgBase,
    deep: colour(g.L + (light ? -0.06 : -0.06), g.C, g.h),
    lift: colour(g.L + (light ? 0.035 : 0.05), g.C + 0.004, g.h),
    glow: colour(light ? 0.98 : 0.62, light ? 0.02 : 0.06, meanHue),
    glowAlpha: light ? r.range(0.35, 0.5) : r.range(0.07, 0.12),
    pattern: authored ? authored.pattern : r.pick(GROUND_PATTERNS),
    grain: r.range(0.025, 0.05)
  };

  const depthL = r.range(0.045, 0.075) * (r.chance(0.5) ? 1 : -1);
  const depth = { L: depthL, C: r.range(-0.12, 0.18), h: r.range(-6, 6) };
  const sepId = authored ? authored.sep : r.pick(universe.seps);

  const ink = light ? colour(0.24, 0.015, g.h) : colour(0.94, 0.008, g.h);
  const inkDim = light ? colour(0.45, 0.012, g.h) : colour(0.70, 0.01, g.h);

  // Accent: the palette colour that reads best on the ground, for small marks.
  let accent = base[0], bestC = 0;
  base.forEach(c => { const cr = contrastRatio(c, bgBase) * (0.6 + c.C * 4); if (cr > bestC) { bestC = cr; accent = c; } });

  const lightAngle = r.range(-150, -100) * Math.PI / 180; // light from upper left

  const theme = {
    key, edition,
    universe: universe.id,
    universeTitle: universe.title,
    name: authored && authored.name ? authored.name : r.pick(universe.names),
    blurb: universe.blurb,
    base,
    material,
    bg,
    sep: Object.assign({ id: sepId }, SEPARATIONS[sepId], {
      colour: sepId === 'cloison' ? colour(0.82, 0.11, 85) : sepId === 'hairline' ? (light ? colour(0.3, 0.01, g.h) : colour(0.12, 0.01, g.h)) : bgBase
    }),
    light: { angle: lightAngle, intensity: r.range(0.75, 1) },
    completion: authored ? authored.completion : r.pick(COMPLETIONS),
    ink, inkDim, accent,
    hubTone: light ? colour(0.86, 0.01, g.h) : colour(0.26, 0.008, g.h),
    depth,
    _cache: {}
  };
  theme.description = universe.blurb + ' ' + capital(material.label) + ' on ' + g.label + '.';
  theme.paletteFor = function (n) {
    if (theme._cache[n]) return theme._cache[n];
    const rows = [];
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      rows.push(base.map(c => ringVariant(c, t, depth)));
    }
    theme._cache[n] = rows;
    return rows;
  };
  return theme;
}

function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Public entry points. Daily and study editions use different strides through the
// universe order so the two sequences rarely coincide on the same day.
const ThemeEngine = {
  forDaily(dayNumber) { return createTheme('daily:' + dayNumber, dayNumber, 1); },
  forLevel(level) { return createTheme('level:' + level, level + 3, 5); },
  forKey(key) {
    const m = /^(daily|level):(\d+)$/.exec(key);
    if (!m) return null;
    return m[1] === 'daily' ? this.forDaily(+m[2]) : this.forLevel(+m[2]);
  },
  qc: qcTheme,
  registry: ThemeRegistry
};
