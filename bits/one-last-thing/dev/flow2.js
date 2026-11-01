// Finish drawer 1 with real input: vase (tip+turn), notebook, cup; then the result card.
const open = require('./shot');
const out = process.argv[2] || '.';
(async () => {
  const { page, logs, close } = await open({ query: '' });
  await page.waitForTimeout(1000);
  const L = await page.evaluate(() => ({ slot: __olt.view.tray.slotPx, tr: __olt.view.view.trayRect }));
  const ty = L.tr.y + L.tr.h * 0.55;
  const drag = async (x0, y0, x1, y1, steps = 14) => { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await page.waitForTimeout(16); } await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(900); };
  const st = () => page.evaluate(() => ({ held: __olt.S.held && __olt.S.held.obj.def.id, ok: __olt.S.held && __olt.S.held.res && __olt.S.held.res.ok, placed: __olt.S.objs.filter(o => o.state === 'placed').map(o => o.def.id).join(','), done: __olt.S.done, toast: document.querySelector('.olt-toast').textContent }));
  // where to drop: project drawer-space points to the screen
  const scr = (x, z, y) => page.evaluate(([x, z, y]) => __olt.view.project([x, y, z]), [x, z, y]);
  await page.mouse.click(L.slot / 2, ty); await page.waitForTimeout(300);           // pick the vase
  await page.click('.olt-tip'); await page.waitForTimeout(250); await page.click('.olt-turn'); await page.waitForTimeout(250);
  let [sx, sy] = await scr(-2.5, -1.5, 8);
  await drag(201, 330, sx, sy); console.log('vase', JSON.stringify(await st()));
  await page.mouse.click(L.slot * 1.5, ty); await page.waitForTimeout(300);          // notebook
  [sx, sy] = await scr(5.5, 0, 8);
  await drag(201, 330, sx, sy); console.log('notebook', JSON.stringify(await st()));
  await page.mouse.click(L.slot / 2, ty); await page.waitForTimeout(300);             // cup
  [sx, sy] = await scr(-4, 3.8, 8);
  await drag(201, 330, sx, sy); console.log('cup', JSON.stringify(await st()));
  if (!(await st()).done) { await page.screenshot({ path: `${out}/f-stuck.png` }); }
  await page.waitForTimeout(800); await page.screenshot({ path: `${out}/f-admire.png` });
  await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/f-result.png` });
  console.log(JSON.stringify(await page.evaluate(() => window.__events)));
  console.log(logs.join('\n'));
  await close();
})();
