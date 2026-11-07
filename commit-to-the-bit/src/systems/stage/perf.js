// Low-performance fallback.
//   ?lite        force lite mode (no WebGL motes, no grain, calmer ambient motion)
//   ?full        force full quality
//   L key        toggle at any time during the talk
export function detectLite() {
  const q = new URLSearchParams(location.search);
  if (q.has('lite')) return true;
  if (q.has('full')) return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const r = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software/i.test(r)) return true;
  } catch {
    return true;
  }
  return (navigator.hardwareConcurrency || 4) <= 2;
}
