// Shared helpers: open the harness and drive the real controller with scripted input.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
async function open(opts = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: opts.w || 402, height: opts.h || 874 }, deviceScaleFactor: opts.dpr || 1 });
  const errs = []; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
  await page.goto('http://localhost:8766/dev/index.html' + (opts.query || ''));
  await page.waitForFunction(() => window.__ready || window.__initError, null, { timeout: 30000 });
  await page.evaluate(require('fs').readFileSync(__dirname + '/sim_inject.js', 'utf8'));
  return { browser, page, errs };
}
module.exports = { open };
