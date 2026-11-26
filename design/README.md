# design/ - Hunter's Notes UI art

Original decorative UI art (parchment pages, dark wood, engraved gold frames, ribbon, stars, crowns,
gems, festival wax seals) in the spirit of the in-game bestiary. All art is drawn from scratch as
parametric SVG/HTML/CSS/GSAP (`art.mjs`, `anim.mjs`) and rendered with
[HeyGen HyperFrames](https://github.com/heygen-com/hyperframes) (`hyperframes@0.9.52`, Apache-2.0,
GSAP 3.13.0 vendored in `vendor/`). Nothing is copied or traced from Capcom artwork.

## Re-render everything

Requirements: Node >= 22, FFmpeg on PATH (the bundled headless Chrome is downloaded by HyperFrames on first run).

    cd design
    npm install
    npm run render        # node build.mjs -> writes web/public/ui/** and design/out/contact.png

Partial rebuild: `node build.mjs <prefix>` (e.g. `parchment`, `fest-`, `anim`, `contact`).
Stills are rendered as 1-frame RGBA PNG sequences; animations as VP9 WebM with alpha.
Palette constants live in `art.mjs` (`C`). Output is deterministic (seeded noise).

## Assets (web/public/ui/)

| File | Size | Notes |
|---|---|---|
| parchment.webp, parchment-dark.webp, wood.webp | 512x512 | seamless tiles (feTurbulence stitchTiles); wood has two plank seams |
| corner.png | 128x128 | top-left filigree, mirror in CSS |
| divider.png | 640x32 | ornamental rule |
| header-frame.png | 600x64 | 9-slice |
| tab.png, tab-active.png | 360x56 | 9-slice |
| ribbon.png | 48x160 | red bookmark |
| star, star-empty, crown-mini, crown-silver, crown-gold, gem, gem-active (.svg) | 24x24 viewBox | inline-able, ids are file-prefixed (`mhw-*`) |
| fest-spring/summer/autumn/winter/appreciation.png | 160x160 | wax seals |
| anim/page-turn.webm | 480x320, 2.6 s | page flip, alpha |
| anim/crown-shine.webm | 96x96, 2 s | gold glint, alpha |
| anim/fest-seal.webm | 160x160, 2.4 s | stamp + shine, alpha |

### Canteen simulator (web/public/ui/canteen/) - `node build.mjs canteen` (~105 KB total, budget 150 KB)

| File | Size | Notes |
|---|---|---|
| table.webp | 960x600, ~12 KB | top-down dark plank tabletop, warm centre glow + vignette; not a tile (use `background-size: cover`) |
| plate.webp | 440x440, ~22 KB | lossy webp with alpha (png was ~4x larger). Outer radius 206, gold band 186-206, well radius 146 (`PLATE` in art.mjs); keep slots inside the well |
| branch-{courage,resilience,vigor,acumen,artillery,perception,fortune,preparation,trailblazer}.svg | 24x24 viewBox, 0.25-0.9 KB | `fill="currentColor"` single colour; mask ids `mhw-br-<id>-m` (inline each glyph once per page or use `<img>`/CSS mask) |
| anim/fresh-sparkle.webm | 64x64, 1.6 s, ~16 KB | green twinkles in the top-right corner, seamless loop (`loop muted autoplay playsinline`) |
| anim/skill-seal.webm | 128x128, 1.2 s, ~27 KB | gold wax seal stamps in, ring burst, shine; plays once and the last frame holds the seal |
| anim/vapor.webm | 160x220, 2.4 s, ~24 KB | three soft wisps rising from y~196, seamless loop; faint brown under-shadow so it reads on the light plate |

## 9-slice insets (CSS `border-image`)

- header-frame.png: slice `24 48` -> `border-image: url(header-frame.png) 24 48 fill / 24px 48px stretch;` (design height 64 px; the 16 px middle band stretches if taller).
- tab.png / tab-active.png: slice `20` -> `border-image: url(tab.png) 20 fill / 20px stretch;` (bottom edge is open so the active tab merges with the page).

## Licenses

HyperFrames: Apache-2.0. GSAP 3.13.0 (standard no-charge license, gsap.com/standard-license). Artwork in this
folder and web/public/ui: original, produced for this project.

## Nota sobre GSAP

GSAP no se incluye en el repositorio (licencia propia de GreenSock): instálalo con npm o descárgalo en `design/vendor/` para regenerar el arte.
