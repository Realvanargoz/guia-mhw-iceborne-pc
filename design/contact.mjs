export default async function ({ page, render, ff, UI, WORK, OUT, fs, path }) {
  const u = (n) => 'ui/' + n;
  fs.cpSync(UI, path.join(WORK, 'ui'), { recursive: true });
  const icons = ['star.svg', 'star-empty.svg', 'crown-mini.svg', 'crown-silver.svg', 'crown-gold.svg', 'gem.svg', 'gem-active.svg'];
  const branches = ['courage', 'resilience', 'vigor', 'acumen', 'artillery', 'perception', 'fortune', 'preparation', 'trailblazer'];
  const seals = ['spring', 'summer', 'autumn', 'winter', 'appreciation'].map((k) => `fest-${k}.png`);
  const panel = (cls) => `<div class="p ${cls}">
  <div class="row"><div class="tile" style="background-image:url(${u('parchment.webp')})"></div><div class="tile" style="background-image:url(${u('parchment-dark.webp')})"></div><div class="tile" style="background-image:url(${u('wood.webp')})"></div></div>
  <div class="row"><img src="${u('corner.png')}"><img src="${u('corner.png')}" style="transform:scaleX(-1)"><img src="${u('ribbon.png')}"><div class="hf"><span>H&aacute;bitats</span></div><div><img class="tb" src="${u('tab.png')}"><img class="tb" src="${u('tab-active.png')}"></div></div>
  <div class="row"><img src="${u('divider.png')}"></div>
  <div class="row"><div class="tile" style="width:280px;height:150px;background-size:256px;background-image:url(${u('parchment.webp')})"></div><div class="tile" style="width:280px;height:150px;background-size:256px;background-image:url(${u('parchment-dark.webp')})"></div><div class="tile" style="width:280px;height:150px;background-size:256px;background-image:url(${u('wood.webp')})"></div></div>
  <div class="row"><img src="${u('canteen/table.webp')}" style="width:176px"><img src="${u('canteen/plate.webp')}" style="width:110px">${branches.map((b) => `<i class="br" style="-webkit-mask-image:url(${u('canteen/branch-' + b + '.svg')})"></i>`).join('')}</div>
  <div class="row">${icons.map((i) => `<img class="ic" src="${u(i)}">`).join('')}${seals.map((i) => `<img src="${u(i)}" style="width:84px">`).join('')}</div></div>`;
  const css = `body{background:#555}.wrap{display:flex;width:1800px;height:1000px}.p{width:900px;padding:14px;display:flex;flex-direction:column;gap:12px}
.dark{background:#201808}.par{background:#d9c296}.row{display:flex;gap:14px;align-items:center}.tile{width:260px;height:200px;background-size:512px;background-position:0 0;outline:1px solid #f0f}
.ic{width:56px;height:56px}.br{display:block;width:32px;height:32px;background:#d8b25a;-webkit-mask-size:contain}.par .br{background:#3b2717}.hf{width:300px;height:64px;border-style:solid;border-width:24px 48px;border-image:url(${u('header-frame.png')}) 24 48 fill/24px 48px stretch;display:flex;align-items:center;justify-content:center;color:#f0dcae;font:700 20px serif}.hf span{margin:-8px 0}.tb{width:180px;display:block}`;
  const html = page(1800, 1000, `<div class="wrap">${panel('dark')}${panel('par')}</div>`, css);
  const out = render('contact', html, 'png-sequence', 1);
  ff('-i', path.join(out, 'frame_000001.png'), path.join(OUT, 'contact.png'));
}
