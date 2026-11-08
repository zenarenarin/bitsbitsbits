// Contact sheet of a cat GLB in the game's renderer: each clip sampled at a
// few moments, side-on, above the city. Usage: node dev/cat_view.js <glb under dev/> <outdir> [clips...]
const { chromium } = require('playwright');
const [glbPath, out, ...want] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 360, height: 270 } })).newPage();
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  const clips = await page.evaluate(async (glbPath) => {
    document.querySelector('.rr').style.display = 'none';
    for (const d of document.body.children) if (d.style && d.style.zIndex === '99') d.style.display = 'none';
    const rr = window.__rr, THREE = rr.THREE;
    const g = rr.glb.readGLB(THREE, new Uint8Array(await (await fetch('/dev/' + glbPath)).arrayBuffer()));
    const holder = new THREE.Group(); holder.add(g.scene); holder.position.set(0, 40, 0); rr.scene.add(holder);
    g.scene.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshLambertMaterial({ color: '#8a8278' })); floor.rotation.x = -Math.PI / 2; holder.add(floor);
    window.__g = g; window.__mixer = new THREE.AnimationMixer(g.scene); window.__holder = holder;
    rr.freeze(true);
    return g.animations.map(c => c.name + ':' + c.duration.toFixed(2));
  }, glbPath);
  console.log(clips.join(' '));
  for (const name of (want.length ? want : clips.map(c => c.split(':')[0]))) {
    for (const k of [0, 0.25, 0.5, 0.75]) {
      for (const view of ['side', 'back']) {
        await page.evaluate(({ name, k, view }) => {
          const rr = window.__rr, g = window.__g, m = window.__mixer;
          m.stopAllAction(); const clip = g.animations.find(c => c.name === name); const a = m.clipAction(clip); a.reset().play(); a.time = clip.duration * k; m.update(0);
          const h = window.__holder.position;
          if (view === 'side') rr.camera.position.set(h.x + 1.1, h.y + 0.3, h.z - 0.05); else rr.camera.position.set(h.x + 0.35, h.y + 0.55, h.z + 0.9);
          rr.camera.lookAt(h.x, h.y + 0.2, h.z - 0.05); rr.camera.fov = 30; rr.camera.clearViewOffset(); rr.camera.updateProjectionMatrix();
          rr.renderer.render(rr.scene, rr.camera);
        }, { name, k, view });
        await page.screenshot({ path: `${out}/${name}-${view}-${k}.png` });
      }
    }
  }
  await browser.close();
})();
