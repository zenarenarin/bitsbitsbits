// Browser input checks: desktop keys, soft-keyboard style input events, auto-submit, Enter, hint, double submit.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8766/dev/index.html');
  await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
  await p.click('.wa-cta');
  await p.evaluate(() => window.__wa.freeze(true));
  await p.waitForFunction(() => window.__wa.mode === 'play', null, { timeout: 60000 });
  ok(await p.evaluate(() => document.activeElement && document.activeElement.className === 'wa-input'), 'input focused after Begin tap');
  const ans = () => p.evaluate(() => window.__wa.run.puzzle.answer);
  const mid = () => p.evaluate(() => window.__wa.run.input.middle);
  const shownMid = () => p.evaluate(() => [...document.querySelectorAll('.wa-slot.mid b')].map(b => b.textContent).join(''));
  let a = await ans();
  // desktop typing: lowercase, extra characters, space, backspace
  await p.keyboard.type(a.slice(1, 2).toLowerCase() + ' 7');
  ok(await mid() === a[1] && await shownMid() === a[1], 'lowercase + junk ignored');
  await p.keyboard.press('Backspace'); ok(await mid() === '', 'backspace');
  await p.keyboard.press('Enter'); ok(await p.evaluate(() => window.__wa.run.level) === 0, 'empty enter does nothing');
  // soft keyboard: input events without keydown (insertText), including the whole word
  await p.keyboard.insertText(a.toLowerCase());
  await p.waitForFunction(() => window.__wa.run.level === 1, null, { timeout: 20000 }).catch(() => { });
  ok(await p.evaluate(() => window.__wa.run.level) === 1, 'soft-keyboard whole word auto-submits');
  ok(await p.evaluate(() => window.__wa.run.solved.length) === 1, 'one solve recorded');
  // during the lock-in, extra keys are dropped
  await p.keyboard.type('ZZZ'); ok(await mid() === '', 'keys dropped during transition');
  await p.waitForFunction(() => window.__wa.run.accepting(performance.now()), null, { timeout: 20000 });
  await p.waitForTimeout(800);
  a = await ans();
  // wrong word: shake, letters kept, then fix with soft-keyboard backspaces
  const wrong = 'Q'.repeat(a.length - 2);
  await p.keyboard.type(wrong); await p.keyboard.press('Enter');
  ok(await p.evaluate(() => document.querySelector('.wa-slots').classList.contains('shake')), 'wrong word shakes');
  ok(await mid() === wrong, 'letters kept after a wrong guess');
  for (let i = 0; i < wrong.length; i++) await p.evaluate(() => { const el = document.querySelector('.wa-input'); el.value = el.value.slice(0, -1); el.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true })); });
  ok(await mid() === '', 'soft-keyboard backspace clears');
  // hint: costs 5s once
  const r0 = await p.evaluate(() => window.__wa.run.remainingMs(performance.now()));
  await p.click('.wa-nudge');
  await p.waitForTimeout(100);
  const r1 = await p.evaluate(() => window.__wa.run.remainingMs(performance.now()));
  ok(r0 - r1 > 4000 && r0 - r1 < 6500, 'nudge costs ~5s ' + (r0 - r1));
  ok(await p.evaluate(() => document.querySelector('.wa-clue').textContent.length > 8), 'clue shown');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('.wa-nudge')).display) === 'none', 'nudge button hidden after use');
  ok(await p.evaluate(() => window.__wa.hint() === undefined && window.__wa.run.hintsUsed === 1), 'second nudge is free and no-op');
  // middle-only typing + Enter: auto-submits immediately anyway; hammer Enter for double submits
  await p.keyboard.type(a.slice(1, -1)); for (let i = 0; i < 4; i++) await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.__wa.run.solved.length) === 2, 'no double submit');
  console.log(`${pass} passed, ${fail} failed`, errs);
  await b.close(); process.exit(fail ? 1 : 0);
})();
