// Installs the route pilots into the page: window.__pilot(cat, hazards) drives
// the high road (all five fragments); window.__route(name) switches route.
const { source } = require('./routes.js');
module.exports = `(() => {
  const make = ${source}();
  let route = 'high';
  window.__route = r => { route = r; };
  window.__pilot = (c, hz) => make(route)(c, hz, window.__rr.TUNING);
})();`;
