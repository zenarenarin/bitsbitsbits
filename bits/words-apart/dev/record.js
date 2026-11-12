// Records a full playthrough frame by frame on a virtual clock, then encodes an MP4.
// node dev/record.js <outdir> [fps] [dpr]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const out = process.argv[2] || 'dev/rec', FPS = +(process.argv[3] || 30), DPR = +(process.argv[4] || 2);
const DT = 1000 / FPS;
(async () => {
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'f'), { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8766/dev/record.html');
  await p.waitForFunction(() => window.__ready && document.fonts.status === 'loaded', null, { timeout: 120000 });
  let n = 0;
  const shot = async () => { await p.screenshot({ path: path.join(out, 'f', String(n++).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 }); };
  const step = async () => { await p.evaluate(dt => window.__step(dt), DT); await shot(); if (n % 60 === 0) console.log('frame', n, (n / FPS).toFixed(1) + 's'); };
  const hold = async sec => { for (let i = 0; i < Math.round(sec * FPS); i++) await step(); };
  const until = async (fn, maxSec = 30) => { for (let i = 0; i < maxSec * FPS; i++) { if (await p.evaluate(fn)) return; await step(); } throw new Error('timeout waiting'); };
  const key = async k => { await p.evaluate(k => { const b = document.querySelector(`.wa-key[data-k="${k}"]`); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); }, k); };
  const typeWord = async (letters, gap = 0.2) => { for (const c of letters) { await key(c); await hold(gap + (c.charCodeAt(0) % 3) * 0.04); } };
  const tap = async sel => { await p.evaluate(sel => document.querySelector(sel).click(), sel); };
  const ready = () => window.__wa.mode === 'play' && window.__wa.run.accepting(window.__waNow());
  const ans = () => p.evaluate(() => window.__wa.run.puzzle.answer);

  await hold(3.5);                      // the title over the opening of the shaft
  await tap('.wa-cta');                 // begin the descent
  await until(ready); await hold(1.4);
  let a = await ans(); await typeWord(a.slice(1, -1), 0.24);           // 1: quick
  await until(ready); await hold(2.2);
  a = await ans(); await typeWord(a.slice(1, -1), 0.22);               // 2
  await until(ready); await hold(2.0);
  a = await ans();                                                       // 3: a wrong guess first
  const wrong = (a.slice(1, -1).split('').reverse().join('') === a.slice(1, -1) ? 'Q' : '') + a.slice(1, -1).split('').reverse().join('');
  await typeWord(wrong.slice(0, a.length - 2), 0.2); await hold(0.3); await key('Enter'); await hold(1.1);
  for (let i = 0; i < a.length - 2; i++) { await key('Backspace'); await hold(0.12); }
  await hold(0.8); await typeWord(a.slice(1, -1), 0.2);
  await until(ready); await hold(2.6);
  a = await ans(); await tap('.wa-nudge'); await hold(2.8);              // 4: a nudge
  await typeWord(a.slice(1, -1), 0.22);
  await until(ready); await hold(3.0);
  a = await ans(); await typeWord(a.slice(1, -1), 0.26);               // 5: the final word
  await until(() => document.querySelectorAll('.wa-panel.on').length > 0 && window.__wa.mode === 'over', 40);
  await hold(6);                                                         // the reveal and the results
  console.log('frames', n, 'errors', errs, JSON.stringify(await p.evaluate(() => ({ state: window.__wa.run.state, score: window.__wa.run.score }))));
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(out, 'f', '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', path.join(out, 'words-apart-playthrough.mp4')]);
  console.log('video', path.join(out, 'words-apart-playthrough.mp4'));
})().catch(e => { console.error(e); process.exit(1); });
