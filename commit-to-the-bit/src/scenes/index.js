import Opening from './Opening/Opening.jsx';
import Scene01 from './Scene01/Scene01.jsx';
import Scene02 from './Scene02/Scene02.jsx';
import Challenge01 from './Scene02/Challenge01.jsx';
import Scene03 from './Scene03/Scene03.jsx';
import Scene04 from './Scene04/Scene04.jsx';
import Scene05 from './Scene05/Scene05.jsx';
import Scene06 from './Scene06/Scene06.jsx';
import Stub from './Stub/Stub.jsx';

const S = (index, title) => ({ Component: Stub, props: { index, title, phase: 'building' }, beats: 1 });

/**
 * Running order.
 *   beats  — presenter beats inside the screen (→ advances a beat first)
 *   enter  — transition used when arriving at this screen (mirrored going back)
 *   bg     — the colour the cover transition paints with
 *   light  — progress indicator switches to dark ink on light screens
 *   group  — which numbered screen this belongs to (for the progress dots)
 */
export const SCENES = [
  { id: 'opening', Component: Opening, beats: 1, group: 0, bg: '#061d26' },
  { id: '01', Component: Scene01, beats: 3, group: 1, bg: '#cfeee2', light: true, enter: { type: 'iris', zoom: true, origin: [960, 690], accent: '#ffc94a' } },
  { id: '02', Component: Scene02, beats: 3, group: 2, bg: '#140f3d', enter: { type: 'foliage' } },
  { id: '02c', Component: Challenge01, beats: 1, group: 2, bg: '#1d1550', enter: { type: 'iris', origin: [960, 560], accent: '#ffc94a' } },
  { id: '03', Component: Scene03, beats: 3, group: 3, bg: '#072a27', enter: { type: 'slit', accent: '#ffc94a' } },
  { id: '04', Component: Scene04, beats: 4, group: 4, bg: '#0a1430', enter: { type: 'foliage' } },
  { id: '05', Component: Scene05, beats: 2, group: 5, bg: '#efe6d2', light: true, enter: { type: 'band', origin: [960, 640] } },
  { id: '06', Component: Scene06, beats: 2, group: 6, bg: '#05242a', enter: { type: 'iris', origin: [1350, 560], accent: '#34d6c2' } },
  { id: '07', ...S('07', 'Same rules. New problems.'), group: 7, bg: '#0b1236', enter: { type: 'slit', accent: '#ffc94a' } },
  { id: '08', ...S('08', 'Four games. Four recipes.'), group: 8, bg: '#120c22', enter: { type: 'split' } },
  { id: '09', ...S('09', 'Flow'), group: 9, bg: '#08162e', enter: { type: 'dissolve' } },
  { id: '10', ...S('10', 'Connect. The. Dots.'), group: 10, bg: '#04161d', enter: { type: 'dissolve' } },
];
