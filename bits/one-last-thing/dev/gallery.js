// Lay every catalogue object out in one big drawer for art review. usage: node dev/gallery.js out.png [ids,comma]
const open = require('./shot');
(async () => {
  const { page, logs, close } = await open({ query: '', dpr: 2 });
  await page.waitForTimeout(800);
  await page.evaluate((ids) => {
    const { Catalog, World } = __olt;
    const list = ids ? ids.split(',') : Catalog.list.map(d => d.id);
    const cols = Math.ceil(Math.sqrt(list.length * 0.7)), rows = Math.ceil(list.length / cols);
    const W = cols * 12.5, D = rows * 12.5;
    __olt.loadLevel({ index: 0, name: 'Gallery', W, D, H: 16, items: list.map(id => ({ id })), solution: [] });
    __olt.S.objs.forEach((o, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      World.setPose(o.body, [0, 0, 0], [0, 0, 0, 1]);
      const b = o.body.box;
      const p = [-W / 2 + 6.25 + c * 12.5 - (b[0] + b[3]) / 2, -b[1] + 0.01, -D / 2 + 6.25 + r * 12.5 - (b[2] + b[5]) / 2];
      __olt.setState(o, 'placed', { p, q: [0, 0, 0, 1] });
    });
    __olt.S.done = true;
  }, process.argv[3] || '');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector('.olt').style.display = 'none'; const v = __olt.view; v.layout(402, 874, { x: 0, y: 0, w: 402, h: 874 }, { x: 0, y: 874, w: 402, h: 0 }); v.orbit.polT = v.orbit.pol = 0.5; v.orbit.azT = v.orbit.az = 0.25; v.fitCamera(); v.orbit.dist = v.orbit.distT; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: process.argv[2] });
  console.log(logs.join('\n'));
  await close();
})();
