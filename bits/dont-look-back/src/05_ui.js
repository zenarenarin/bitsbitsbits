// Interface: restrained type, small marks, muted colour.
const SAVE_KEY = 'dlb_save_v1';
const defaultSave = () => ({ best: 0, runs: 0, tut: 0 });
const UI_CSS = `
.dl{position:absolute;inset:0;font-family:'Nunito Sans',system-ui,sans-serif;color:#dfe4f4;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--moon:#dfe4f4;--amber:#ffb766;--dim:rgba(223,228,244,.55);--ink:#07080f}
.dl *{box-sizing:border-box}
.dl-vig{position:absolute;inset:0;background:radial-gradient(ellipse 75% 62% at 50% 46%,rgba(4,5,12,0) 38%,rgba(4,5,12,.55) 78%,rgba(2,2,6,.92) 100%);transition:opacity .25s}
.dl-danger{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse 70% 58% at 50% 48%,rgba(10,4,14,0) 30%,rgba(14,5,18,.75) 80%,rgba(4,1,6,.98) 100%)}
.dl-grain{position:absolute;inset:-50%;opacity:.07;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>");animation:dlg 1s steps(6) infinite}
@keyframes dlg{0%{transform:translate(0,0)}20%{transform:translate(-6%,4%)}40%{transform:translate(5%,-7%)}60%{transform:translate(-3%,8%)}80%{transform:translate(7%,2%)}100%{transform:translate(0,0)}}
.dl-top{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:flex-start;padding:16px;transition:opacity .6s}
.dl-dist{font:400 34px/1 'DM Serif Display',Georgia,serif;letter-spacing:.01em;text-shadow:0 2px 14px rgba(0,0,0,.7)}
.dl-dist small{font-size:15px;margin-left:3px;opacity:.6}
.dl-best{margin-top:6px;font:700 10px 'Nunito Sans',system-ui,sans-serif;letter-spacing:.26em;color:var(--dim)}
.dl-pause{pointer-events:auto;width:40px;height:40px;border-radius:50%;border:1px solid rgba(223,228,244,.32);background:rgba(7,8,15,.25);display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:none}
.dl-pause svg{width:14px;height:14px}
.dl-bottom{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;padding-bottom:28px;transition:opacity .6s}
.dl-ctx{height:20px;margin-bottom:12px;font:700 12px/20px 'Nunito Sans',system-ui,sans-serif;letter-spacing:.46em;padding-left:.46em;opacity:0;transition:opacity .25s,color .25s;text-shadow:0 0 14px rgba(0,0,0,.9)}
.dl-ctx.hide{color:var(--amber);text-shadow:0 0 16px rgba(255,170,90,.45)}
.dl-ctx.ex{color:#c99aa6}
.dl-ctx.run{color:var(--moon)}
.dl-bar{position:relative;width:min(48vw,230px);height:3px;border-radius:2px;background:rgba(223,228,244,.13);overflow:hidden}
.dl-bar b{position:absolute;left:0;top:0;bottom:0;width:100%;background:var(--moon);transform-origin:0 50%;border-radius:2px;transition:background .3s}
.dl-bar.low b{background:#e2ac72}
.dl-bar.ex b{background:#a87a88;animation:dlp .6s ease-in-out infinite alternate}
@keyframes dlp{from{opacity:.35}to{opacity:1}}
.dl-barl{margin-top:8px;font:700 9px 'Nunito Sans',sans-serif;letter-spacing:.32em;color:rgba(223,228,244,.38)}
.dl-stage{position:absolute;left:0;right:0;top:24%;text-align:center;font:italic 400 24px 'DM Serif Display',Georgia,serif;letter-spacing:.06em;opacity:0;transition:opacity 1.6s;text-shadow:0 2px 20px rgba(0,0,0,.9)}
.dl-stage small{display:block;margin-bottom:8px;font:700 9px 'Nunito Sans',sans-serif;letter-spacing:.4em;font-style:normal;color:var(--dim)}
.dl-hint{position:absolute;right:16px;bottom:96px;width:132px;display:flex;flex-direction:column;align-items:center;opacity:0;transition:opacity .5s}
.dl-hint i{width:54px;height:54px;border-radius:50%;border:1.5px solid rgba(223,228,244,.7);animation:dlr 1.6s ease-out infinite}
@keyframes dlr{0%{transform:scale(.7);opacity:.9}100%{transform:scale(1.25);opacity:0}}
.dl-hint span{margin-top:12px;font:700 10px/1.6 'Nunito Sans',sans-serif;letter-spacing:.26em;text-align:center;color:var(--moon);text-shadow:0 0 10px #000}
.dl-hint.c{left:0;right:0;width:auto;bottom:130px}
.dl-hint.c i{display:none}
.dl-fade{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .6s}
.dl-eyes{position:absolute;left:50%;top:22%;transform:translate(-50%,-50%);display:flex;gap:26px;opacity:0;transition:opacity 1.2s}
.dl-eyes b{width:7px;height:5px;border-radius:50%;background:#ffd59c;box-shadow:0 0 10px 3px rgba(255,170,80,.75),0 0 40px 10px rgba(255,140,60,.25)}
.dl-eyes b:last-child{transform:translateY(-2px)}
.dl-title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;padding:16px;transition:opacity .9s}
.dl-title.off{opacity:0}
.dl-logo{margin-top:15vh;font:400 44px/1 'DM Serif Display',Georgia,serif;letter-spacing:.08em;text-shadow:0 4px 30px rgba(0,0,0,.9)}
.dl-logo span{display:block;font-size:.5em;letter-spacing:.42em;margin-bottom:10px;padding-left:.42em;color:var(--dim)}
.dl-sub{margin-top:14px;font:italic 400 17px 'DM Serif Display',Georgia,serif;color:rgba(223,228,244,.72);letter-spacing:.03em}
.dl-tap{font:700 11px 'Nunito Sans',sans-serif;letter-spacing:.5em;padding-left:.5em;animation:dlp 1.4s ease-in-out infinite alternate}
.dl-foot{margin-bottom:28px;display:flex;flex-direction:column;align-items:center;gap:18px}
.dl-tb{font:700 10px 'Nunito Sans',sans-serif;letter-spacing:.3em;color:var(--dim)}
.dl-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:16px;pointer-events:auto}
.dl-panel.on{display:flex}
.dl-panel.pz{background:rgba(5,6,14,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.dl-h{font:400 30px/1.1 'DM Serif Display',Georgia,serif;letter-spacing:.04em;margin-bottom:22px}
.dl-stats{font:700 11px/2.1 'Nunito Sans',sans-serif;letter-spacing:.3em;color:var(--dim)}
.dl-stats b{color:var(--moon);font-weight:700}
.dl-new{margin-top:6px;font:700 10px 'Nunito Sans',sans-serif;letter-spacing:.34em;color:var(--amber);min-height:14px}
.dl-btns{margin-top:30px;display:flex;flex-direction:column;gap:10px;width:min(72vw,260px)}
.dl-b{pointer-events:auto;cursor:pointer;border:1px solid rgba(223,228,244,.35);background:rgba(223,228,244,.04);color:var(--moon);border-radius:2px;padding:14px 10px;font:700 11px 'Nunito Sans',sans-serif;letter-spacing:.34em;touch-action:manipulation}
.dl-b.pri{background:var(--moon);color:var(--ink);border-color:var(--moon)}
.dl-over{opacity:0;transition:opacity .8s}
.dl-over.show{opacity:1}
.dl-err{position:absolute;left:16px;right:16px;bottom:30%;text-align:center;font:400 16px/1.5 'DM Serif Display',Georgia,serif}
`;
const ICON_PAUSE = '<svg viewBox="-10 -10 20 20"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
