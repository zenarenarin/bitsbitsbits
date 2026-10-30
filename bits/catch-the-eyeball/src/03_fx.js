// =====================================================================
// Pixel particles: one pooled THREE.Points draw. Each particle is a 1-3
// texel square snapped to the pixel grid, and fades out by ordered
// dithering instead of alpha blending, so effects stay crisp.
// =====================================================================

function createFx(THREE, scene) {
  const N = 480;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), al = new Float32Array(N), sz = new Float32Array(N);
  const P = [];
  for (let i = 0; i < N; i++) P.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 0, max: 1, size: 1, r: 1, gg: 1, b: 1, floor: -1e9 });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(al, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: false, depthTest: false, depthWrite: false,
    vertexShader: `
      attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vColor = aColor; vAlpha = aAlpha;
        vec3 p = position;
        p.xy = floor(p.xy) + (mod(aSize, 2.0) > 0.5 ? 0.5 : 0.0);
        gl_PointSize = aSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vAlpha;
      float bayer4(vec2 p) {
        vec2 q = mod(floor(p), 4.0);
        int i = int(q.y * 4.0 + q.x);
        float m[16];
        m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
        m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
        for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
        return 0.5;
      }
      void main() {
        if (vAlpha < bayer4(gl_FragCoord.xy)) discard;
        gl_FragColor = vec4(vColor, 1.0);
      }`
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 50; pts.position.z = 5;
  scene.add(pts);
  let cursor = 0;

  function emit(x, y, o) {
    let p = null;
    for (let k = 0; k < N; k++) { const q = P[(cursor + k) % N]; if (!q.on) { p = q; cursor = (cursor + k + 1) % N; break; } }
    if (!p) { p = P[cursor]; cursor = (cursor + 1) % N; }
    const a = o.angle !== undefined ? o.angle + (Math.random() - 0.5) * (o.spread || TAU) : Math.random() * TAU;
    const sp = (o.speed || 40) * (0.4 + Math.random() * 0.8);
    p.on = true; p.x = x + (Math.random() - 0.5) * (o.jitter || 0); p.y = y + (Math.random() - 0.5) * (o.jitter || 0);
    p.vx = Math.cos(a) * sp + (o.vx || 0); p.vy = Math.sin(a) * sp + (o.vy || 0);
    p.g = o.g === undefined ? -160 : o.g; p.drag = o.drag || 0;
    p.max = p.life = (o.life || 0.6) * (0.6 + Math.random() * 0.6);
    p.size = o.sizes ? o.sizes[(Math.random() * o.sizes.length) | 0] : (o.size || 1);
    const c = o.colors ? o.colors[(Math.random() * o.colors.length) | 0] : (o.color || '#ffffff');
    const [r, g, b] = rgbOf(c); p.r = r / 255; p.gg = g / 255; p.b = b / 255;
    p.floor = o.floor === undefined ? -1e9 : o.floor;
    return p;
  }

  return {
    burst(x, y, n, o) { for (let i = 0; i < n; i++) emit(x, y, o); },
    update(dt) {
      let n = 0;
      for (let i = 0; i < N; i++) {
        const p = P[i];
        if (!p.on) continue;
        p.life -= dt;
        if (p.life <= 0) { p.on = false; continue; }
        p.vy += p.g * dt;
        if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y < p.floor) { p.y = p.floor; p.vy = -p.vy * 0.3; p.vx *= 0.6; }
        pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = 0;
        col[n * 3] = p.r; col[n * 3 + 1] = p.gg; col[n * 3 + 2] = p.b;
        al[n] = Math.min(1, (p.life / p.max) * 1.6); sz[n] = p.size;
        n++;
      }
      geo.setDrawRange(0, n);
      for (const k of ['position', 'aColor', 'aAlpha', 'aSize']) geo.attributes[k].needsUpdate = true;
    },
    clear() { for (const p of P) p.on = false; }
  };
}
