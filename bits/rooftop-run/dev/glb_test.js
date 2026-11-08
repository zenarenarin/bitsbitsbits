// Pipeline check for a Blender GLB in the real runtime (three.js 0.164.1, no
// GLTFLoader): parse, skeleton, skinning, clip playback, cross-fade blending,
// materials, scale/orientation, and a frame-time sample.
// Usage: (serve on :8765) node dev/glb_test.js <glb path under dev/> <out.png> [clipA] [clipB]
const { chromium } = require('playwright');
const [glbPath, outPng, clipA, clipB] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 640, height: 480 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8765/dev/index.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  const r = await page.evaluate(async ({ glbPath, clipA, clipB }) => {
    const rr = window.__rr, THREE = rr.THREE, out = {};
    const buf = new Uint8Array(await (await fetch('/dev/' + glbPath)).arrayBuffer());
    const t0 = performance.now(); const g = rr.glb.readGLB(THREE, buf); out.parseMs = +(performance.now() - t0).toFixed(1);
    out.clips = g.animations.map(c => `${c.name} ${c.duration.toFixed(2)}s ${c.tracks.length} tracks`);
    out.meshes = g.meshes.map(m => `${m.name}: ${m.isSkinnedMesh ? 'skinned' : 'static'}, ${m.geometry.attributes.position.count} verts, ${m.geometry.index ? m.geometry.index.count / 3 : 0} tris, mat ${m.material.name} ${'#' + m.material.color.getHexString()} emissive #${m.material.emissive.getHexString()}`);
    const sk = g.meshes.find(m => m.isSkinnedMesh); out.bones = sk ? sk.skeleton.bones.length : 0;
    const box = new THREE.Box3().setFromObject(g.scene); out.size = box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)); out.min = box.min.toArray().map(v => +v.toFixed(3));
    // playback and blending
    const mixer = new THREE.AnimationMixer(g.scene);
    const A = mixer.clipAction(g.animations.find(c => c.name === clipA) || g.animations[0]).play();
    const tip = sk.skeleton.bones[sk.skeleton.bones.length - 1], p = new THREE.Vector3();
    const tipAt = () => { g.scene.updateMatrixWorld(true); return tip.getWorldPosition(p).toArray().map(v => +v.toFixed(3)); };
    out.tipRest = tipAt(); mixer.update(0.25); out.tipA = tipAt();
    if (clipB) { const B = mixer.clipAction(g.animations.find(c => c.name === clipB)); B.reset().play(); A.crossFadeTo(B, 0.5, false); mixer.update(0.25); out.tipBlend = tipAt(); out.weights = [A.getEffectiveWeight(), B.getEffectiveWeight()].map(v => +v.toFixed(2)); mixer.update(0.5); out.tipB = tipAt(); }
    // skinning really deforms: compare a skinned vertex at rest and posed
    const v0 = new THREE.Vector3().fromBufferAttribute(sk.geometry.attributes.position, sk.geometry.attributes.position.count - 1);
    const posed = sk.applyBoneTransform(sk.geometry.attributes.position.count - 1, v0.clone());
    out.vertexMoved = +posed.distanceTo(v0).toFixed(3);
    // render it in the game scene beside the cat, and time frames
    const holder = new THREE.Group(); holder.add(g.scene); rr.scene.add(holder);
    const c = rr.cat.pos; holder.position.set(c[0] + 0.5, c[1], c[2] - 1);
    rr.freeze(true); rr.frame();
    rr.camera.position.set(c[0] + 0.3, c[1] + 0.5, c[2] + 0.6); rr.camera.lookAt(c[0] + 0.3, c[1] + 0.25, c[2] - 0.6); rr.camera.clearViewOffset(); rr.camera.fov = 50; rr.camera.updateProjectionMatrix();
    const t1 = performance.now(); for (let i = 0; i < 20; i++) { mixer.update(1 / 60); rr.renderer.render(rr.scene, rr.camera); } out.frameMs = +((performance.now() - t1) / 20).toFixed(1);
    out.calls = rr.renderer.info.render.calls;
    window.__mixer = mixer;
    return out;
  }, { glbPath, clipA, clipB });
  await page.screenshot({ path: outPng });
  console.log(JSON.stringify(r, null, 1));
  console.log('errors', JSON.stringify(errs));
  await browser.close();
})();
