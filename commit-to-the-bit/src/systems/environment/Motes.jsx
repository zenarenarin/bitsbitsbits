import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { toStage } from '../stage/Stage.jsx';

/**
 * Drifting light motes in real depth (Three.js). Spores, fireflies, dust in
 * the light shafts. Sits between the background paint and the foreground
 * foliage; parallaxes with the pointer. Skipped entirely in lite mode.
 */
export function Motes({ count = 140, colors = ['#8ff7dc', '#ffc94a'], size = 34, speed = 1, lite = false, style, depth = 1, region }) {
  const ref = useRef(null);
  useEffect(() => {
    if (lite) return;
    const host = ref.current;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(1920, 1080, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1920 / 1080, 1, 100);
    camera.position.z = 20;

    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const col = new Float32Array(count * 3);
    const palette = colors.map((c) => new THREE.Color(c));
    const r = region || { x: 22, y: 12 };
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * r.x * 2;
      pos[i * 3 + 1] = (Math.random() - 0.5) * r.y * 2;
      pos[i * 3 + 2] = -Math.random() * 30 * depth + 6;
      seed[i] = Math.random() * 100;
      const c = palette[i % palette.length];
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: { uTime: { value: 0 }, uSize: { value: size }, uSpeed: { value: speed } },
      vertexShader: /* glsl */ `
        attribute float seed;
        varying vec3 vColor;
        varying float vTw;
        varying float vFog;
        uniform float uTime; uniform float uSize; uniform float uSpeed;
        void main(){
          vec3 p = position;
          float t = uTime * uSpeed;
          p.x += sin(t*0.21 + seed)*1.2 + sin(t*0.07 + seed*2.)*2.;
          p.y += mod(t*0.25 + seed*3.1, 24.) - 12. + sin(t*0.5+seed)*0.4;
          vec4 mv = modelViewMatrix * vec4(p,1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (0.6 + fract(seed*7.3)) * (12. / -mv.z);
          vTw = 0.55 + 0.45*sin(uTime*(1.2+fract(seed)*2.) + seed*10.);
          vFog = clamp(1.0 - (-mv.z - 8.) / 40., 0.15, 1.);
          vColor = color;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vTw; varying float vFog;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          a = a*a*0.75 + smoothstep(0.12, 0.0, d)*0.6;
          gl_FragColor = vec4(vColor, a * vTw * vFog);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);

    let tx = 0;
    let ty = 0;
    const onMove = (e) => {
      const p = toStage(e);
      tx = (p.x / 1920 - 0.5) * 1.6;
      ty = (p.y / 1080 - 0.5) * 0.9;
    };
    window.addEventListener('pointermove', onMove);

    let raf;
    const clock = new THREE.Clock();
    const tick = () => {
      mat.uniforms.uTime.value = clock.getElapsedTime() + 40;
      camera.position.x += (tx - camera.position.x) * 0.03;
      camera.position.y += (-ty - camera.position.y) * 0.03;
      camera.lookAt(0, 0, -10);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lite]);
  return <div ref={ref} className="layer motes" style={style} />;
}
