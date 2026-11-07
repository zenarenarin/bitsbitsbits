// Usage: node tools/shoot.mjs <url> <outdir> <scene> t1 t2 ...
// Renders frames at exact timeline times (capture mode) and saves PNGs.
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
let pw
try { pw = require('playwright') } catch { pw = require('/opt/node-tools/node_modules/playwright') }
const { chromium } = pw
const [url, out, scene, ...times] = process.argv.slice(2)
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()) })
p.on('pageerror', (e) => console.log('[pageerror]', e.message))
await p.goto(`${url}?capture&scene=${scene}`)
await p.waitForFunction(() => window.__aop && window.__aop.ready, null, { timeout: 60000 })
for (const t of times) {
  await p.evaluate((t) => { const L = window.__aop.labels(); window.__aop.seek(t in L ? L[t] : parseFloat(t)); window.__aop.step(1 / 60); window.__aop.step(1 / 60) }, t)
  const tt = await p.evaluate((t) => { const L = window.__aop.labels(); return (t in L ? L[t] : parseFloat(t)).toFixed(2) }, t)
  await p.screenshot({ path: `${out}/s${scene}_${tt.padStart(6, '0')}.png` })
  console.log('shot', t)
}
await b.close()
