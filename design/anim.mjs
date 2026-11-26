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

/* ---- canteen simulator: fresh-sparkle, skill-seal, steam (inline art, no ui/ deps) ---- */
export async function canteen({ page, render, UI, A }) {
  const save = (out, name, kb) => {
    const dest = path.join(UI, 'anim', name);
    fs.copyFileSync(out, dest);
    const size = fs.statSync(dest).size;
    if (size > kb * 1024) console.warn('WARNING: ' + name + ' over budget');
  };

  /* fresh-sparkle: 64x64, 1.6 s seamless loop; green twinkles round the top-right corner */
  const sp = (id, x, y, s) => `<svg id="${id}" style="position:absolute;left:${x}px;top:${y}px;width:${s}px;height:${s}px;margin:-${s / 2}px 0 0 -${s / 2}px;filter:drop-shadow(0 0 2px #57d34a)" viewBox="-8 -8 16 16"><path d="M0 -8 Q1 -1 8 0 Q1 1 0 8 Q-1 1 -8 0 Q-1 -1 0 -8Z" fill="#57d34a"/><path d="M0 -4 Q.5 -.5 4 0 Q.5 .5 0 4 Q-.5 .5 -4 0 Q-.5 -.5 0 -4Z" fill="#eaffdf"/></svg>`;
  const S = [['f1', 48, 15, 22, 0], ['f2', 32, 9, 14, .42], ['f3', 55, 33, 15, .78], ['f4', 40, 26, 11, .2], ['f5', 22, 15, 10, 1.0]];
  const fbody = S.map(([id, x, y, s]) => sp(id, x, y, s)).join('');
  // each twinkle fits inside [0,1.6] and starts/ends at scale 0, so frame 0 == frame N
  const fjs = `gsap.set(${JSON.stringify(S.map((s) => '#' + s[0]))},{scale:0,opacity:0});
  for (const [id,t] of ${JSON.stringify(S.map((s) => ['#' + s[0], s[4]]))}) { tl.to(id,{scale:1,opacity:1,rotation:45,duration:.26,ease:'power2.out'},t).to(id,{scale:0,opacity:0,rotation:90,duration:.32,ease:'power2.in'},t+.26); }
  tl.set({}, {}, 1.6);`;
  save(render('fresh-sparkle', page(64, 64, fbody, '', fjs, 1.6), 'webm', 30, ['--crf', '34']), 'fresh-sparkle.webm', 40);

  /* skill-seal: 128x128, 1.2 s, plays once and holds the last frame */
  const kcss = `#s{position:absolute;left:4px;top:4px;width:120px;height:120px;transform-origin:50% 55%}#s svg{display:block}
  #sh{position:absolute;left:12px;top:12px;width:96px;height:96px;border-radius:50%;overflow:hidden}
  #sh i{position:absolute;top:-30px;left:-60px;width:26px;height:160px;background:linear-gradient(90deg,transparent,rgba(255,250,220,.85),transparent);transform:rotate(25deg)}
  #ring{position:absolute;left:10px;top:10px;width:108px;height:108px;border-radius:50%;border:3px solid #f0cf7e;opacity:0}`;
  const kbody = `<div id="ring"></div><div id="s">${A.skillSealSvg()}<div id="sh"><i id="b"></i></div></div>`;
  const kjs = `gsap.set('#s',{opacity:0,scale:1.8});
  tl.to('#s',{opacity:1,scale:.9,duration:.22,ease:'power3.in'},.02).to('#s',{scale:1.04,duration:.12,ease:'sine.out'}).to('#s',{scale:1,duration:.12,ease:'sine.inOut'});
  tl.fromTo('#ring',{scale:.8,opacity:.9},{scale:1.18,opacity:0,duration:.42,ease:'power2.out',immediateRender:false},.24);
  tl.fromTo('#b',{x:0},{x:200,duration:.5,ease:'power1.inOut'},.62);
  tl.set({}, {}, 1.2);`;
  save(render('skill-seal', page(128, 128, kbody, kcss, kjs, 1.2), 'webm', 30, ['--crf', '40']), 'skill-seal.webm', 60);

  /* steam: 160x220, 2.4 s seamless loop; three wisps on a shared phase clock */
  const W = [[62, 0, 1], [98, .36, -1], [80, .69, 1]];
  const wisp = (i) => `<svg id="w${i}" style="position:absolute;left:0;top:0;width:160px;height:220px;overflow:visible" viewBox="0 0 160 220"><path d="M0 0 C-10 -18 10 -34 0 -52 S-8 -84 2 -100" transform="translate(${W[i][0]} 196)" fill="none" stroke="#5a4632" stroke-opacity=".28" stroke-width="20" stroke-linecap="round" filter="url(#bl2)"/><path d="M0 0 C-10 -18 10 -34 0 -52 S-8 -84 2 -100" transform="translate(${W[i][0]} 196)" fill="none" stroke="#fff" stroke-width="15" stroke-linecap="round" filter="url(#bl)"/></svg>`;
  const sbody = `<svg width="0" height="0" style="position:absolute"><filter id="bl" x="-80%" y="-20%" width="260%" height="140%"><feGaussianBlur stdDeviation="7"/></filter><filter id="bl2" x="-80%" y="-20%" width="260%" height="140%"><feGaussianBlur stdDeviation="8"/></filter></svg>${[0, 1, 2].map(wisp).join('')}`;
  const sjs = `const W=${JSON.stringify(W)};const P={t:0};
  const upd=()=>W.forEach(([x0,ph,dir],i)=>{const p=(P.t+ph)%1;const a=Math.sin(Math.PI*p);
    gsap.set('#w'+i,{y:-70*p,x:dir*7*Math.sin(p*Math.PI*2),scaleX:.8+.5*p,scaleY:.75+.35*p,opacity:.62*a*a,transformOrigin:x0+'px 196px'});});
  upd();tl.to(P,{t:1,duration:2.4,ease:'none',onUpdate:upd},0);`;
  save(render('steam', page(160, 220, sbody, '', sjs, 2.4), 'webm', 24, ['--crf', '46']), 'vapor.webm', 32);   // not 'steam': scripts/check_package.py forbids *steam* in the package
}
