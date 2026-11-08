// Installs the route pilots into the page: window.__pilot(cat, hazards) drives
// the high road (all fragments) through every section; window.__route(name)
// switches route. Sections repeat, so the pilot works in section-local z.
const { source } = require('./routes.js');
module.exports = `(() => {
  const make = ${source}();
  let route = 'high';
  window.__route = r => { route = r; };
  window.__pilot = (c, hz) => {
    const run = window.__rr.run, s = run.sectionAt(c.pos[2]) || run.sections[0];
    return make(route)({ pos: [c.pos[0], c.pos[1], c.pos[2] - s.z0], fwd: c.fwd }, hz, window.__rr.TUNING);
  };
})();`;
