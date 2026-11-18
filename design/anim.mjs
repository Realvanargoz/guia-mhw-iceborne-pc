import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, render, UI, WORK }) {
  fs.cpSync(UI, path.join(WORK, 'ui'), { recursive: true });
  const save = (out, name, kb) => {
    const dest = path.join(UI, 'anim', name);
    fs.copyFileSync(out, dest);
    const size = fs.statSync(dest).size;
    console.log(name, size, 'bytes');
    if (size > kb * 1024) console.warn('WARNING: ' + name + ' over budget');
  };

  /* ---- page-turn: 480x320, 2.6 s ---- */
  const lines = 'repeating-linear-gradient(to bottom,transparent 0 17px,rgba(59,39,23,.22) 17px 18px)';
  const face = (extra = '') => `position:absolute;inset:0;background:url(ui/parchment.webp) ${extra};backface-visibility:hidden;-webkit-backface-visibility:hidden;border:2px solid #4b2b1f;border-radius:2px 6px 6px 2px;`;
  const css = `
  #stage{position:absolute;inset:0;perspective:1300px;perspective-origin:50% 40%}
  .pg{position:absolute;top:22px;width:200px;height:276px}
  #L{left:40px}#R{left:240px}
  .pg>.bg{position:absolute;inset:0;background:url(ui/parchment.webp);border:2px solid #4b2b1f}
  #L>.bg{border-radius:6px 2px 2px 6px;background-position:100px 40px}#R>.bg{border-radius:2px 6px 6px 2px}
  .ln{position:absolute;left:22px;right:22px;top:30px;bottom:30px;background:${lines}}
  .sp-r{position:absolute;inset:0;background:linear-gradient(to right,rgba(32,24,8,.55),rgba(32,24,8,0) 26%)}
  .sp-l{position:absolute;inset:0;background:linear-gradient(to left,rgba(32,24,8,.55),rgba(32,24,8,0) 26%)}
  #leaf{position:absolute;left:240px;top:22px;width:200px;height:276px;transform-style:preserve-3d;transform-origin:0% 50%}
  #front{${face('')}}#back{${face('-120px 0')}transform:rotateY(180deg)}
  #shF,#shB{position:absolute;inset:0;background:#201808;opacity:0}
  #spine{position:absolute;left:236px;top:20px;width:8px;height:280px;background:linear-gradient(to right,#201808,#4b2b1f 50%,#201808);border-radius:2px}
  #ground{position:absolute;left:34px;top:300px;width:412px;height:10px;background:radial-gradient(ellipse at center,rgba(0,0,0,.4),transparent 70%)}`;
  const body = `<div id="stage"><div id="ground"></div>
  <div class="pg" id="L"><div class="bg"><div class="ln"></div><div class="sp-l"></div></div></div>
  <div class="pg" id="R"><div class="bg"><div class="ln" style="top:44px"></div><div class="sp-r"></div></div></div>
  <div id="spine"></div>
  <div id="leaf"><div id="front"><div class="ln"></div><div class="sp-r"></div><div id="shF"></div></div><div id="back"><div class="ln" style="top:44px"></div><div class="sp-l"></div><div id="shB"></div></div></div></div>`;
  const js = `gsap.set('#leaf',{rotationY:0});gsap.set('#root',{opacity:0});
  tl.to('#root',{opacity:1,duration:.3,ease:'none'},0);
  tl.to('#leaf',{rotationY:-180,duration:1.3,ease:'power2.inOut'},.35);
  tl.to('#shF',{opacity:.35,duration:.65,ease:'sine.in'},.35).to('#shF',{opacity:0,duration:.01},1);
  tl.to('#shB',{opacity:.35,duration:.01},.35).to('#shB',{opacity:0,duration:.65,ease:'sine.out'},1);
  tl.to('#root',{opacity:0,duration:.4,ease:'none'},2.2);`;
  save(render('page-turn', page(480, 320, body, css, js, 2.6), 'webm', 24, ['--crf', '36']), 'page-turn.webm', 300);

  /* ---- crown-shine: 96x96, 2 s ---- */
  const spark = (x, y, id) => `<svg id="${id}" style="position:absolute;left:${x}px;top:${y}px;width:16px;height:16px;margin:-8px 0 0 -8px;opacity:0" viewBox="-8 -8 16 16"><path d="M0 -8 Q.9 -.9 8 0 Q.9 .9 0 8 Q-.9 .9 -8 0 Q-.9 -.9 0 -8Z" fill="#fffbe0"/></svg>`;
  const ccss = `#c{position:absolute;left:8px;top:10px;width:80px;height:80px;transform-origin:50% 90%}
  #c img{width:100%;height:100%;display:block}
  #g{position:absolute;inset:0;-webkit-mask:url(ui/crown-gold.svg) center/contain no-repeat;mask:url(ui/crown-gold.svg) center/contain no-repeat;overflow:hidden}
  #g i{position:absolute;top:-20px;left:-50px;width:26px;height:120px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.95),transparent);transform:rotate(25deg)}`;
  const cbody = `<div id="c"><img src="ui/crown-gold.svg"><div id="g"><i id="band"></i></div></div>${spark(24, 22, 's1')}${spark(74, 18, 's2')}${spark(50, 8, 's3')}`;
  const cjs = `gsap.set(['#s1','#s2','#s3'],{scale:0,opacity:0});
  tl.fromTo('#band',{x:0},{x:150,duration:.7,ease:'power1.inOut'},.45);
  tl.fromTo('#c',{scale:1},{scale:1.06,duration:.35,yoyo:true,repeat:1,ease:'sine.inOut'},.45);
  for (const [id,t] of [['#s1',.6],['#s3',.8],['#s2',1]]) { tl.to(id,{scale:1,opacity:1,rotation:45,duration:.18,ease:'power2.out'},t).to(id,{scale:0,opacity:0,rotation:90,duration:.22,ease:'power2.in'},t+.18); }`;
  save(render('crown-shine', page(96, 96, cbody, ccss, cjs, 2), 'webm', 30, ['--crf', '34']), 'crown-shine.webm', 300);

  /* ---- fest-seal: 160x160, 2.4 s ---- */
  const scss = `#s{position:absolute;inset:0;transform-origin:50% 55%}#s img{width:160px;height:160px;display:block}
  #sh{position:absolute;inset:0;-webkit-mask:url(ui/fest-appreciation.png) center/contain no-repeat;mask:url(ui/fest-appreciation.png) center/contain no-repeat;overflow:hidden}
  #sh i{position:absolute;top:-30px;left:-70px;width:34px;height:220px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent);transform:rotate(25deg)}
  #ring{position:absolute;left:10px;top:10px;width:140px;height:140px;border-radius:50%;border:3px solid #d38ec0;opacity:0}`;
  const sbody = `<div id="ring"></div><div id="s"><img src="ui/fest-appreciation.png"><div id="sh"><i id="b2"></i></div></div>`;
  const sjs = `gsap.set('#s',{opacity:0,scale:1.7});
  tl.to('#s',{opacity:1,scale:.9,duration:.22,ease:'power3.in'},.1).to('#s',{scale:1.03,duration:.14,ease:'sine.out'}).to('#s',{scale:1,duration:.14,ease:'sine.inOut'});
  tl.fromTo('#ring',{scale:.8,opacity:.8},{scale:1.12,opacity:0,duration:.5,ease:'power2.out'},.32);
  tl.fromTo('#b2',{x:0},{x:230,duration:.8,ease:'power1.inOut'},1.0);
  tl.to('#s',{opacity:0,duration:.35,ease:'none'},2.0);`;
  save(render('fest-seal', page(160, 160, sbody, scss, sjs, 2.4), 'webm', 30, ['--crf', '36']), 'fest-seal.webm', 300);
}
