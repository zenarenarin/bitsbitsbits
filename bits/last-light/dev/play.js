// A careful player, with the lamps watching. Two complete routes:
//   A  balcony -> roof (timed against the raking lamp) -> pipe -> awning -> gate -> rope -> high cord
//   B  balcony -> street (doorway to doorway between the lanterns) -> high road in IV (no awning) -> gate -> cellar -> rooftops
// usage: node dev/play.js [A|B]
const { open } = require('./sim');
const ROUTE = process.argv[2] || 'A';
const I_ = [
  { d: 8, until: "!lit(2,13.8,10.2) && !lit(2,13.8,9.3)" }, { d: 0.6, mx: 1 }, { d: 0.9, mx: 1, j: true, jp: true }, { d: 0.6, mx: 1, until: 'P.x>12.9' }
];
const A = [
  ...I_, { d: 1.2, mx: 1, j: true, jp: true, until: "P.state==='hang'" }, { d: 6, until: "!lit(12.6,22,13.2)" }, { d: 0.8, my: 1, until: "P.state==='ground'" },
  // the roof: chimney to chimney when the rake is away
  { d: 3, mx: 1, until: 'P.x>20.9' }, { d: 8, until: "!lit(21,29,13.4)" }, { d: 0.8, mx: 1, j: true, jp: true, until: "P.state==='hang'" }, { d: 0.6, my: 1, until: "P.state==='ground'" },
  { d: 3, mx: 1, until: 'P.x>27.4' }, { d: 8, until: "!lit(27,36,13.4)" }, { d: 0.8, mx: 1, j: true, jp: true, until: "P.state==='hang'" }, { d: 0.6, my: 1, until: "P.state==='ground'" },
  { d: 3, mx: 1, until: 'P.x>34' }, { d: 8, until: "!lit(34,44,13.4)" }, { d: 0.8, mx: 1, j: true, jp: true, until: "P.state==='hang'" }, { d: 0.6, my: 1, until: "P.state==='ground'" },
  { d: 3, mx: 1, until: "P.state==='pipe'" }, { d: 6, my: -1, until: "P.state==='ground' && P.y<0.1" },
  // IV: into the doorway, pull when the lantern looks away, run under the awning
  { d: 3, mx: 1, until: 'P.x>53.3' }, { d: 10, until: "(l => Math.sin(2*Math.PI*l.clock/l.period)>0.85)(L.level.lights.find(l => l.x === 60.4))" }, { d: 1, mx: 1, until: 'P.x>56.1' }, { d: 0.2, a: true }, { d: 0.5 }, { d: 3, mx: 1, until: 'P.x>64.5' },
  { d: 1.5, mx: 1, until: 'P.x>65.4' }, { d: 6, until: "!lit(64,75,0.9)" }, { d: 3, mx: 1, until: 'P.x>74.9' },
  { d: 14, until: "L.level.shutters[0].y>2.6 && L.watcher.mode==='search'" }, { d: 4, mx: 1, until: 'P.x>88' },
  { d: 12, until: "!litSoon(88,108,1.2,2.6)" }, { d: 3, mx: 1, until: 'P.x>98.3' }, { d: 1.2, mx: 1, j: true, jp: true, until: "P.state==='rope'" }, { d: 1.5, mx: 1, until: 'P.rAng>0.6' }, { d: 1.5, mx: 1, jp: true, j: true, until: "P.state==='ground'" },
  { d: 3, mx: 1, until: 'P.x>111.6' }, { d: 12, until: "L.watcher.mode==='search' && !lit(113,122,0.9)" }, { d: 3, mx: 1, until: 'P.x>122.3' },
  { d: 4, my: 1, until: "P.state==='pipe' && P.y>3.6" }, { d: 16, until: "!litSoon(122,126.2,7.3,2.6) && !litSoon(122,126.2,8.0,2.6)" }, { d: 4, my: 1, until: "P.state==='ground' && P.y>6" }, { d: 1, mx: 1, until: 'P.x>125.6' }, { d: 0.2, a: true }, { d: 0.45 }, { d: 0.1, my: -1, j: true, jp: true }, { d: 1.5, until: "P.state==='ground' && P.y<1" }, { d: 6, mx: 1, until: 'L.mode!=="play"' }
];
// street doorways in II: 20.1, 30.5, 41.7 ; wait for the stretch ahead to clear, then sprint
const dash = (x0, x1, door) => [{ d: 12, until: `!litSoon(${x0},${x1},0.9,${((x1 - x0) / 6 + 0.3).toFixed(1)}) && !litSoon(${x0},${x1},1.5,${((x1 - x0) / 6 + 0.3).toFixed(1)})` }, { d: 4, mx: 1, until: `P.x>${door}` }, { d: 0.15 }];
const B = [
  ...I_, { d: 2, mx: 1, until: "P.state==='ground' && P.y<1" }, { d: 1, mx: 1, until: 'P.x>16' }, { d: 1, mx: -1, until: 'P.x<16.1' },
  ...dash(16, 20.5, 20.1), ...dash(20.5, 31, 30.5), ...dash(30.5, 42, 41.7), ...dash(41.5, 47, 46.6),
  // IV high road: climb D's balconies, then balcony to balcony when the rake is away
  { d: 1, mx: -1, until: 'P.x<45.1' }, { d: 4, my: 1, until: "P.state==='pipe' && P.y>8.3" }, { d: 1.5, mx: 1, j: true, jp: true, until: "P.state==='ground' && P.y>7.5" },
  { d: 1, mx: 1, until: 'P.x>48.8' }, { d: 1.2, mx: 1, j: true, jp: true, until: "P.state==='ground' || P.state==='hang'" }, { d: 0.6, my: 1, until: "P.state==='ground'" }, { d: 1.5, mx: 0.5, until: 'P.x>52.3' }, { d: 0.3 }, { d: 1, mx: -0.35, until: 'P.x<52.75' }, { d: 0.3 },
  // from the balcony doorway: read the rake, then the whole high road in one go
  { d: 14, until: "!litSoon(53,71,9.3,3.2) && !litSoon(53,71,8.6,3.2)" }, { d: 1.5, mx: 1, until: 'P.x>54.9' }, { d: 1.4, mx: 1, j: true, jp: true, until: "(P.state==='ground' || P.state==='hang') && P.x>58" }, { d: 0.6, my: 1, until: "P.state==='ground'" }, { d: 2, mx: 1, until: 'P.x>63' },
  { d: 1.4, mx: 1, j: true, jp: true, until: "(P.state==='ground' || P.state==='hang') && P.x>66" }, { d: 0.6, my: 1, until: "P.state==='ground'" }, { d: 2, mx: 1, until: "P.state==='pipe'" }, { d: 4, my: -1, until: "P.state==='ground' && P.y<0.1" },
  { d: 2, mx: 1, until: 'P.x>74.9' }, { d: 6, until: "!lit(75,88,0.9)" }, { d: 4, mx: 1, until: 'P.x>88' },
  { d: 6, until: "!lit(88,99,0.9)" }, { d: 3, mx: 1, until: 'P.x>99.6' }, { d: 1.5, until: "P.state==='ground' || P.state==='pipe'" }, { d: 0.8, mx: 1, until: 'P.x>105.6' }, { d: 8, until: "!lit(105,112,0.9)" }, { d: 3, my: 1, until: "P.state==='ground' && P.y>-0.1" }, { d: 3, mx: 1, until: 'P.x>111.6' },
  { d: 12, until: "L.watcher.mode==='search' && !lit(113,123,0.9)" }, { d: 3, mx: 1, until: 'P.x>122.3' },
  { d: 4, my: 1, until: "P.state==='pipe' && P.y>3.6" }, { d: 16, until: "!litSoon(122,128.2,7.3,3.4) && !colSoon(127.9,7,12.5,3.4)" }, { d: 4, my: 1, until: "P.state==='ground' && P.y>6" }, { d: 1, mx: 1, until: 'P.x>127.85' }, { d: 4, my: 1, until: "P.state==='pipe' && P.y>10.6" }, { d: 16, until: "!litSoon(128,142,13.9,3.0) && !litSoon(128,142,13.2,3.0)" }, { d: 4, my: 1, until: "P.state==='ground' && P.y>12" }, { d: 3, mx: 1, until: 'P.x>141.4' }, { d: 1.5, until: "P.state==='ground' && P.y<1" }, { d: 6, mx: 1, until: 'L.mode!=="play"' }
];
(async () => {
  const { browser, page, errs } = await open();
  const r = await page.evaluate(seq => { const L = window.__ll; L.beginRun(); const tr = L.run(seq); return { tr: tr.map(s => s.x + ',' + s.y + ',' + s.st + ',' + s.w).join(' | '), mode: L.mode, caps: L.captures, why: (document.querySelector('.ll-why') || {}).textContent, res: L.result && { t: +L.result.t.toFixed(1), seen: +L.result.seen.toFixed(2), alarms: L.result.alarms, captures: L.result.captures, score: L.result.value } }; }, ROUTE === 'B' ? B : A);
  console.log(r.tr); console.log('ROUTE ' + ROUTE + ':', r.mode, JSON.stringify(r.res || { why: r.why }));
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
