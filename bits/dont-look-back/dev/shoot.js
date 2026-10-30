// Headless playtest: title, run, hide, catch. Usage: node dev/shoot.js <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = process.argv[2] || path.join(root, 'shots');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(8766);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.stack));
  await p.goto('http://localhost:8766/dev/index.html');
  const ev = (f, a) => p.evaluate(f, a);
  await p.waitForFunction(() => window.__dlb || window.__initError, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: out + '/01_title.png' });
    await ev(() => { window.__dlbManual = true; __dlb.begin(true); __dlb.advance(1.6, true, true); });
  await ev(() => window.__dlb && __dlb.frame(1)); await p.screenshot({ path: out + '/02_start.png' });
  await ev(() => __dlb.advance(4, true, true));
  await p.waitForTimeout(300);
  await ev(() => window.__dlb && __dlb.frame(1)); await p.screenshot({ path: out + '/03_run.png' });
  // run until cover is in reach, then let go
  const info = await ev(() => { for (let i = 0; i < 600; i++) { __dlb.advance(1 / 30, true, true); if (__dlb.W.coverNear(__dlb.run.s, __dlb.run.u)) break; } return { s: __dlb.run.s, gap: __dlb.run.M.gap, st: __dlb.run.stamina, mode: __dlb.run.M.mode }; });
  console.log('cover', JSON.stringify(info));
  await p.waitForTimeout(200);
  await ev(() => window.__dlb && __dlb.frame(1)); await p.screenshot({ path: out + '/04_cover.png' });
  await ev(() => __dlb.advance(0.6, false, true));
  await p.waitForTimeout(400);
  await ev(() => window.__dlb && __dlb.frame(1)); await p.screenshot({ path: out + '/05_hide.png' });
  // wait for the follower to arrive
  const pass = await ev(() => { const log = []; for (let i = 0; i < 400; i++) { __dlb.advance(1 / 30, false, true); const M = __dlb.run.M; if (i % 15 === 0) log.push(M.mode + ':' + M.gap.toFixed(1) + ':' + __dlb.run.hideT.toFixed(1)); if (M.mode === 'pass' && M.gap < 0.5) break; } __dlb.frame(60); return log.join(' '); });
  console.log('approach', pass);
  await p.waitForTimeout(300);
  await ev(() => window.__dlb && __dlb.frame(1)); await p.screenshot({ path: out + '/06_pass.png' });
  const after = await ev(() => { const log = []; for (let i = 0; i < 300; i++) { __dlb.advance(1 / 30, false, true); const M = __dlb.run.M; if (i % 15 === 0) log.push(M.mode + ':' + M.gap.toFixed(1)); if (M.mode === 'lost') break; } return log.join(' ') + ' stamina ' + __dlb.run.stamina.toFixed(0) + ' mode ' + __dlb.mode; });
  console.log('after', after);
  await ev(() => __dlb.advance(1, true, true));
  await p.waitForTimeout(300);
  await ev(() => window.__dlb && __dlb.frame(1)); await p.screenshot({ path: out + '/07_resume.png' });
  // a long run just holding: should eventually be caught
  const longRun = await ev(() => { let t = 0; const log = []; while (__dlb.mode === 'play' && t < 120) { __dlb.advance(0.5, true, true); t += 0.5; if (t % 3 === 0) log.push(`${t}s s=${__dlb.run.s.toFixed(0)} st=${__dlb.run.stamina.toFixed(0)} ${__dlb.run.M.mode}:${__dlb.run.M.gap.toFixed(1)} ${__dlb.run.state}`); } return log.join('\n'); });
  console.log(longRun);
  await ev(() => __dlb.advance(0.7, null, true));
  await ev(() => window.__dlb && __dlb.frame(1)); await p.screenshot({ path: out + '/08_catch.png' });
  await ev(() => { window.__dlbManual = false; });
  await p.waitForTimeout(4000);
  await ev(() => window.__dlb && __dlb.frame(1)); await p.screenshot({ path: out + '/09_over.png' });
  console.log('mode', await ev(() => __dlb.mode), 'init error', await ev(() => window.__initError || null));
  console.log('errors', errs.slice(0, 15).join('\n'));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
