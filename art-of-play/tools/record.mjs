// Records the real experience as a presenter would drive it: holds, key presses, transitions.
// Usage: node tools/record.mjs <url> <outdir> <presses> [holdSeconds] [fps] [width]
import { createRequire } from 'module'
import fs from 'fs'
const require = createRequire(import.meta.url)
let pw
try { pw = require('playwright') } catch { pw = require('/opt/node-tools/node_modules/playwright') }
const { chromium } = pw
const [url, out, pressesArg, holdArg = '1.6', fpsArg = '30', widthArg = '1280'] = process.argv.slice(2)
const presses = parseInt(pressesArg, 10)
const hold = parseFloat(holdArg)
const fps = parseInt(fpsArg, 10)
const width = parseInt(widthArg, 10)
fs.mkdirSync(out, { recursive: true })
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width, height: Math.round((width * 9) / 16) } })
p.on('pageerror', (e) => console.log('[pageerror]', e.message))
const cdp = await p.context().newCDPSession(p)
await p.goto(`${url}?capture&scene=1${width <= 1280 ? '&q=low' : ''}`)
await p.waitForFunction(() => window.__aop && window.__aop.ready, null, { timeout: 60000 })
let n = 0
const dt = 1 / fps
const frame = async () => {
  await p.evaluate((dt) => window.__aop.step(dt), dt)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true })
  fs.writeFileSync(`${out}/f${String(n++).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'))
}
const holdFor = async (s) => { for (let i = 0; i < Math.round(s * fps); i++) await frame() }
const log = []
await holdFor(hold)
for (let k = 0; k < presses; k++) {
  const before = await p.evaluate(() => window.__aop.state())
  await p.evaluate(() => window.__aop.next())
  log.push({ press: k + 1, at: (n / fps).toFixed(2), from: `${before.scene}:${before.label}` })
  let guard = 0
  while ((await p.evaluate(() => window.__aop.state().playing)) && guard++ < fps * 40) await frame()
  const st = await p.evaluate(() => window.__aop.state())
  log[log.length - 1].to = `${st.scene}:${st.label}${st.ended ? ' (end)' : ''}`
  await holdFor(hold)
}
fs.writeFileSync(`${out}/presses.json`, JSON.stringify(log, null, 2))
console.log(JSON.stringify(log))
console.log('frames', n)
await b.close()
