const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  const r = await page.evaluate(() => {
    const u = window.__unmake; u.save().runs = 5; u.begin();
    // jump the player to the first root segment's gap edge
    let s = null; for (let i = 0; i < 40 && !s; i++) { s = u.run.segs.find(q => q.name === 'root'); if (!s) { u.run.player.pos[2] -= 30; u.step(1/60); } }
    if (!s) return 'no root';
    const pl = u.run.player; pl.pos = [s.meta.origin[0], s.meta.origin[1] + 0.05, s.z0 - 6.2]; pl.vel = [0,0,0];
    u.input.virtual = { steer: 0, pace: -1 };
    for (let i = 0; i < 30; i++) u.step(1/60);
    u.frame(); u.frame();
    const cam = u.camera.position, T = window.__ctx;
    const ray = new (u.camera.constructor.prototype.constructor === undefined ? Object : Object)();
    // which meshes cover the screen centre-left?
    const THREEray = u.scene.children; const hits = [];
    const R = new (u.renderer.constructor === undefined ? Object : Object)();
    return { cam: [cam.x, cam.y, cam.z].map(v => +v.toFixed(2)), pl: pl.pos.map(v => +v.toFixed(2)), seg: [s.z0, s.z1] };
  });
  console.log(JSON.stringify(r));
  await page.screenshot({ path: process.argv[2] + '/probe_root.png' });
  // find what's under a few screen points using three's raycaster through a module import
  const hits = await page.evaluate(async () => {
    const THREE = await import('./vendor/three.module.js');
    const u = window.__unmake, rc = new THREE.Raycaster(), out = [];
    for (const [x, y] of [[0.3, 0.5], [0, 0], [0.4, 0.2]]) {
      rc.setFromCamera(new THREE.Vector2(-0.4 + x, y), u.camera);
      const h = rc.intersectObjects(u.scene.children, true).filter(h => h.object.visible && h.object.type === 'Mesh')[0];
      if (h) { let o = h.object, path = []; while (o) { path.push((o.userData && o.userData.body ? 'BODY:' + o.userData.body.style : o.type) ); o = o.parent; } out.push({ d: +h.distance.toFixed(1), path: path.slice(0, 4).join('<'), pt: [h.point.x, h.point.y, h.point.z].map(v => +v.toFixed(1)) }); }
    }
    return out;
  });
  console.log(JSON.stringify(hits, null, 1));
  await browser.close();
})();
