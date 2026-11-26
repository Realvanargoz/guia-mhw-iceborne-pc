import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from './art.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(ROOT, '../web/public/ui');
const WORK = path.join(ROOT, 'work'), OUT = path.join(ROOT, 'out');
const HF = path.join(ROOT, 'node_modules/hyperframes/bin/hyperframes.mjs');
for (const d of [UI, path.join(UI, 'anim'), WORK, OUT]) fs.mkdirSync(d, { recursive: true });

const only = process.argv[2]; // optional filter
const page = (w, h, body, extraHead = '', script = '', dur = 1, bg = 'transparent') => `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=${w}, height=${h}"><script src="../vendor/gsap.min.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${w}px;height:${h}px;overflow:hidden;background:${bg}}#root{position:relative;width:${w}px;height:${h}px;overflow:hidden}${extraHead}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${dur}" data-width="${w}" data-height="${h}">${body}</div>
<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});${script}window.__timelines["main"]=tl;tl.seek(0);</script></body></html>`;

function render(name, html, fmt, fps, extra = []) {
  const file = path.join(WORK, name + '.html');
  fs.writeFileSync(file, html);
  const out = path.join(WORK, name + (fmt === 'png-sequence' ? '_seq' : '.' + fmt));
  fs.rmSync(out, { recursive: true, force: true });
  const r = spawnSync(process.execPath, [HF, 'render', '-c', 'work/' + name + '.html', '--format', fmt, '-f', String(fps), '-o', out, '--quiet', ...extra], { cwd: ROOT, encoding: 'utf8' });
  if (!fs.existsSync(out)) { console.error(r.stdout, r.stderr); throw new Error('render failed ' + name); }
  console.log('rendered', name);
  return out;
}
const ff = (...a) => { const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...a], { encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); };
const still = (name, w, h, svg, dest, webp) => {
  if (only && !name.startsWith(only)) return;
  const seq = render(name, page(w, h, svg), 'png-sequence', 1);
  const png = path.join(seq, 'frame_000001.png');
  if (webp) ff('-i', png, '-c:v', 'libwebp', '-quality', '80', '-compression_level', '6', path.join(UI, dest));
  else ff('-i', png, path.join(UI, dest));
  fs.copyFileSync(png, path.join(WORK, name + '.png'));
};

// icons are plain SVG, no render needed
for (const [n, s] of Object.entries(A.icons)) fs.writeFileSync(path.join(UI, n), s);

still('parchment', 512, 512, A.parchmentSvg(false), 'parchment.webp', true);
still('parchment-dark', 512, 512, A.parchmentSvg(true), 'parchment-dark.webp', true);
still('wood', 512, 512, A.woodSvg(), 'wood.webp', true);
still('corner', 128, 128, A.cornerSvg(), 'corner.png');
still('divider', 640, 32, A.dividerSvg(), 'divider.png');
still('header-frame', 600, 64, A.headerFrameSvg(), 'header-frame.png');
still('tab', 360, 56, A.tabSvg(false), 'tab.png');
still('tab-active', 360, 56, A.tabSvg(true), 'tab-active.png');
still('ribbon', 48, 160, A.ribbonSvg(), 'ribbon.png');
for (const k of ['spring', 'summer', 'autumn', 'winter', 'appreciation']) still('fest-' + k, 160, 160, A.sealSvg(k), `fest-${k}.png`);

// ---- canteen simulator (web/public/ui/canteen/**): `node build.mjs canteen`
const CANTEEN = path.join(UI, 'canteen');
if (!only || only.startsWith('canteen')) {
  fs.mkdirSync(path.join(CANTEEN, 'anim'), { recursive: true });
  for (const [id, s] of Object.entries(A.branchIcons)) fs.writeFileSync(path.join(CANTEEN, `branch-${id}.svg`), s);
  const seqPng = (name, w, h, svg) => path.join(render(name, page(w, h, svg), 'png-sequence', 1), 'frame_000001.png');
  const t = seqPng('canteen-table', 960, 600, A.canteenTableSvg());
  ff('-i', t, '-c:v', 'libwebp', '-quality', '72', '-compression_level', '6', path.join(CANTEEN, 'table.webp'));
  fs.copyFileSync(t, path.join(WORK, 'canteen-table.png'));
  // plate: lossy webp with alpha is ~4x smaller than png at no visible cost; png kept in work/ only
  const p = seqPng('canteen-plate', 440, 440, A.canteenPlateSvg());
  ff('-i', p, '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', '82', '-compression_level', '6', path.join(CANTEEN, 'plate.webp'));
  fs.copyFileSync(p, path.join(WORK, 'canteen-plate.png'));
  await (await import('./anim.mjs')).canteen({ page, render, UI: CANTEEN, A });
  for (const f of fs.readdirSync(CANTEEN, { recursive: true })) { const s = fs.statSync(path.join(CANTEEN, f)); if (s.isFile()) console.log('canteen/' + f, s.size); }
}

if (!only || only === 'anim') (await import('./anim.mjs')).default({ page, render, ff, UI, WORK, A });
if (!only || only === 'contact') (await import('./contact.mjs')).default({ page, render, ff, UI, WORK, OUT, fs, path });
