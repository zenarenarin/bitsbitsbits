// usage: node render.js in.html out.png [w h]
const {chromium}=require('playwright');const path=require('path');
(async()=>{const [,,inp,out,w=1080,h=1350]=process.argv;const b=await chromium.launch();
const p=await b.newPage({viewport:{width:+w,height:+h},deviceScaleFactor:1});
await p.goto('file://'+path.resolve(inp));await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);
await p.screenshot({path:out});await b.close()})();
