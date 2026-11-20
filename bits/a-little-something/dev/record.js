// Records a human-paced playthrough as full-resolution frames (CDP screencast),
// then builds an MP4 with ffmpeg. node dev/record.js <outdir>
// Serve this folder first: python3 -m http.server 8777
const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
const out = process.argv[2] || 'shots/video';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const vw = 402, vh = 874;
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto('http://localhost:8777/dev/index.html');
  await page.waitForFunction(() => window.__ready === true);
  fs.rmSync(out + '/frames', { recursive: true, force: true });
  fs.mkdirSync(out + '/frames', { recursive: true });
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', async (f) => {
    const name = `${out}/frames/f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(name, Buffer.from(f.data, 'base64'));
    frames.push({ name, t: f.metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: vw * 2, maxHeight: vh * 2, everyNthFrame: 1 });
  // Hide the dev log; show touches as a soft finger dot.
  await page.addStyleTag({ content: '#log{display:none!important} .tdot{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,255,255,.55);border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 10px rgba(0,0,0,.25);z-index:99;pointer-events:none;transition:opacity .35s, transform .35s}' });
  await page.evaluate(() => {
    const mk = (x, y) => { const d = document.createElement('div'); d.className = 'tdot'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); return d; };
    window.__touch = { down(x, y) { this.d = mk(x, y); }, move(x, y) { if (this.d) { this.d.style.left = x + 'px'; this.d.style.top = y + 'px'; } }, up() { const d = this.d; this.d = null; if (d) { d.style.opacity = 0; d.style.transform = 'scale(1.6)'; setTimeout(() => d.remove(), 400); } } };
  });
  const state = () => page.evaluate(() => window.__als.state);
  const tap = async (x, y) => { await page.evaluate(([x, y]) => window.__touch.down(x, y), [x, y]); await page.mouse.move(x, y); await page.mouse.down(); await sleep(90); await page.mouse.up(); await page.evaluate(() => window.__touch.up()); };
  const swipe = async (x, y, dx) => { await page.evaluate(([x, y]) => window.__touch.down(x, y), [x, y]); await page.mouse.move(x, y); await page.mouse.down(); for (let i = 1; i <= 12; i++) { await page.mouse.move(x + dx * i / 12, y); await page.evaluate(([x, y]) => window.__touch.move(x, y), [x + dx * i / 12, y]); await sleep(25); } await page.mouse.up(); await page.evaluate(() => window.__touch.up()); };
  const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn(await state())) return; await sleep(30); } };
  async function dropWhen(goal) {
    // Like a person: aim for the wanted landing, settle for any landing on the island after a beat.
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const p = await page.evaluate(() => window.__als.pred()); const s = await state();
      const waited = Date.now() - t0;
      if (s.cur === 'swing' && p && (goal(p, s) || (waited > 1800 && p.kind !== 'water'))) break;
      await sleep(16);
    }
    await tap(vw * 0.62, vh * 0.3);
  }
  // Let the opening breathe so the ghost-tap demonstration plays once.
  await sleep(3600);
  const plan = ['center', 'land', 'stack', 'edge', 'side', 'stack', 'land'];
  for (let i = 0; i < plan.length; i++) {
    await waitFor((s) => s.cur === 'swing' && (s.phase === 'play' || s.phase === 'intro'));
    await sleep(600 + (i === 0 ? 0 : 300));
    const want = plan[i];
    const n = (await state()).placed;
    await dropWhen((p, s) => {
      if (want === 'water') return p.kind === 'water';
      if (want === 'stack') return p.kind === 'house';
      if (want === 'edge') return p.kind === 'extend';
      if (want === 'side') return p.kind === 'land' && Math.abs(p.x - 200) > 30;
      if (want === 'center') return p.kind === 'land' && Math.abs(p.x - 200) < 8;
      return p.kind === 'land' && Math.abs(p.x - 200) < 45;
    });
    await waitFor((s) => s.placed > n);
  }
  await waitFor((s) => s.phase === 'outro');
  const lx = vw / 2, ly = vh - 36 - 24;
  await sleep(3000);
  await swipe(lx, ly, 95);               // like
  await waitFor((s) => s.outro === 'capture');
  await sleep(2600);
  await swipe(lx, ly, -95);              // capture
  await waitFor((s) => s.outro === 'scroll');
  await sleep(4200);                     // the scroll-to-play-more demonstration
  await tap(lx, ly);                     // into browse mode, where the feed scrolls
  await sleep(3500);
  await cdp.send('Page.stopScreencast');
  await browser.close();
  // Hold each frame for its real duration.
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 1 / 30;
    lines.push(`file '${require('path').resolve(frames[i].name)}'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
  }
  lines.push(`file '${require('path').resolve(frames[frames.length - 1].name)}'`);
  fs.writeFileSync(out + '/frames.txt', lines.join('\n'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', out + '/frames.txt', '-vf', 'fps=30,scale=804:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-movflags', '+faststart', out + '/a-little-something.mp4']);
  console.log('done', frames.length, 'frames', ((frames[frames.length - 1].t - frames[0].t)).toFixed(1), 's');
})().catch((e) => { console.error(e); process.exit(1); });
