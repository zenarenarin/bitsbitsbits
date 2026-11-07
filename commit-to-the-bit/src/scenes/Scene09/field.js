import * as THREE from 'three';

/* The challenge / skill field as a live shader.
   x = skill, y = challenge.
   Above the diagonal the field churns hot and jagged (frustration);
   below it lies flat, cold and still (boredom); along it runs a luminous
   channel that streams forward (flow). */

const frag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uPoint;
uniform float uWidth;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=.5; } return v; }

void main(){
  vec2 uv = vUv;
  float skill = uv.x, challenge = uv.y;
  float d = challenge - skill;              // >0 too hard, <0 too easy
  float along = (uv.x + uv.y) * 0.7071;     // position along the channel
  float w = uWidth;

  // flow: streaming lines that run up the diagonal
  float stream = sin(along * 70. - uTime * 3.2 + sin(d * 40.) * 0.6);
  stream = smoothstep(0.65, 1.0, stream);
  float core = exp(-pow(d / (w * 0.55), 2.));
  vec3 flowCol = mix(vec3(0.06, 0.32, 0.36), vec3(0.20, 0.84, 0.76), core);
  flowCol = mix(flowCol, vec3(1.0, 0.84, 0.48), stream * core * 0.85);

  // frustration: turbulent, hot, getting more violent the further you go
  float k = clamp((d - w) * 2.2, 0., 1.);
  vec2 q = uv * 7. + vec2(uTime * 0.9, -uTime * 1.3);
  float n = fbm(q + fbm(q * 1.7 + uTime));
  float jag = abs(fract(n * 6. + uTime * 0.6) - .5) * 2.;
  vec3 hot = mix(vec3(0.33, 0.07, 0.15), vec3(1.0, 0.42, 0.33), smoothstep(.35, .95, n) * (0.5 + k));
  hot += vec3(1.0, 0.6, 0.3) * smoothstep(0.92, 1., jag) * 0.35 * (0.4 + k);

  // boredom: flat horizontal bands that barely move
  float c = clamp((-d - w) * 2.2, 0., 1.);
  float bands = smoothstep(0.48, 0.5, abs(fract(uv.y * 26. + uTime * 0.03) - .5));
  vec3 cold = mix(vec3(0.09, 0.13, 0.22), vec3(0.16, 0.21, 0.31), bands * (1. - c * 0.6));

  // blend the three regions across the channel edges
  float toHot = smoothstep(w * 0.7, w * 1.25, d);
  float toCold = smoothstep(w * 0.7, w * 1.25, -d);
  vec3 col = flowCol;
  col = mix(col, hot, toHot);
  col = mix(col, cold, toCold);

  // channel edges
  float edge = exp(-pow((abs(d) - w) / 0.004, 2.));
  col += vec3(0.95, 0.92, 0.82) * edge * 0.35;

  // where the player is: a soft pool of light
  float pd = length(uv - uPoint);
  col += vec3(1.0, 0.55, 0.42) * exp(-pd * pd * 90.) * 0.35;

  // vignette into the page
  float vig = smoothstep(0.0, 0.08, uv.x) * smoothstep(0.0, 0.08, uv.y) * smoothstep(1.0, 0.92, uv.x) * smoothstep(1.0, 0.92, uv.y);
  col = mix(vec3(0.03, 0.07, 0.15), col, 0.25 + vig * 0.75);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createField(host, size) {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.setSize(size, size, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = { uTime: { value: 0 }, uPoint: { value: new THREE.Vector2(0.5, 0.5) }, uWidth: { value: 0.11 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }',
    fragmentShader: frag,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  let raf;
  const t0 = performance.now();
  const tick = () => {
    uniforms.uTime.value = (performance.now() - t0) / 1000;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return {
    point(x, y) {
      uniforms.uPoint.value.set(x, y);
    },
    dispose() {
      cancelAnimationFrame(raf);
      mat.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    },
  };
}
