// The caretaker's field notebook: every piece of UI is a small printed or
// pencilled object, never a dashboard.
const PAPER_NOISE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.3 0 0 0 0 0.22 0 0 0 .09 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>\")";
const UI_CSS = `
.twk{--ink:#2f3a48;--char:#3b3835;--paper:#f5efe2;--paper2:#ece3d0;--dust:#c9a24e;--coral:#d4664f;--sky:#e9f1ef;
  --st:0px;--sb:120px;--sl:0px;--sr:0px;font-family:'TWK Sans',system-ui,-apple-system,sans-serif;color:var(--ink);-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.twk *{box-sizing:border-box}
.twk .serif{font-family:'TWK Serif','Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300}
.twk .disp{font-family:'TWK Display','DM Serif Display',Georgia,serif;font-style:italic;font-weight:400}
.twk .mono{font-family:'TWK Mono','Space Mono',ui-monospace,Menlo,monospace}
.twk .fade{transition:opacity .6s ease, transform .6s ease}
.twk .hide{opacity:0!important;pointer-events:none!important}
/* ---- HUD ---- */
.twk-hud{position:absolute;inset:0;pointer-events:none}
.twk-label{position:absolute;left:calc(var(--sl) + 18px);top:calc(var(--st) + 14px);display:flex;flex-direction:column;gap:6px;max-width:62%}
.twk-tag{display:flex;align-items:center;gap:7px;font-size:10px;letter-spacing:.24em;color:var(--ink);opacity:.82}
.twk-tag svg{width:15px;height:15px;flex:none}
.twk-tag .sl{opacity:.45;letter-spacing:0}
.twk-rule{height:1px;width:132px;background:linear-gradient(90deg,rgba(47,58,72,.55),rgba(47,58,72,0))}
.twk-obj{font-size:17px;line-height:1.15;color:var(--char);text-shadow:0 0 12px rgba(245,240,228,.85),0 0 2px rgba(245,240,228,.9)}
.twk-ticks{display:flex;gap:5px;align-items:center;height:14px;margin-top:1px}
.twk-ticks i{display:block;width:2px;height:12px;border-radius:1px;background:rgba(47,58,72,.2);transform:rotate(8deg);transition:background .4s,transform .4s,height .4s}
.twk-ticks i.on{background:var(--ink);height:14px;transform:rotate(14deg)}
.twk-ticks i.cross{width:2px;height:22px;transform:rotate(66deg);margin-left:-18px;background:var(--coral)}
.twk-ticks .t{font-size:11px;letter-spacing:.12em;margin-left:6px;opacity:.75}
.twk-note{font-size:14px;color:var(--char);opacity:.9;max-width:240px;line-height:1.25;text-shadow:0 0 10px rgba(245,240,228,.9)}
.twk-pause{position:absolute;right:calc(var(--sr) + 8px);top:calc(var(--st) + 6px);width:44px;height:44px;display:flex;align-items:center;justify-content:center;pointer-events:auto;opacity:.55;transition:opacity .3s;cursor:pointer}
.twk-pause:active{opacity:1}
.twk-pause svg{width:20px;height:20px}
.twk-flow{position:absolute;left:calc(var(--sl) + 8px);bottom:calc(var(--sb) + 0px);display:flex;align-items:center;gap:10px;padding:8px 18px 8px 8px;border-radius:40px;background:radial-gradient(closest-side,rgba(245,240,228,.82),rgba(245,240,228,.55) 60%,rgba(245,240,228,0))}
.twk-flow svg{width:50px;height:50px;overflow:visible;filter:drop-shadow(0 1px 2px rgba(245,240,228,.7))}
.twk-ctr{display:flex;flex-direction:column;gap:3px}
.twk-num{display:flex;font-size:12px;line-height:1;height:14px;overflow:hidden;color:var(--ink)}
.twk-num span{display:block;width:9px;height:14px;overflow:hidden;position:relative;border-right:1px solid rgba(47,58,72,.12)}
.twk-num span:last-child{border-right:0}
.twk-num span b{display:block;font-weight:400;position:absolute;left:1px;top:0;transition:transform .45s cubic-bezier(.3,1.4,.5,1);white-space:pre;line-height:14px}
.twk-sub{font-size:9px;letter-spacing:.22em;opacity:.6}
.twk-say{position:absolute;left:0;right:0;bottom:calc(var(--sb) + 64px);text-align:center;font-size:21px;color:var(--char);opacity:0;transform:translateY(6px);transition:opacity 1s ease,transform 1.2s ease;text-shadow:0 0 14px rgba(245,240,228,.95)}
.twk-say.on{opacity:.92;transform:none}
.twk-touch{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:1.2px solid rgba(47,58,72,.55);pointer-events:none;animation:twkTouch .5s ease-out forwards}
@keyframes twkTouch{from{transform:scale(.4);opacity:.9}to{transform:scale(1.25);opacity:0}}
.twk-hint{position:absolute;inset:0;pointer-events:none}
.twk-hint svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.twk-hint .lbl{position:absolute;font-size:17px;color:var(--char);text-shadow:0 0 10px rgba(245,240,228,.95);white-space:nowrap;transform:translate(-50%,-100%)}
.twk-finger{position:absolute;left:50%;bottom:calc(var(--sb) + 36px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;font-size:15px;opacity:0;transition:opacity .4s}
.twk-finger.on{opacity:.95}
.twk-finger i{display:block;width:30px;height:30px;border-radius:50%;border:1.5px solid var(--ink);position:relative;animation:twkPress 1s ease-in-out infinite}
.twk-finger i:after{content:'';position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px;border-radius:50%;background:var(--ink)}
@keyframes twkPress{0%,100%{transform:scale(1)}45%{transform:scale(.78)}}
/* ---- title ---- */
.twk-title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;pointer-events:none}
.twk-title .head{margin-top:calc(var(--st) + 7vh);text-align:center;display:flex;flex-direction:column;align-items:center}
.twk-title .over{font-size:10px;letter-spacing:.42em;opacity:.7;margin-bottom:10px}
.twk-title h1{margin:0;font-size:clamp(46px,13vw,76px);line-height:.92;letter-spacing:-.01em;color:var(--char);text-shadow:0 0 30px rgba(245,240,228,.8)}
.twk-title .rule{width:46px;height:1px;background:var(--ink);opacity:.5;margin:16px 0 12px}
.twk-title .tag{font-size:17px;line-height:1.3;color:var(--char);opacity:.92;text-shadow:0 0 12px rgba(245,240,228,.95)}
.twk-title .foot{position:absolute;bottom:calc(var(--sb) + 10px);left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:14px}
.twk-begin{pointer-events:auto;font-size:24px;padding:10px 26px;color:var(--char);cursor:pointer;text-shadow:0 0 14px rgba(245,240,228,.95);animation:twkBreathe 3.2s ease-in-out infinite}
@keyframes twkBreathe{0%,100%{opacity:.95}50%{opacity:.6}}
.twk-links{display:flex;gap:22px;pointer-events:auto}
.twk-link{font-size:10px;letter-spacing:.26em;padding:10px 6px;cursor:pointer;opacity:.75;border:0;background:none;color:var(--ink)}
.twk-link:active{opacity:1}
/* ---- paper sheets ---- */
.twk-sheet{position:absolute;left:50%;bottom:calc(var(--sb) - 6px);width:min(92vw,420px);transform:translate(-50%,24px);opacity:0;pointer-events:none;transition:opacity .5s ease,transform .6s cubic-bezier(.2,.9,.3,1)}
.twk-sheet.on{transform:translate(-50%,0);opacity:1;pointer-events:auto}
.twk-paper{position:relative;background-color:var(--paper);background-image:${PAPER_NOISE},linear-gradient(180deg,rgba(255,255,255,.35),rgba(236,227,208,.35));padding:22px 22px 18px;box-shadow:0 18px 40px -18px rgba(40,46,56,.45),0 2px 0 rgba(255,255,255,.6) inset;color:var(--char)}
.twk-paper:before{content:'';position:absolute;left:14px;right:14px;top:9px;height:1px;background:repeating-linear-gradient(90deg,rgba(47,58,72,.35) 0 3px,transparent 3px 7px)}
.twk-paper .k{font-size:9.5px;letter-spacing:.3em;opacity:.7}
.twk-paper h2{margin:6px 0 2px;font-size:30px;line-height:1.02;font-weight:300}
.twk-paper h3{margin:2px 0 10px;font-size:15px;opacity:.8}
.twk-rows{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin:14px 0 6px;padding:12px 0;border-top:1px solid rgba(47,58,72,.18);border-bottom:1px solid rgba(47,58,72,.18)}
.twk-rows div{display:flex;flex-direction:column;gap:3px}
.twk-rows .v{font-size:19px}
.twk-rows .l{font-size:8.5px;letter-spacing:.26em;opacity:.65}
.twk-stamps{display:flex;gap:10px;margin:12px 0 4px;flex-wrap:wrap}
.twk-stamp{font-size:9px;letter-spacing:.24em;padding:6px 8px 5px;border:1.4px solid currentColor;border-radius:3px;color:rgba(47,58,72,.25);transform:rotate(-3deg)}
.twk-stamp.on{color:var(--coral);opacity:.92;transform:rotate(-5deg) scale(1);animation:twkStamp .5s cubic-bezier(.3,1.6,.5,1) both}
.twk-stamp:nth-child(2){transform:rotate(2deg)}.twk-stamp:nth-child(3){transform:rotate(-1deg)}
@keyframes twkStamp{from{transform:rotate(-12deg) scale(1.6);opacity:0}}
.twk-disc{font-size:15px;margin:6px 0 2px;opacity:.85}
.twk-acts{display:flex;justify-content:space-between;align-items:center;margin-top:14px}
.twk-btn{border:0;background:none;padding:12px 4px;font-size:21px;color:var(--char);cursor:pointer;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:5px;text-decoration-color:rgba(47,58,72,.4)}
.twk-btn.small{font-size:10px;letter-spacing:.26em;text-decoration:none;opacity:.75}
.twk-btn[disabled]{opacity:.3}
.twk-board{margin-top:10px;font-size:12px}
.twk-board .row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dotted rgba(47,58,72,.25)}
.twk-board .row.me{color:var(--coral)}
.twk-board .st{font-size:9px;letter-spacing:.2em;opacity:.6;padding-top:6px}
/* notebook index */
.twk-index{max-height:calc(100vh - var(--st) - var(--sb) - 60px);overflow:auto;-webkit-overflow-scrolling:touch}
.twk-sec{margin:14px 0 4px;display:flex;align-items:baseline;gap:10px}
.twk-sec .n{font-size:11px;letter-spacing:.2em;opacity:.6}
.twk-sec .t{font-size:22px}
.twk-ent{display:flex;align-items:baseline;gap:10px;padding:9px 2px;border-bottom:1px dotted rgba(47,58,72,.22);cursor:pointer}
.twk-ent .n{font-size:10px;opacity:.55;width:18px}
.twk-ent .t{flex:1;font-size:17px}
.twk-ent .m{display:flex;gap:4px}
.twk-ent .m i{width:7px;height:7px;border-radius:50%;border:1px solid rgba(212,102,79,.6)}
.twk-ent .m i.on{background:var(--coral);border-color:var(--coral)}
.twk-ent.lock{cursor:default;opacity:.35}
.twk-ent.next .t:after{content:' ←';font-style:normal;font-size:12px;opacity:.6}
.twk-close{position:absolute;right:10px;top:10px;width:36px;height:36px;border:0;background:none;font-size:20px;color:var(--ink);opacity:.6;cursor:pointer}
.twk-fail{position:absolute;left:0;right:0;top:40%;text-align:center;font-size:18px;padding:0 30px;color:var(--char)}
.twk-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 55%,rgba(0,0,0,0) 62%,rgba(40,50,62,.16) 100%)}
.twk-veil{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(240,242,236,.55),rgba(240,242,236,0) 40%,rgba(240,242,236,0) 72%,rgba(240,238,228,.72) 100%);opacity:0;transition:opacity .8s}
.twk-veil.on{opacity:1}
`;
// the flow turbine: six blades that fill and spin with the world's flow
const TURBINE_SVG = `<svg viewBox="-26 -26 52 52">
  <circle r="23" fill="none" stroke="#2f3a48" stroke-opacity=".35" stroke-width=".8" stroke-dasharray="1.5 3"/>
  <g class="rot">${[0, 1, 2, 3, 4, 5].map(i => `<g transform="rotate(${i * 60})"><path class="bl" d="M0,-3 C5,-6 7,-14 3,-20 C1,-21 -1,-21 -2,-19 C-2,-13 -2,-7 0,-3Z" fill="#f5efe2" stroke="#2f3a48" stroke-width=".9" stroke-linejoin="round"/></g>`).join('')}</g>
  <circle r="3.4" fill="#f5efe2" stroke="#2f3a48" stroke-width=".9"/>
  <circle class="lamp" r="2" fill="#e8a44a" opacity="0"/>
  <g class="halo" opacity="0">${Array.from({ length: 12 }, (_, i) => `<circle cx="${Math.cos(i / 12 * TAU) * 23}" cy="${Math.sin(i / 12 * TAU) * 23}" r="1.1" fill="#c9a24e"/>`).join('')}</g>
</svg>`;
const MARKS = {
  windmill: '<svg viewBox="-10 -10 20 20" fill="none" stroke="#2f3a48" stroke-width="1.1" stroke-linecap="round"><path d="M-3,9 L-2,-1 L2,-1 L3,9 Z"/><path d="M0,-2 L-7,-8 M0,-2 L7,-8 M0,-2 L-6,4 M0,-2 L6,4"/></svg>',
  clock: '<svg viewBox="-10 -10 20 20" fill="none" stroke="#2f3a48" stroke-width="1.1" stroke-linecap="round"><path d="M-6,9 L-6,-3 L0,-9 L6,-3 L6,9 Z"/><circle cx="0" cy="1" r="3.4"/><path d="M0,1 L0,-1.2 M0,1 L1.6,1.8"/></svg>',
  daily: '<svg viewBox="-10 -10 20 20" fill="none" stroke="#2f3a48" stroke-width="1.1" stroke-linecap="round"><circle r="7"/><path d="M0,-7 L0,-9 M0,7 L0,9 M-7,0 L-9,0 M7,0 L9,0"/><circle r="2.2" fill="#d4664f" stroke="none"/></svg>',
  pause: '<svg viewBox="-10 -10 20 20" fill="none" stroke="#2f3a48" stroke-width="1.3" stroke-linecap="round"><circle r="8.2" stroke-opacity=".5" stroke-width=".8"/><path d="M-2.2,-3.6 L-2.2,3.6 M2.2,-3.6 L2.2,3.6"/></svg>'
};
