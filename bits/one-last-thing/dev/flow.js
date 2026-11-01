// Drive the first drawer with real pointer input and capture each beat.
const open = require('./shot');
const out = process.argv[2] || '.';
(async () => {
  const { page, logs, close } = await open({ query: '' });
  await page.waitForTimeout(1200);
  const L = await page.evaluate(() => ({ trayTop: __olt.L.trayTop, rowTop: __olt.L.rowTop, slot: __olt.view.tray.slotPx, tr: __olt.view.view.trayRect }));
  const ty = L.tr.y + L.tr.h * 0.55;
  const snap = async n => { await page.screenshot({ path: `${out}/${n}.png` }); };
  const drag = async (x0, y0, x1, y1, steps = 14) => { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await page.waitForTimeout(16); } };
  const state = () => page.evaluate(() => ({ held: __olt.S.held && __olt.S.held.obj.def.id, res: __olt.S.held && __olt.S.held.res && { ok: __olt.S.held.res.ok, reason: __olt.S.held.res.reason }, placed: __olt.S.objs.filter(o => o.state === 'placed').map(o => o.def.id), toast: document.querySelector('.olt-toast').textContent }));
  // 1. drag the vase (slot 0) up into the drawer, still upright
  await drag(L.slot / 2, ty, 150, 330);
  await page.waitForTimeout(300); await snap('1-dragging');
  console.log('dragging', JSON.stringify(await state()));
  await page.mouse.up(); await page.waitForTimeout(400); await snap('2-rejected');
  console.log('after release', JSON.stringify(await state()));
  // 2. tip it with the TIP button, then place
  await page.click('.olt-tip'); await page.waitForTimeout(500); await snap('3-tipped');
  console.log('tipped', JSON.stringify(await state()));
  await page.click('.olt-place'); await page.waitForTimeout(500); await snap('4-front');
  await page.click('.olt-turn'); await page.waitForTimeout(400);
  console.log('turned', JSON.stringify(await state()));
  await page.click('.olt-place'); await page.waitForTimeout(1200); await snap('4-placed');
  console.log('placed', JSON.stringify(await state()));
  // 3. tap the notebook on the shelf to inspect, then drag it in
  const slots = await page.evaluate(() => __olt.S.objs.filter(o => o.state === 'tray').map(o => o.def.id));
  console.log('shelf', slots);
  await page.mouse.click(L.slot * 1.5, ty); await page.waitForTimeout(500); await snap('5-inspect');
  console.log('inspect', JSON.stringify(await state()));
  await drag(201, 330, 260, 300); await page.waitForTimeout(250); await snap('6-moving');
  console.log('moving', JSON.stringify(await state()));
  await page.mouse.up(); await page.waitForTimeout(900); await snap('7-after');
  console.log('after', JSON.stringify(await state()));
  console.log(logs.join('\n'));
  await close();
})();
