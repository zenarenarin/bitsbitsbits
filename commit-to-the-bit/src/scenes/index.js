import Opening from './Opening/Opening.jsx';
import Scene01 from './Scene01/Scene01.jsx';
import Scene02 from './Scene02/Scene02.jsx';
import Challenge01 from './Scene02/Challenge01.jsx';
import Scene03 from './Scene03/Scene03.jsx';
import Stub from './Stub/Stub.jsx';
import { upcoming } from '../content/deck.js';

/**
 * Running order.
 *   beats      — presenter beats inside the screen (→ advances a beat first)
 *   enter      — transition used when arriving at this screen
 *   bg         — the colour the cover transition paints with
 *   light      — progress indicator switches to dark ink on light screens
 *   group      — which numbered screen this belongs to (for the progress dots)
 */
export const SCENES = [
  { id: 'opening', Component: Opening, beats: 1, group: 0, bg: '#061d26', label: 'Commit to the Bit' },
  { id: '01', Component: Scene01, beats: 3, group: 1, bg: '#cfeee2', light: true, label: 'Why play?', enter: { type: 'iris', zoom: true, origin: [960, 690], accent: '#ffc94a' } },
  { id: '02', Component: Scene02, beats: 3, group: 2, bg: '#140f3d', label: 'Connecting dots', enter: { type: 'foliage' } },
  { id: '02c', Component: Challenge01, beats: 1, group: 2, bg: '#1d1550', label: 'Challenge · Make the connection', enter: { type: 'iris', accent: '#ffc94a' } },
  { id: '03', Component: Scene03, beats: 3, group: 3, bg: '#072a27', label: 'The joy of trying again', enter: { type: 'slit', accent: '#ffc94a' } },
  ...upcoming.map((u, i) => ({
    id: u.index,
    Component: Stub,
    props: u,
    beats: 1,
    group: 4 + i,
    bg: '#061d26',
    label: u.title,
    enter: { type: i % 2 ? 'slit' : 'foliage', accent: '#ff6a55' },
  })),
];

export const GROUPS = 11;
