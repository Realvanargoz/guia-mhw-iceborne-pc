// Original vector art for the "Hunter's Notes" UI kit. Everything here is drawn from scratch
// (parametric SVG); nothing is traced from or copied out of any game asset.

export const C = {
  parch: '#d9c296', parch2: '#be955c', parchAged: '#a07c57',
  ink: '#3b2717', ink2: '#503628',
  wood: '#201808', frame: '#4b2b1f',
  gold: '#d8b25a', ribbon: '#a32a1f', research: '#f29500',
  star: '#eaa62e', gem: '#00d7e2', weak: '#ba613e', select: '#57d34a',
};

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const f = (n) => +n.toFixed(2);

// deterministic PRNG so renders are reproducible
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ------------------------------------------------------------------ textures */

function ramp(a, b) {
  // feComponentTransfer table from colour a to colour b (hex)
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const A = p(a), B = p(b);
  return `<feFuncR type="table" tableValues="${f(A[0])} ${f(B[0])}"/><feFuncG type="table" tableValues="${f(A[1])} ${f(B[1])}"/><feFuncB type="table" tableValues="${f(A[2])} ${f(B[2])}"/><feFuncA type="table" tableValues="1 1"/>`;
}
const gray = (k, off) => `<feColorMatrix type="matrix" values="${k} 0 0 0 ${off}  ${k} 0 0 0 ${off}  ${k} 0 0 0 ${off}  0 0 0 0 1"/>`;
const FR = 'x="0" y="0" width="512" height="512" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"';

// tileable blob list: each blob is repeated at +-512 so the tile wraps
function stains(seed, n, color, aMin, aMax, rMin, rMax) {
  const r = rng(seed); let out = '';
  for (let i = 0; i < n; i++) {
    const x = r() * 512, y = r() * 512, rad = rMin + r() * (rMax - rMin), a = aMin + r() * (aMax - aMin);
    const sx = 0.7 + r() * 0.6;
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      const cx = x + dx, cy = y + dy;
      if (cx + rad * sx < 0 || cx - rad * sx > 512 || cy + rad < 0 || cy - rad > 512) continue;
      out += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rad * sx)}" ry="${f(rad)}" fill="url(#st)" opacity="${f(a)}" style="--c:${color}"/>`;
    }
  }
  return out;
}
function specks(seed, n, color, aMax) {
  const r = rng(seed); let out = '';
  for (let i = 0; i < n; i++) {
    const x = r() * 512, y = r() * 512, rad = 0.4 + r() * 1.3;
    out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="${color}" opacity="${f(0.15 + r() * aMax)}"/>`;
  }
  return out;
}

export function parchmentSvg(dark) {
  const lo = dark ? '#977250' : '#cfae7c', hi = dark ? '#c9a472' : '#e6d5aa';
  const stainCol = dark ? '#5a3a1f' : '#8a6234';
  const s = (c) => `<radialGradient id="st-${c.slice(1)}"><stop offset="0" stop-color="${c}" stop-opacity=".55"/><stop offset=".6" stop-color="${c}" stop-opacity=".18"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
  const stainsSvg = (seed, n, col, a0, a1, r0, r1) => stains(seed, n, col, a0, a1, r0, r1).replaceAll('url(#st)', `url(#st-${col.slice(1)})`).replace(/ style="[^"]*"/g, '');
  return `<svg ${NS} width="512" height="512" viewBox="0 0 512 512"><defs>
<filter id="mott" ${FR}><feTurbulence type="fractalNoise" baseFrequency="0.0078 0.0078" numOctaves="4" seed="${dark ? 11 : 5}" stitchTiles="stitch"/>${gray(2.6, -0.8)}<feComponentTransfer>${ramp(lo, hi)}</feComponentTransfer></filter>
<filter id="cloud" ${FR}><feTurbulence type="fractalNoise" baseFrequency="0.02 0.016" numOctaves="3" seed="${dark ? 3 : 21}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 .33  0 0 0 0 .2  0 0 0 0 .08  ${dark ? 2.2 : 1.7} 0 0 0 ${dark ? -.82 : -.62}"/></filter>
<filter id="fibV" ${FR}><feTurbulence type="fractalNoise" baseFrequency="0.9 0.035" numOctaves="2" seed="9" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 .3  0 0 0 0 .19  0 0 0 0 .08  3.2 0 0 0 -1.62"/></filter>
<filter id="fibH" ${FR}><feTurbulence type="fractalNoise" baseFrequency="0.03 0.8" numOctaves="2" seed="14" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 .98  0 0 0 0 .9  0 0 0 0 .7  3.2 0 0 0 -1.78"/></filter>
<filter id="grain" ${FR}><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 .2  0 0 0 0 .12  0 0 0 0 .05  0 0 0 1.6 -.55"/></filter>
${s(stainCol)}${s('#6a4524')}
</defs>
<rect width="512" height="512" filter="url(#mott)"/>
<rect width="512" height="512" filter="url(#cloud)" opacity="${dark ? 0.7 : 0.3}"/>
<rect width="512" height="512" filter="url(#fibV)" opacity=".2"/>
<rect width="512" height="512" filter="url(#fibH)" opacity=".14"/>
${stainsSvg(dark ? 31 : 7, dark ? 11 : 5, stainCol, 0.2, dark ? 0.6 : 0.35, 30, dark ? 90 : 70)}
${stainsSvg(dark ? 77 : 41, dark ? 5 : 3, '#6a4524', 0.15, 0.35, 10, 26)}
${specks(dark ? 5 : 15, dark ? 90 : 55, '#4a2f16', 0.35)}
<rect width="512" height="512" filter="url(#grain)" opacity=".35"/>
</svg>`;
}

export function woodSvg() {
  return `<svg ${NS} width="512" height="512" viewBox="0 0 512 512"><defs>
<filter id="g1" ${FR}><feTurbulence type="fractalNoise" baseFrequency="0.0035 0.085" numOctaves="5" seed="4" stitchTiles="stitch"/>${gray(2.1, -0.42)}<feComponentTransfer>${ramp('#140d04', '#4f2f1f')}</feComponentTransfer></filter>
<filter id="g2" ${FR}><feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="3" seed="8" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 .02  0 0 0 0 .01  0 0 0 0 0  1.8 0 0 0 -.5"/></filter>
<filter id="g3" ${FR}><feTurbulence type="fractalNoise" baseFrequency="0.05 0.55" numOctaves="2" seed="19" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 .02  0 0 0 0 .01  0 0 0 0 0  3 0 0 0 -1.5"/></filter>
<filter id="g4" ${FR}><feTurbulence type="fractalNoise" baseFrequency="0.0045 0.2" numOctaves="3" seed="27" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 .75  0 0 0 0 .5  0 0 0 0 .3  2.4 0 0 0 -1.35"/></filter>
<clipPath id="pl2"><rect x="0" y="256" width="512" height="256"/></clipPath>
</defs>
<rect width="512" height="512" filter="url(#g1)"/>
<rect width="512" height="512" filter="url(#g2)" opacity=".6"/>
<rect width="512" height="512" filter="url(#g4)" opacity=".16"/>
<rect width="512" height="512" filter="url(#g3)" opacity=".5"/>
<rect y="256" width="512" height="256" fill="#3a2010" opacity=".16"/>
<rect y="0" width="512" height="3" fill="#0c0702" opacity=".9"/><rect y="3" width="512" height="1.5" fill="#6a4228" opacity=".25"/>
<rect y="509" width="512" height="3" fill="#0c0702" opacity=".9"/>
<rect y="254" width="512" height="3" fill="#0c0702" opacity=".9"/><rect y="257" width="512" height="1.5" fill="#6a4228" opacity=".25"/>
</svg>`;
}

/* ------------------------------------------------------------------ ornaments */

const GOLD_DEFS = `<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dc92"/><stop offset=".5" stop-color="#d8b25a"/><stop offset="1" stop-color="#9c7326"/></linearGradient>`;
const dual = (d, w, o = 3, outline = '#1b1006', fill = 'url(#gold)') =>
  `<path d="${d}" fill="none" stroke="${outline}" stroke-width="${w + o}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

export function cornerSvg() {
  return `<svg ${NS} width="128" height="128" viewBox="0 0 128 128"><defs>${GOLD_DEFS}
<filter id="sh" x="-10%" y="-10%" width="130%" height="130%"><feDropShadow dx="1" dy="1.5" stdDeviation="1.2" flood-color="#000" flood-opacity=".4"/></filter></defs>
<g filter="url(#sh)">
${dual('M7 122 V32 C7 18 18 7 32 7 H122', 4)}
${dual('M17 96 V37 C17 26 26 17 37 17 H96', 1.6, 2)}
${dual('M30 30 C35 22 52 24 52 37 C52 49 36 52 31 41 C28 33 37 28 42 34', 2.6)}
${dual('M58 17 C63 28 74 28 78 17', 1.8, 2.2)}
${dual('M17 58 C28 63 28 74 17 78', 1.8, 2.2)}
${dual('M52 52 C64 54 72 66 66 78 C80 72 82 56 70 46', 2.4)}
${dual('M96 17 C100 12 108 12 112 17', 1.6, 2.2)}
${dual('M17 96 C12 100 12 108 17 112', 1.6, 2.2)}
<circle cx="122" cy="7" r="4.2" fill="#1b1006"/><circle cx="122" cy="7" r="2.8" fill="url(#gold)"/>
<circle cx="7" cy="122" r="4.2" fill="#1b1006"/><circle cx="7" cy="122" r="2.8" fill="url(#gold)"/>
<path d="M7 0 L14 7 L7 14 L0 7Z" fill="#1b1006"/><path d="M7 2.4 L11.6 7 L7 11.6 L2.4 7Z" fill="url(#gold)"/>
<circle cx="41" cy="38" r="2.2" fill="#1b1006"/>
</g></svg>`;
}

export function dividerSvg() {
  const half = `
<path d="M8 16 Q140 11.6 262 15 L262 17 Q140 20.4 8 16Z" fill="#4b2b1f"/>
<path d="M30 16 Q140 14.2 258 15.6" fill="none" stroke="#8a6a35" stroke-width=".8" opacity=".8"/>
<path d="M262 16 C274 16 276 7.5 285 7.5 C293 7.5 294 14.5 288.5 15 M262 16 C274 16 276 24.5 285 24.5 C293 24.5 294 17.5 288.5 17" fill="none" stroke="#1b1006" stroke-width="4.2" stroke-linecap="round"/>
<path d="M262 16 C274 16 276 7.5 285 7.5 C293 7.5 294 14.5 288.5 15 M262 16 C274 16 276 24.5 285 24.5 C293 24.5 294 17.5 288.5 17" fill="none" stroke="url(#gold)" stroke-width="2.2" stroke-linecap="round"/>
<path d="M80 16 l4 -4 l4 4 l-4 4z M140 16 l3 -3 l3 3 l-3 3z" fill="#4b2b1f"/>
<circle cx="14" cy="16" r="2.4" fill="#4b2b1f"/>
<path d="M200 16 C204 11 210 11 212 16 C210 21 204 21 200 16Z" fill="none" stroke="#4b2b1f" stroke-width="1.3"/>`;
  return `<svg ${NS} width="640" height="32" viewBox="0 0 640 32"><defs>${GOLD_DEFS}</defs>
<g>${half}</g><g transform="translate(640 0) scale(-1 1)">${half}</g>
<path d="M320 3 L333 16 L320 29 L307 16Z" fill="#1b1006"/><path d="M320 6 L330 16 L320 26 L310 16Z" fill="url(#gold)"/>
<path d="M320 10 L326 16 L320 22 L314 16Z" fill="#7d1f16"/><path d="M320 10 L326 16 L320 16Z" fill="#c24433" opacity=".7"/>
</svg>`;
}

// 600x64. 9-slice insets: top/bottom 24, left/right 48 (middle column/row uniform)
export function headerFrameSvg() {
  const plate = 'M10 2 H590 A8 8 0 0 0 598 10 V54 A8 8 0 0 0 590 62 H10 A8 8 0 0 0 2 54 V10 A8 8 0 0 0 10 2Z';
  const inner = 'M13 7 H587 A4 4 0 0 0 593 13 V51 A4 4 0 0 0 587 57 H13 A4 4 0 0 0 7 51 V13 A4 4 0 0 0 13 7Z';
  const cap = `
<path d="M42 32 C36 32 35 23 27 23 C19 23 15 31 19 37 C22 41 29 40 29 35 C29 32 25 31 24 34" fill="none" stroke="#120a03" stroke-width="4.4" stroke-linecap="round"/>
<path d="M42 32 C36 32 35 23 27 23 C19 23 15 31 19 37 C22 41 29 40 29 35 C29 32 25 31 24 34" fill="none" stroke="url(#gold)" stroke-width="2.2" stroke-linecap="round"/>
<path d="M42 32 C37 32 35 41 29 43" fill="none" stroke="#120a03" stroke-width="3.6" stroke-linecap="round"/>
<path d="M42 32 C37 32 35 41 29 43" fill="none" stroke="url(#gold)" stroke-width="1.6" stroke-linecap="round"/>
<path d="M13 32 L18 27 L23 32 L18 37Z" fill="#120a03"/><path d="M13 32 L18 28 L22 32 L18 36Z" fill="none"/>`;
  return `<svg ${NS} width="600" height="64" viewBox="0 0 600 64"><defs>${GOLD_DEFS}
<linearGradient id="pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3624"/><stop offset=".08" stop-color="#40261a"/><stop offset=".5" stop-color="#2b190d"/><stop offset=".92" stop-color="#1e1108"/><stop offset="1" stop-color="#150c05"/></linearGradient>
<linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".16"/><stop offset=".5" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<filter id="sh" x="-2%" y="-10%" width="104%" height="130%"><feDropShadow dx="0" dy="1.4" stdDeviation="1.1" flood-color="#000" flood-opacity=".5"/></filter></defs>
<g filter="url(#sh)">
<path d="${plate}" fill="#120a03"/>
<path d="${plate}" fill="url(#pl)" stroke="url(#gold)" stroke-width="2.2"/>
<path d="${inner}" fill="none" stroke="#120a03" stroke-width="2.4"/>
<path d="${inner}" fill="none" stroke="#a37b33" stroke-width="1"/>
<path d="M12 9 H588" stroke="url(#gl)" stroke-width="10" opacity=".55"/>
<path d="M12 56.5 H588" stroke="#000" stroke-opacity=".35" stroke-width="1.5"/>
${cap}
<g transform="translate(600 0) scale(-1 1)">${cap}</g>
<g fill="url(#gold)" stroke="#120a03" stroke-width=".9"><circle cx="6" cy="6" r="1.6"/><circle cx="594" cy="6" r="1.6"/><circle cx="6" cy="58" r="1.6"/><circle cx="594" cy="58" r="1.6"/></g>
</g></svg>`;
}

// 360x56. 9-slice insets: 20 all round
export function tabSvg(active) {
  const d = 'M1 56 V19 C1 9 8 2 18 2 H342 C352 2 359 9 359 19 V56Z';
  const di = 'M5 56 V20 C5 12 11 6 19 6 H341 C349 6 355 12 355 20 V56';
  const defs = active
    ? `<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4d884"/><stop offset=".35" stop-color="#d8b25a"/><stop offset="1" stop-color="#b98c35"/></linearGradient>`
    : `<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a2c1d"/><stop offset=".4" stop-color="#34201a"/><stop offset="1" stop-color="#1c1208"/></linearGradient>`;
  return `<svg ${NS} width="360" height="56" viewBox="0 0 360 56"><defs>${defs}${GOLD_DEFS}
<filter id="sh" x="-3%" y="-20%" width="106%" height="130%"><feDropShadow dx="0" dy="-0.5" stdDeviation="1" flood-color="#000" flood-opacity=".45"/></filter></defs>
<g filter="url(#sh)">
<path d="${d}" fill="url(#t)" stroke="${active ? '#2a1a0a' : '#0f0a04'}" stroke-width="2"/>
<path d="${di}" fill="none" stroke="${active ? '#fff2c2' : '#7a5232'}" stroke-opacity="${active ? 0.75 : 0.55}" stroke-width="1.2"/>
<path d="M9 8 H351" stroke="#fff" stroke-opacity="${active ? 0.22 : 0.07}" stroke-width="5"/>
${active ? '<path d="M4 56 V20 C4 11 10 5 19 5" fill="none" stroke="#7a5516" stroke-opacity=".6" stroke-width="1"/>' : '<path d="M1 55 H359" stroke="#000" stroke-opacity=".5" stroke-width="2"/>'}
</g></svg>`;
}

export function ribbonSvg() {
  const d = 'M5 0 H43 V158 L24 137 L5 158Z';
  return `<svg ${NS} width="48" height="160" viewBox="0 0 48 160"><defs>
<linearGradient id="rb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6e150e"/><stop offset=".18" stop-color="#a32a1f"/><stop offset=".5" stop-color="#c0382b"/><stop offset=".82" stop-color="#a32a1f"/><stop offset="1" stop-color="#701710"/></linearGradient>
<linearGradient id="rt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset=".12" stop-color="#000" stop-opacity=".12"/><stop offset=".25" stop-color="#000" stop-opacity="0"/></linearGradient>
<pattern id="wv" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="1.2" fill="#000" opacity=".12"/></pattern>
<clipPath id="rc"><path d="${d}"/></clipPath>
<filter id="sh" x="-20%" y="-5%" width="140%" height="115%"><feDropShadow dx="1.5" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity=".5"/></filter></defs>
<g filter="url(#sh)"><path d="${d}" fill="url(#rb)"/>
<g clip-path="url(#rc)"><rect width="48" height="160" fill="url(#wv)"/><rect width="48" height="160" fill="url(#rt)"/>
<path d="M24 137 L5 158 L24 150Z" fill="#000" opacity=".22"/><path d="M24 137 L43 158 L24 150Z" fill="#000" opacity=".08"/>
<path d="M10 0 V150 M38 0 V150" stroke="#f0c36a" stroke-opacity=".75" stroke-width="1" stroke-dasharray="4 3"/>
<path d="M16 0 V140" stroke="#fff" stroke-opacity=".12" stroke-width="3"/></g>
<path d="${d}" fill="none" stroke="#4a0c07" stroke-width="1.2"/></g></svg>`;
}

/* ------------------------------------------------------------------ icons (viewBox 0 0 24 24) */

function starPts(cx, cy, R, r, rot = -90, n = 5) {
  const p = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180, rr = i % 2 ? r : R;
    p.push(`${f(cx + rr * Math.cos(a))},${f(cy + rr * Math.sin(a))}`);
  }
  return p.join(' ');
}
const ic = (body) => `<svg ${NS} viewBox="0 0 24 24" width="24" height="24">${body}</svg>\n`;

export const icons = {
  'star.svg': ic(`<defs><linearGradient id="mhw-star-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd978"/><stop offset=".55" stop-color="#eaa62e"/><stop offset="1" stop-color="#c47c17"/></linearGradient></defs>
<polygon points="${starPts(12, 12.6, 10.8, 4.7)}" fill="url(#mhw-star-g)" stroke="#8a560f" stroke-width="1" stroke-linejoin="round"/>
<polygon points="12,4.4 13.5,9.4 11.4,9.6 8.4,9.4" fill="#fff4c4" opacity=".55"/>`),
  'star-empty.svg': ic(`<polygon points="${starPts(12, 12.6, 10.8, 4.7)}" fill="#3b2717" fill-opacity=".28" stroke="#8c6a3b" stroke-width="1.2" stroke-linejoin="round"/>
<polygon points="${starPts(12, 12.6, 6.2, 2.7)}" fill="#000" fill-opacity=".12"/>`),
  'crown-mini.svg': ic(`<defs><linearGradient id="mhw-cm-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3a56c"/><stop offset="1" stop-color="#9a5b2e"/></linearGradient></defs>
<path d="M5.5 17.5 L4.8 9.5 L9 12.6 L12 7.2 L15 12.6 L19.2 9.5 L18.5 17.5Z" fill="url(#mhw-cm-g)" stroke="#5a3318" stroke-width="1" stroke-linejoin="round"/>
<rect x="5.3" y="17.3" width="13.4" height="2.4" rx=".8" fill="#b9733c" stroke="#5a3318" stroke-width="1"/>`),
  'crown-silver.svg': ic(crownBody('mhw-cs', ['#fafcfd', '#b4bec6', '#707c87'], '#46505a', '#2e8fb5')),
  'crown-gold.svg': ic(crownBody('mhw-cg', ['#fff2b0', '#eaa62e', '#b0701a'], '#6e430c', '#a32a1f')),
  'gem.svg': ic(gemBody('mhw-gm', false)),
  'gem-active.svg': ic(gemBody('mhw-ga', true)),
};

function crownBody(id, [c0, c1, c2], edge, jewel) {
  return `<defs><linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset=".5" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<path d="M3.2 17.5 L2.4 7.6 L8 12.2 L12 4.6 L16 12.2 L21.6 7.6 L20.8 17.5Z" fill="url(#${id}-g)" stroke="${edge}" stroke-width="1" stroke-linejoin="round"/>
<rect x="3" y="17.3" width="18" height="3.4" rx="1" fill="url(#${id}-g)" stroke="${edge}" stroke-width="1"/>
<circle cx="2.6" cy="7" r="1.7" fill="${c0}" stroke="${edge}" stroke-width=".8"/><circle cx="12" cy="4" r="1.8" fill="${c0}" stroke="${edge}" stroke-width=".8"/><circle cx="21.4" cy="7" r="1.7" fill="${c0}" stroke="${edge}" stroke-width=".8"/>
<circle cx="12" cy="19" r="1.2" fill="${jewel}" stroke="${edge}" stroke-width=".5"/><circle cx="7" cy="19" r=".7" fill="${jewel}"/><circle cx="17" cy="19" r=".7" fill="${jewel}"/>
<path d="M5 15.6 L4.5 11 L7.4 13.4" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".9" stroke-linecap="round"/>`;
}
function gemBody(id, on) {
  const g = on ? ['#b6fbff', '#00d7e2', '#008a9c'] : ['#3d7d84', '#25565c', '#173a3f'];
  const edge = on ? '#00535f' : '#0c2427';
  return `<defs><linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${g[0]}"/><stop offset=".5" stop-color="${g[1]}"/><stop offset="1" stop-color="${g[2]}"/></linearGradient>
${on ? `<radialGradient id="${id}-h"><stop offset="0" stop-color="#00d7e2" stop-opacity=".6"/><stop offset="1" stop-color="#00d7e2" stop-opacity="0"/></radialGradient>` : ''}</defs>
${on ? `<circle cx="12" cy="12" r="11.5" fill="url(#${id}-h)"/>` : ''}
<path d="M7 3.2 H17 L21.6 9 L12 21.2 L2.4 9 Z" fill="url(#${id}-g)" stroke="${edge}" stroke-width="1.1" stroke-linejoin="round"/>
<path d="M2.4 9 H21.6 M7 3.2 L9.4 9 L12 21.2 L14.6 9 L17 3.2 M9.4 9 L12 3.2 L14.6 9" fill="none" stroke="${on ? '#e8ffff' : '#5fa0a8'}" stroke-opacity="${on ? 0.7 : 0.35}" stroke-width=".7" stroke-linejoin="round"/>
<path d="M8.2 4.6 L6 8" stroke="#fff" stroke-opacity="${on ? 0.85 : 0.25}" stroke-width="1.1" stroke-linecap="round"/>`;
}

/* ------------------------------------------------------------------ festival seals (160x160) */

const poly = (pts) => pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');
const polar = (a, r) => [r * Math.cos((a * Math.PI) / 180), r * Math.sin((a * Math.PI) / 180)];

function emblem(kind, st) {
  // st: attributes string for filled shapes; sw: stroke attrs
  const s = st;
  switch (kind) {
    case 'spring': {
      let o = '';
      for (let i = 0; i < 5; i++) o += `<path transform="rotate(${i * 72})" d="M0 -4 C-16 -12 -17 -30 -4 -35 L0 -29.5 L4 -35 C17 -30 16 -12 0 -4Z" ${s}/>`;
      return o + `<circle r="4.4" ${s}/>` + [0, 1, 2, 3, 4].map((i) => { const [x, y] = polar(-90 + i * 72 + 36, 11); return `<circle cx="${f(x)}" cy="${f(y)}" r="1.5" ${s}/>`; }).join('');
    }
    case 'summer': {
      const pts = []; for (let i = 0; i < 32; i++) { const a = -90 + i * 11.25; const r = i % 2 === 0 ? (i % 4 === 0 ? 35 : 27) : 20; pts.push(polar(a, r)); }
      return `<polygon points="${poly(pts)}" ${s}/><circle r="15" ${s}/>`;
    }
    case 'autumn': {
      const pts = [];
      for (let i = 0; i < 5; i++) { const a = -90 + i * 72; const big = i === 0 ? 1.05 : 0.95;
        pts.push(polar(a - 36, 12), polar(a - 23, 20), polar(a - 17, 15.5), polar(a, 34 * big), polar(a + 17, 15.5), polar(a + 23, 20)); }
      return `<g transform="rotate(8)"><polygon points="${poly(pts)}" ${s}/><path d="M0 8 L0 37" stroke-width="3.4" stroke-linecap="round" ${s.replace(/fill="[^"]*"/, 'fill="none"').replace('stroke="none"', '')} /></g>`;
    }
    case 'winter': {
      let arm = `<path d="M0 0 V-33 M0 -14 L-8 -22 M0 -14 L8 -22 M0 -24 L-6 -30 M0 -24 L6 -30" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
      let o = '';
      for (let i = 0; i < 6; i++) o += `<g transform="rotate(${i * 60})">${arm} ${s.replace(/fill="[^"]*"/, '').replace(/stroke="none"/, '')}/></g>`;
      return o + `<polygon points="${poly([0, 1, 2, 3, 4, 5].map((i) => polar(-90 + i * 60, 7)))}" ${s}/>`;
    }
    case 'appreciation': {
      return `<polygon points="${starPts(0, 2, 36, 15)}" ${s}/><circle cx="0" cy="2" r="5" ${s.replace(/fill="[^"]*"/, 'fill="none"')} stroke-width="1.6"/>`;
    }
  }
}

const SEALS = {
  spring: { dark: '#8e2c4b', mid: '#c9506f', light: '#f08fa7' },
  summer: { dark: '#a8620a', mid: '#e89b1c', light: '#ffd262' },
  autumn: { dark: '#6e2a10', mid: '#b0521f', light: '#e08a45' },
  winter: { dark: '#23496e', mid: '#4f86b8', light: '#a9d4f2' },
  appreciation: { dark: '#5a1f4a', mid: '#8a3a72', light: '#d38ec0' },
};

export function sealSvg(kind) {
  const c = SEALS[kind];
  const r = rng(kind.length * 977 + kind.charCodeAt(0));
  const p1 = r() * 6.28, p2 = r() * 6.28, p3 = r() * 6.28;
  const blob = [];
  for (let i = 0; i < 180; i++) {
    const t = (i / 180) * Math.PI * 2;
    const rad = 70 * (1 + 0.035 * Math.sin(16 * t + p1) + 0.028 * Math.sin(9 * t + p2) + 0.02 * Math.sin(5 * t + p3));
    blob.push([80 + rad * Math.cos(t), 80 + rad * Math.sin(t)]);
  }
  const bp = 'M' + poly(blob).replace(/ /g, ' L') + 'Z';
  const E = (dx, dy, fill) => `<g transform="translate(${80 + dx} ${80 + dy}) scale(1.02)" stroke="${fill}" fill="${fill}">${emblem(kind, `fill="${fill}" stroke="${fill}" stroke-width="0"`)}</g>`;
  const emb = (fill, dx, dy) => `<g transform="translate(${80 + dx} ${80 + dy})" style="color:${fill}">${emblem(kind, `fill="${fill}" stroke="${fill}" stroke-width="0.01"`)}</g>`;
  const emb2 = (fill, dx, dy) => {
    // emblem draws stroke arms for snowflake; make strokes colour match
    return `<g transform="translate(${80 + dx} ${80 + dy})">${emblem(kind, `fill="${fill}" stroke="${fill}"`)}</g>`;
  };
  void E; void emb;
  return `<svg ${NS} width="160" height="160" viewBox="0 0 160 160"><defs>
<radialGradient id="wx" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="${c.light}"/><stop offset=".45" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.dark}"/></radialGradient>
<radialGradient id="in" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="${c.dark}" stop-opacity=".55"/><stop offset="1" stop-color="${c.mid}" stop-opacity=".1"/></radialGradient>
<filter id="sh" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="2.4" stdDeviation="2.6" flood-color="#000" flood-opacity=".5"/></filter></defs>
<g filter="url(#sh)"><path d="${bp}" fill="${c.dark}"/></g>
<path d="${bp}" transform="translate(80 80) scale(.975) translate(-80 -80)" fill="url(#wx)"/>
<path d="${bp}" transform="translate(80 80) scale(.975) translate(-80 -80)" fill="none" stroke="${c.light}" stroke-opacity=".55" stroke-width="1.2" stroke-dasharray="40 300"/>
<circle cx="80" cy="80" r="55" fill="url(#in)"/>
<circle cx="80" cy="80" r="55" fill="none" stroke="${c.dark}" stroke-width="2.6" stroke-opacity=".9"/>
<circle cx="80" cy="80" r="52.2" fill="none" stroke="${c.light}" stroke-width="1.3" stroke-opacity=".7"/>
<circle cx="80" cy="80" r="47" fill="none" stroke="${c.dark}" stroke-width="1" stroke-opacity=".55" stroke-dasharray="1.2 3.4" stroke-linecap="round"/>
${emb2(c.dark, 1.6, 2)}
${emb2(c.light, -0.9, -1)}
${emb2(c.mid, 0, 0)}
<ellipse cx="52" cy="40" rx="20" ry="9" transform="rotate(-35 52 40)" fill="#fff" opacity=".18"/>
</svg>`;
}

/* ------------------------------------------------------------------ canteen simulator */

// table.webp 960x600: top-down dark wood planks (not tiled; one backdrop)
export function canteenTableSvg() {
  const W = 960, H = 600, seams = [0, 146, 298, 452, 600];
  const R = 'x="0" y="0" width="960" height="600" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"';
  let planks = '', defs = '';
  for (let i = 0; i < 4; i++) {
    const y = seams[i], h = seams[i + 1] - y;
    defs += `<filter id="cp${i}" x="0" y="${y}" width="${W}" height="${h}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${0.0028 + i * 0.0004} ${0.05 + (i % 2) * 0.012}" numOctaves="4" seed="${31 + i * 7}"/>${gray(2.0, -0.4)}<feComponentTransfer>${ramp('#1d1208', i % 2 ? '#5a3a22' : '#62402a')}</feComponentTransfer></filter>`;
    planks += `<rect y="${y}" width="${W}" height="${h}" filter="url(#cp${i})"/>`;
    planks += `<rect y="${y}" width="${W}" height="${h}" fill="${['#2a1508', '#000', '#3a1f0c', '#000'][i]}" opacity="${[0.12, 0.08, 0.1, 0.12][i]}"/>`;
    if (i) planks += `<rect y="${y - 2}" width="${W}" height="3.5" fill="#0b0602"/><rect y="${y + 1.5}" width="${W}" height="1.2" fill="#7a5134" opacity=".28"/>`;
    // butt joint somewhere along each plank, with two nail heads either side
    const x = [610, 250, 780, 120][i];
    planks += `<rect x="${x}" y="${y}" width="2.5" height="${h}" fill="#0b0602" opacity=".85"/><rect x="${x + 2.5}" y="${y}" width="1" height="${h}" fill="#7a5134" opacity=".22"/>`;
    for (const ny of [y + 18, y + h - 18]) for (const nx of [x - 9, x + 12]) planks += `<circle cx="${nx}" cy="${ny}" r="2.6" fill="#0d0703"/><circle cx="${nx - 0.6}" cy="${ny - 0.6}" r="1" fill="#8a6440" opacity=".35"/>`;
  }
  return `<svg ${NS} width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}
<filter id="cfib" ${R}><feTurbulence type="fractalNoise" baseFrequency="0.012 0.32" numOctaves="2" seed="44"/><feColorMatrix type="matrix" values="0 0 0 0 .02  0 0 0 0 .01  0 0 0 0 0  3 0 0 0 -1.5"/></filter>
<radialGradient id="cglow" cx=".5" cy=".46" r=".62"><stop offset="0" stop-color="#ffb466" stop-opacity=".16"/><stop offset=".55" stop-color="#ffb466" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="cvig" cx=".5" cy=".5" r=".72"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
</defs>
${planks}
<rect width="${W}" height="${H}" filter="url(#cfib)" opacity=".35"/>
<rect width="${W}" height="${H}" fill="url(#cglow)"/>
<rect width="${W}" height="${H}" fill="url(#cvig)"/>
</svg>`;
}

// plate 440x440: warm glazed ceramic, engraved gold rim, calm well
export const PLATE = { size: 440, outer: 206, rimIn: 186, well: 146 };
export function canteenPlateSvg() {
  const c = 220, { outer, rimIn, well } = PLATE;
  let eng = ''; // engraved motif on the gold band: alternating leaves and dots
  for (let i = 0; i < 48; i++) {
    const rr = (outer + rimIn) / 2, t = `transform="rotate(${i * 7.5} ${c} ${c})"`;
    eng += i % 2
      ? `<circle cx="${c}" cy="${f(c - rr)}" r="1.5" ${t}/>`
      : `<path d="M${c} ${f(c - rr - 5)} Q${c + 3.2} ${f(c - rr)} ${c} ${f(c - rr + 5)} Q${c - 3.2} ${f(c - rr)} ${c} ${f(c - rr - 5)}Z" ${t}/>`;
  }
  let marli = ''; // small diamonds on the flat rim
  for (let i = 0; i < 12; i++) {
    const rr = (rimIn + well) / 2 + 3;
    marli += `<path d="M${c} ${f(c - rr - 4.5)} L${c + 3} ${f(c - rr)} L${c} ${f(c - rr + 4.5)} L${c - 3} ${f(c - rr)}Z" transform="rotate(${i * 30 + 15} ${c} ${c})"/>`;
  }
  return `<svg ${NS} width="440" height="440" viewBox="0 0 440 440"><defs>
<radialGradient id="pb" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#f3e6c8"/><stop offset=".6" stop-color="#e2cda0"/><stop offset="1" stop-color="#c3a573"/></radialGradient>
<radialGradient id="pw" cx=".44" cy=".42" r=".62"><stop offset="0" stop-color="#f6ecd4"/><stop offset=".75" stop-color="#ead9b4"/><stop offset="1" stop-color="#d8c193"/></radialGradient>
<linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6dc92"/><stop offset=".35" stop-color="#d8b25a"/><stop offset=".65" stop-color="#b08a3a"/><stop offset=".8" stop-color="#e8c878"/><stop offset="1" stop-color="#8c6522"/></linearGradient>
<filter id="pds" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="pis" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
<filter id="pn" x="0" y="0" width="440" height="440" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="12"/><feColorMatrix type="matrix" values="0 0 0 0 .45  0 0 0 0 .32  0 0 0 0 .18  1.4 0 0 0 -.62"/></filter>
<clipPath id="pwc"><circle cx="${c}" cy="${c}" r="${well}"/></clipPath>
<clipPath id="pbc"><circle cx="${c}" cy="${c}" r="${outer}"/></clipPath>
</defs>
<circle cx="${c + 2}" cy="${c + 7}" r="${outer}" fill="#000" opacity=".55" filter="url(#pds)"/>
<circle cx="${c}" cy="${c}" r="${outer}" fill="url(#pb)"/>
<rect width="440" height="440" filter="url(#pn)" clip-path="url(#pbc)" opacity=".5"/>
<circle cx="${c}" cy="${c}" r="${(outer + rimIn) / 2}" fill="none" stroke="url(#pg)" stroke-width="${outer - rimIn - 4}"/>
<circle cx="${c}" cy="${c}" r="${outer - 1.5}" fill="none" stroke="#5a3a12" stroke-width="2.2"/>
<circle cx="${c}" cy="${c}" r="${rimIn + 2}" fill="none" stroke="#5a3a12" stroke-width="1.6"/>
<circle cx="${c}" cy="${c}" r="${outer - 4}" fill="none" stroke="#fff3c4" stroke-width=".9" stroke-opacity=".6"/>
<g fill="#6e4a14" opacity=".75">${eng}</g>
<circle cx="${c}" cy="${c}" r="${well + 7}" fill="none" stroke="#b08a3a" stroke-width="1.6" stroke-opacity=".8"/>
<g fill="#b08a3a" opacity=".55">${marli}</g>
<circle cx="${c}" cy="${c}" r="${well}" fill="url(#pw)"/>
<g clip-path="url(#pwc)"><circle cx="${c + 4}" cy="${c + 6}" r="${well + 6}" fill="none" stroke="#6b4a22" stroke-opacity=".45" stroke-width="16" filter="url(#pis)"/></g>
<circle cx="${c}" cy="${c}" r="${well}" fill="none" stroke="#8c6522" stroke-width="2"/>
<circle cx="${c}" cy="${c}" r="${well - 2}" fill="none" stroke="#fff6dc" stroke-width="1" stroke-opacity=".5"/>
</svg>`;
}

// branch glyphs: 24x24, single colour (currentColor), internal ids prefixed mhw-br-
const br = (body, defs = '') => `<svg ${NS} viewBox="0 0 24 24" width="24" height="24" fill="currentColor">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>\n`;
const cut = (id, d, w) => `<mask id="mhw-br-${id}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><path d="${d}" fill="#000" stroke="#000" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/></mask>`;
const THUMB = 'M4.6 11.4 H12.6 Q14.6 11.4 14.6 13.2 Q14.6 15 12.6 15 H4.6 Z';
export const branchIcons = {
  courage: br(`<g mask="url(#mhw-br-courage-m)"><rect x="3.4" y="4.6" width="3.6" height="8" rx="1.8"/><rect x="7.6" y="3.4" width="3.6" height="9" rx="1.8"/><rect x="11.8" y="3.8" width="3.6" height="9" rx="1.8"/><rect x="16" y="5.2" width="3.4" height="8" rx="1.7"/><path d="M3.4 10 H19.4 V15.6 Q19.4 19.4 16.4 20.4 V22 H8 V20.4 Q3.4 19 3.4 15.2 Z"/></g><path d="${THUMB}"/>`,
    cut('courage', THUMB + ' M7.3 3 V10.6 M11.5 3 V10.6 M15.7 3 V10.6', 1.5)),
  resilience: br(`<path fill-rule="evenodd" d="M12 1.6 L20.8 4.8 V11 C20.8 16.6 17 20.6 12 22.4 C7 20.6 3.2 16.6 3.2 11 V4.8 Z M12 3.9 L5.3 6.3 V11 C5.3 15.4 8.2 18.7 12 20.2 C15.8 18.7 18.7 15.4 18.7 11 V6.3 Z"/><path d="M12 6 L16.8 7.8 V11 C16.8 14.3 14.8 16.8 12 18 C9.2 16.8 7.2 14.3 7.2 11 V7.8 Z"/>`),
  vigor: br(`<path d="M14.2 1.4 L4.2 13.6 H10.8 L8.8 22.6 L19.8 9.6 H13.2 L15.6 1.4 Z" stroke="currentColor" stroke-width=".6" stroke-linejoin="round"/>`),
  acumen: br(`<path fill-rule="evenodd" d="M8.4 1.6 H15.6 V4 H14.6 V8.4 A7.3 7.3 0 1 1 9.4 8.4 V4 H8.4 Z M11.1 4 V9.6 L10.4 9.9 A5.6 5.6 0 1 0 13.6 9.9 L12.9 9.6 V4 Z"/><path d="M7.6 15.6 Q9.8 14.2 12 15.6 T16.4 15.6 A4.5 4.5 0 0 1 7.6 15.6 Z"/><circle cx="13.6" cy="12.6" r=".9"/>`),
  artillery: br(`<path fill-rule="evenodd" d="M10.4 7 A7.9 7.9 0 1 1 10.39 7 Z M6.6 12.6 A2 2 0 1 0 6.61 12.6 Z"/><rect x="12.6" y="5.8" width="5" height="3.6" rx=".6" transform="rotate(42 15.1 7.6)"/><path d="M16.4 5.4 Q17.4 2.4 20 3.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M20.9 .9 L21.5 2.4 L23 3 L21.5 3.6 L20.9 5.1 L20.3 3.6 L18.8 3 L20.3 2.4 Z"/>`),
  perception: br(`<path fill-rule="evenodd" d="M1.2 12 Q12 1.2 22.8 12 Q12 22.8 1.2 12 Z M3.9 12 Q12 4.6 20.1 12 Q12 19.4 3.9 12 Z"/><path fill-rule="evenodd" d="M12 8.2 A3.8 3.8 0 1 1 11.99 8.2 Z M12 10.4 A1.6 1.6 0 1 0 12.01 10.4 Z"/>`),
  fortune: br(`<path fill-rule="evenodd" d="M12 1.8 A10.2 10.2 0 1 1 11.99 1.8 Z M12 3.6 A8.4 8.4 0 1 0 12.01 3.6 Z"/><path fill-rule="evenodd" d="M12 4.9 A7.1 7.1 0 1 1 11.99 4.9 Z M12 6.6 L13.2 10.8 L17.4 12 L13.2 13.2 L12 17.4 L10.8 13.2 L6.6 12 L10.8 10.8 Z"/>`),
  preparation: br(`<g mask="url(#mhw-br-preparation-m)"><path d="M3.6 3 H11.6 V12.2 L17.6 14.2 Q21 15.3 21 18.6 V21.6 H3.6 Z"/></g><path d="M18.3 1.6 V9 M15.1 3.45 L21.5 7.15 M15.1 7.15 L21.5 3.45" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
    cut('preparation', 'M3 6.4 H12.4 M3 18.8 H21.6 M18.3 0.2 V10.4 M14 2.8 L22.6 7.8 M14 7.8 L22.6 2.8', 1.4)),
  trailblazer: br(`<path fill-rule="evenodd" d="M12 .9 L14.2 9.8 L23.1 12 L14.2 14.2 L12 23.1 L9.8 14.2 L.9 12 L9.8 9.8 Z M12 10.5 A1.5 1.5 0 1 0 12.01 10.5 Z"/><path d="M12 12 L18.6 5.4 L13.7 10.3 Z M12 12 L18.6 18.6 L13.7 13.7 Z M12 12 L5.4 18.6 L10.3 13.7 Z M12 12 L5.4 5.4 L10.3 10.3 Z"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.2"/>`),
};

// gold wax seal for anim/skill-seal.webm (drawn on a 120 px box)
export function skillSealSvg() {
  const r = rng(4242), p1 = r() * 6.28, p2 = r() * 6.28, blob = [];
  for (let i = 0; i < 160; i++) {
    const t = (i / 160) * Math.PI * 2, rad = 52 * (1 + 0.04 * Math.sin(14 * t + p1) + 0.03 * Math.sin(7 * t + p2));
    blob.push([60 + rad * Math.cos(t), 60 + rad * Math.sin(t)]);
  }
  const bp = 'M' + poly(blob).replace(/ /g, ' L') + 'Z';
  const st = `<polygon points="${starPts(60, 61, 25, 10.5, -90, 6)}"`;
  return `<svg ${NS} width="120" height="120" viewBox="0 0 120 120"><defs>
<radialGradient id="ssw" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="#fff0b0"/><stop offset=".45" stop-color="#e0b44e"/><stop offset="1" stop-color="#8a5a12"/></radialGradient>
<filter id="sss" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="0" dy="2.4" stdDeviation="2.4" flood-color="#000" flood-opacity=".5"/></filter></defs>
<g filter="url(#sss)"><path d="${bp}" fill="#7a4e0e"/></g>
<path d="${bp}" transform="translate(60 60) scale(.965) translate(-60 -60)" fill="url(#ssw)"/>
<circle cx="60" cy="60" r="40" fill="#8a5a12" opacity=".22"/>
<circle cx="60" cy="60" r="40" fill="none" stroke="#6e430c" stroke-width="2.2"/>
<circle cx="60" cy="60" r="37.6" fill="none" stroke="#fff0b0" stroke-width="1.1" stroke-opacity=".7"/>
<circle cx="60" cy="60" r="33.5" fill="none" stroke="#6e430c" stroke-width="1" stroke-opacity=".6" stroke-dasharray="1.2 3.2" stroke-linecap="round"/>
${st} transform="translate(1.2 1.6)" fill="#6e430c"/>${st} transform="translate(-.8 -.8)" fill="#fff0b0"/>${st} fill="#d8a540"/>
<circle cx="60" cy="61" r="4.5" fill="#8a5a12"/>
<ellipse cx="40" cy="31" rx="15" ry="7" transform="rotate(-35 40 31)" fill="#fff" opacity=".22"/>
</svg>`;
}
