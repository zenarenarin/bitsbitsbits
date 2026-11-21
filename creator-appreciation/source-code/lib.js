// Shared renderers built from data sampled out of the real recordings.
const NS='http://www.w3.org/2000/svg';
function el(tag,attrs={},parent){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e}
// Plethora pixel wordmark, traced from the app boot animation (rec-D @3.5s).
function wordmark(u=8,color='#fff',withMark=true){
  const rows=WORDMARK.rows, w=rows[0].length, h=rows.length;
  const svg=el('svg',{width:(w+5)*u,height:h*u,viewBox:`0 0 ${(w+5)*u} ${h*u}`});
  rows.forEach((r,y)=>[...r].forEach((c,x)=>{if(c==='#')el('rect',{x:x*u,y:y*u,width:u+.4,height:u+.4,fill:color},svg)}));
  if(withMark){ // spectrum corner tick (approximation of the brag-card mark)
    const cols=['#e2483d','#f08a2c','#f2c94c','#5fb36b','#4a7fe0'];
    const x0=(w+1)*u, sw=u*0.6;
    cols.forEach((c,i)=>{el('rect',{x:x0+i*sw,y:-u*0.2,width:sw+.3,height:u*.9,fill:c},svg)});
    el('rect',{x:x0+4*sw,y:-u*0.2,width:sw+.3,height:u*2.2,fill:cols[4]},svg);
  }
  return svg;
}
// Hue tile board from sampled JSON. state: array of hex rows; fixed: bool rows
function hueBoard(parent,{x,y,tile,cols,rows,tiles,gap=0,dots=true,dotColor='rgba(20,20,24,.55)'}){
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const t=tiles[r][c];const d=document.createElement('div');
    d.style.cssText=`position:absolute;left:${x+c*(tile+gap)}px;top:${y+r*(tile+gap)}px;width:${tile+ (gap?0:.6)}px;height:${tile+(gap?0:.6)}px;background:${t.hex}`;
    if(dots&&t.fixed){const s=document.createElement('i');s.style.cssText=`position:absolute;left:50%;top:50%;width:${tile*.055}px;height:${tile*.055}px;margin:-${tile*.0275}px;border-radius:50%;background:${dotColor}`;d.appendChild(s)}
    parent.appendChild(d)}
}
// Build a legitimate mid-solve state: tiles whose solved slot satisfies pred() are home; others keep their scrambled order.
function midSolve(start,solved,pred){
  const R=start.length,C=start[0].length, out=start.map(r=>r.map(t=>({...t})));
  const pos={};solved.forEach((row,r)=>row.forEach((t,c)=>pos[t.hex]=[r,c]));
  // perform swaps: for each target slot in pred order, swap the right tile into it
  for(let r=0;r<R;r++)for(let c=0;c<C;c++){ if(!pred(r,c))continue;
    const want=solved[r][c].hex; let fr,fc;
    out.forEach((row,rr)=>row.forEach((t,cc)=>{if(t.hex===want){fr=rr;fc=cc}}));
    const tmp=out[r][c];out[r][c]=out[fr][fc];out[fr][fc]=tmp;}
  // keep fixed flags tied to solved slot
  const fixedSet=new Set();start.forEach(row=>row.forEach(t=>{if(t.fixed)fixedSet.add(t.hex)}));
  out.forEach(row=>row.forEach(t=>t.fixed=fixedSet.has(t.hex)));
  return out;
}
// Water Sort tube. segs bottom->top, names from PAL.watersort
const WS_SYMBOL={green:'◆',red:'●',blue:'▲',yellow:'■',cyan:'✕',pink:'▼',orange:'✚',purple:'✱'};
function tube(parent,{x,y,w,h,segs,cap=4,rim='#8b939b',glass='#161b26',symbols=true,lw=4}){
  const svg=el('svg',{width:w+lw*2,height:h+lw*2,style:`position:absolute;left:${x-lw}px;top:${y-lw}px;overflow:visible`});
  const r=w/2, segH=(h-w*.12)/cap;
  const id='c'+Math.random().toString(36).slice(2);
  const cp=el('clipPath',{id},el('defs',{},svg));
  const path=`M${lw},${lw} H${lw+w} V${lw+h-r} A${r},${r} 0 0 1 ${lw},${lw+h-r} Z`;
  el('path',{d:path},cp);
  el('path',{d:path,fill:glass},svg);
  const g=el('g',{'clip-path':`url(#${id})`},svg);
  segs.forEach((s,i)=>{const yy=lw+h-(i+1)*segH;el('rect',{x:lw,y:yy,width:w,height:segH+ (i===0?r:0)+.5,fill:PAL.watersort[s]},g);
    if(symbols){const t=el('text',{x:lw+w/2,y:yy+segH/2+(i===0?r*0.25:0),'text-anchor':'middle','dominant-baseline':'central','font-size':w*.16,fill:'rgba(0,0,0,.38)','font-family':'DejaVu Sans'},g);t.textContent=WS_SYMBOL[s]}});
  el('rect',{x:lw+w*.18,y:lw+w*.1,width:w*.1,height:h-r*1.1,rx:w*.05,fill:'rgba(255,255,255,.16)'},g);
  el('path',{d:path,fill:'none',stroke:rim,'stroke-width':lw},svg);
  parent.appendChild(svg);return svg;
}
// QTTT mark with subscript, in the game's UI face.
function qmark(parent,{x,y,size,ch,n,color,opacity=1,glow=false}){
  const d=document.createElement('div');
  d.style.cssText=`position:absolute;left:${x}px;top:${y}px;font-family:'Space Grotesk';font-weight:700;font-size:${size}px;line-height:1;color:${color};opacity:${opacity};${glow?`text-shadow:0 0 ${size*.25}px ${color}88`:''}`;
  d.innerHTML=`${ch}<span style="font-size:.42em;vertical-align:-.28em;margin-left:.02em">${n}</span>`;
  parent.appendChild(d);return d;
}
function piece(parent,{x,y,size,p,style=''}){const i=document.createElement('img');i.src=`assets/pieces/${p}.svg`;i.style.cssText=`position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size}px;${style}`;parent.appendChild(i);return i}
// HTML glass tube whose contents can be any game material. bands: bottom->top, each {h, html, bg}
function glassTube(parent,{x,y,w,h,rim='#8b939b',glass='rgba(24,29,39,.9)',lw=5,bands=[],lift=0,tilt=0,highlight=true}){
  const t=document.createElement('div');
  t.style.cssText=`position:absolute;left:${x}px;top:${y-lift}px;width:${w}px;height:${h}px;border:${lw}px solid ${rim};border-radius:${w*.09}px ${w*.09}px ${w/2}px ${w/2}px;overflow:hidden;background:${glass};transform:rotate(${tilt}deg);transform-origin:50% 0`;
  let acc=0; bands.forEach(b=>{const d=document.createElement('div');d.style.cssText=`position:absolute;left:0;right:0;bottom:${acc}px;height:${b.h+.5}px;background:${b.bg||'transparent'};display:flex;align-items:center;justify-content:center;overflow:hidden`;if(b.html)d.innerHTML=b.html;t.appendChild(d);acc+=b.h});
  if(highlight){const s=document.createElement('i');s.style.cssText=`position:absolute;left:${w*.15}px;top:${w*.12}px;width:${w*.09}px;bottom:${w*.42}px;border-radius:${w}px;background:rgba(255,255,255,.2)`;t.appendChild(s)}
  parent.appendChild(t);return t;
}
function qhtml(ch,n,size,color){return `<span style="font-family:'Space Grotesk';font-weight:700;font-size:${size}px;line-height:1;color:${color}">${ch}<span style="font-size:.42em;vertical-align:-.28em">${n}</span></span>`}
