// Endless drawer generation through the real game path, and Beat the Clock.
const open = require('./shot');
(async () => {
  const { page, logs, close } = await open({ query: '' });
  await page.waitForTimeout(800);
  let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  const t0 = Date.now();
  await page.evaluate(() => __olt.goLevel(12));
  ok(await page.evaluate(() => document.querySelector('.olt-preparing').classList.contains('on')), 'endless: "finding a drawer" note while generating');
  await page.waitForFunction(() => __olt.S.index === 12, null, { timeout: 60000 }).catch(() => {});
  const st = await page.evaluate(() => ({ i: __olt.S.index, n: __olt.S.objs.length, name: __olt.S.lv.name, v: __olt.Packer.verify(__olt.S.lv).ok, W: __olt.S.lv.W, D: __olt.S.lv.D, H: __olt.S.lv.H }));
  ok(st.i === 12 && st.v, `endless drawer loaded in ${Date.now() - t0} ms: ${st.name}, ${st.n} objects, ${st.W} x ${st.D} x ${st.H}, verified ${st.v}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: process.argv[2] + '/endless.png' });
  // next endless prepared in the background while playing
  await page.waitForFunction(() => __olt.S.next && __olt.S.nextFor === 13, null, { timeout: 60000 }).catch(() => {});
  ok(await page.evaluate(() => !!__olt.S.next && __olt.S.nextFor === 13), 'the following endless drawer is prepared in the background');
  // beat the clock
  await page.click('.olt-menu-btn'); await page.waitForTimeout(300); await page.click('.olt-mode'); await page.waitForTimeout(400);
  const ck = await page.evaluate(() => ({ lim: __olt.S.clockLimit, mode: document.querySelector('.olt-mode b').textContent }));
  ok(ck.lim > 0, 'beat the clock gives a time limit of ' + ck.lim + ' s');
  await page.evaluate(() => { __olt.S.started = true; __olt.S.elapsed = __olt.S.clockLimit - 0.2; });
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => __olt.S.failed && document.querySelector('.olt-result').classList.contains('on') && /Time/.test(document.querySelector('.olt-r-title').textContent)), 'running out of time shows the time-up card');
  await page.screenshot({ path: process.argv[2] + '/clock.png' });
  ok(!logs.some(l => /error/i.test(l)), 'no console errors ' + logs.filter(l => /error/i.test(l)).join('|'));
  console.log(fails ? fails + ' FAILED' : 'modes ok');
  await close(); process.exit(fails ? 1 : 0);
})();
