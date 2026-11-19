// Load the pure simulation sources (00..03) into Node for tests.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(dir).filter(f => /^0[0-4]_.*\.js$/.test(f)).sort();
const body = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const names = ['sysPier','PHYS','BOT','makeRng','hashStr','makeWorld','makePlayer','playerStep','cloneP','expandSurface','expandHandle','botSolve','buildRoute','buildRouteSteps','routePlan','ROUTES','REGIONS','dailyRouteSpec','respawnPlayer','surfPoint','validateModule','GENS'];
module.exports = new Function(body + '\nreturn {' + names.join(',') + '};')();
