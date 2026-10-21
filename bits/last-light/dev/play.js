// A careful player: the whole street with the lamps watching. Reports time, exposure, alarms, captures.
const { open } = require('./sim');
(async () => {
  const { browser, page, errs } = await open();
  const seq = [
    // I
    { d: 0.6, mx: 1 }, { d: 0.9, mx: 1, j: true, jp: true }, { d: 0.6, mx: 1, until: 'P.x>12.9' }, { d: 1.2, mx: 1, j: true, jp: true, until: "P.state==='hang'" }, { d: 0.8, my: 1, until: "P.state==='ground'" },
    // II: lower onto the lip and shimmy the whole roof in its shadow
    { d: 0.6, my: -1, until: "P.state==='hang'" }, { d: 0.1 }, { d: 16, mx: 1, until: 'P.x>43.7' },
    { d: 0.3, my: -1 }, { d: 2, mx: 1, until: "P.state==='pipe' || P.state==='ground'" }, { d: 6, my: -1, until: "P.state==='ground' && P.y<0.1" },
    // IV: into the doorway, pull, run under the awning
    { d: 3, mx: 1, until: 'P.x>55.9' }, { d: 0.3 }, { d: 0.2, a: true }, { d: 0.55 }, { d: 3, mx: 1, until: 'P.x>64.5' },
    { d: 1.5, mx: 1, until: 'P.x>65.4' }, { d: 6, until: "!lit(64,72,0.9)" }, { d: 3, mx: 1, until: 'P.x>74.9' },
    // V: wait in the doorway for the shutter to lift, then through the gate
    { d: 12, until: "L.level.shutters[0].y>2.6 && L.watcher.mode==='search'" }, { d: 4, mx: 1, until: 'P.x>88' },
    // VI: wait for the court to darken, run, swing
    { d: 6, until: "!lit(88,99,0.9)" }, { d: 3, mx: 1, until: 'P.x>98.3' }, { d: 1.2, mx: 1, j: true, jp: true, until: "P.state==='rope'" }, { d: 0.9, mx: 1 }, { d: 0.6, mx: -1 }, { d: 1.5, mx: 1, until: 'P.rAng>0.75' }, { d: 1.5, mx: 1, jp: true, j: true, until: "P.state==='ground'" },
    { d: 3, mx: 1, until: 'P.x>111.6' }, { d: 12, until: "L.watcher.mode==='search' && !lit(113,122,0.9)" }, { d: 3, mx: 1, until: 'P.x>122.3' },
    // VII: up, pull, drop, run
    { d: 4, my: 1, until: "P.state==='ground' && P.y>6" }, { d: 1, mx: 1, until: 'P.x>125.6' }, { d: 0.2, a: true }, { d: 0.45 }, { d: 0.1, my: -1, j: true, jp: true }, { d: 1.5, until: "P.state==='ground' && P.y<1" }, { d: 6, mx: 1, until: 'L.mode!=="play"' }
  ];
  const r = await page.evaluate(seq => { const L = window.__ll; L.beginRun(); const tr = L.run(seq); return { tr: tr.map(s => s.x + ',' + s.y + ',' + s.st + ',' + s.w).join(' | '), mode: L.mode, res: L.result && { t: +L.result.t.toFixed(1), seen: +L.result.seen.toFixed(2), alarms: L.result.alarms, captures: L.result.captures, score: L.result.value } }; }, seq);
  console.log(r.tr); console.log(r.mode, JSON.stringify(r.res));
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
