#!/usr/bin/env node
/*
 * Render the patrika.
 *
 *   node tools/render.mjs video            → out/patrika.mp4 (1080×1920, 30 fps)
 *   node tools/render.mjs still            → out/patrika-static.jpg + .pdf (2160×3840)
 *   node tools/render.mjs frame 11 22 34   → out/frame-11.png … (1080×1920, for checking)
 *
 * Needs Chromium via Playwright, and ffmpeg on PATH for video.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

async function open(scale) {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: scale });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?render&scale=${scale}`);
  const t0 = Date.now();
  await page.waitForFunction(() => window.patrika && window.patrika.ready, null, { timeout: 300000 });
  console.log(`painted in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { srv, browser, page };
}
const shot = (page, file) => page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1080, height: 1920 }, type: 'png' });

const [mode = 'frame', ...rest] = process.argv.slice(2);

if (mode === 'frame') {
  const { srv, browser, page } = await open(1);
  for (const t of rest.length ? rest : ['0']) {
    await page.evaluate((t) => window.patrika.renderAt(t), parseFloat(t));
    const f = path.join(OUT, `frame-${t}.png`);
    await shot(page, f);
    console.log(f);
  }
  await browser.close(); srv.close();
} else if (mode === 'still') {
  // the static patrika at 2× (2160 × 3840): PNG master, JPEG for sending, PDF
  const { srv, browser, page } = await open(2);
  const t = await page.evaluate(() => window.TIMELINE.still);
  await page.evaluate((t) => window.patrika.renderAt(t), t);
  const png = path.join(OUT, 'patrika-static.png');
  await shot(page, png);
  await browser.close(); srv.close();
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
a = Image.open(sys.argv[1]).convert('RGB')
a.save(sys.argv[2], quality=92, optimize=True)
a.save(sys.argv[3], resolution=300)
`, png, path.join(OUT, 'patrika-static.jpg'), path.join(OUT, 'patrika-static.pdf')], { stdio: 'inherit' });
  fs.unlinkSync(png);
  console.log(path.join(OUT, 'patrika-static.jpg'));
  console.log(path.join(OUT, 'patrika-static.pdf'));
} else if (mode === 'video') {
  const { srv, browser, page } = await open(1);
  const { duration, fps } = await page.evaluate(() => ({ duration: window.patrika.duration, fps: window.patrika.fps }));
  const N = Math.round(duration * fps);
  const file = path.join(OUT, 'patrika.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-tune', 'film', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await page.evaluate((t) => window.patrika.renderAt(t), i / fps);
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1080, height: 1920 }, type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 60 === 0) console.log(`frame ${i}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close(); srv.close();
  console.log(file);
} else {
  console.error('usage: render.mjs video | still | frame <t…>');
  process.exit(1);
}
