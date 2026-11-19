const fs = require('fs'), path = require('path');
module.exports = i => new Function(fs.readFileSync(path.join(__dirname, '..', 'src', '04_plans.js'), 'utf8') + '\nreturn ROUTE_PLANS;')()[i];
