// Measures real frame rate in real-time mode while beats are playing.
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
let pw
try { pw = require('playwright') } catch { pw = require('/opt/node-tools/node_modules/playwright') }
const [url, q = 'high', w = '1920'] = process.argv.slice(2)
const args = process.env.GPU ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
const b = await pw.chromium.launch({ args })
const width = parseInt(w, 10)
const p = await b.newPage({ viewport: { width, height: Math.round((width * 9) / 16) } })
await p.goto(`${url}${q === 'low' ? '?q=low' : ''}`)
await p.waitForFunction(() => window.__aop && window.__aop.ready, null, { timeout: 60000 })
const gl = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown' })
const sample = async (label, ms) => {
  const r = await p.evaluate((ms) => new Promise((res) => { const ts = []; const t0 = performance.now(); const f = (t) => { ts.push(t); if (t - t0 < ms) requestAnimationFrame(f); else res(ts) }; requestAnimationFrame(f) }), ms)
  const d = r.slice(1).map((t, i) => t - r[i])
  d.sort((a, b) => a - b)
  const avg = d.reduce((a, b) => a + b, 0) / d.length
  const out = { label, frames: d.length, fps: +(1000 / avg).toFixed(1), median_ms: +d[Math.floor(d.length / 2)].toFixed(1), p95_ms: +d[Math.floor(d.length * 0.95)].toFixed(1) }
  console.log(JSON.stringify(out))
  return out
}
console.log('renderer:', gl, ' quality:', q, ' viewport:', width)
await sample('s1 hold (void)', 3000)
await p.keyboard.press('ArrowRight')
await sample('s1 beat 1 (line drawing)', 5000)
await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight')
await sample('s1 beat 2 (matter + physics)', 5000)
await p.evaluate(() => window.__aop.goto(1, 2))
await p.keyboard.press('ArrowRight')
await p.waitForTimeout(3500)
await sample('s2 machine run', 5000)
await b.close()
