# qr-scanner

A static, client side QR decoder that does what [cli.im/deqr](https://cli.im/deqr) does, without a backend.

Drop a screenshot or a photo, get the text back. The image never leaves the tab.

Live: https://22able22.github.io/qr-scanner/

## What is here

| File | Role |
|---|---|
| `index.html` | Landing page and the tool |
| `app.js` | File, paste, and camera handling, decode pipeline, result UI |
| `vendor/jsQR.js` | Pass 1 decoder, pure JavaScript, 251 KB raw / ~33 KB brotli |
| `vendor/zxing-reader.js` | Pass 2 loader, 37 KB, fetched only on a miss |
| `vendor/zxing_reader.wasm` | Pass 2 engine, 925 KB, fetched only on a miss |
| `sw.js` | Service worker, offline shell and decoder cache |
| `privacy.html`, `404.html` | Legal page and branded error page |
| `manifest.webmanifest` | Installable on a phone home screen |

## Theming

Light and dark are both first class. The page follows `prefers-color-scheme` until the visitor presses the theme button, which overrides the system and is remembered in `localStorage` under `qr-scanner-theme`. The choice is applied by an inline script in `<head>` before first paint, so there is no flash of the wrong palette. Colours live in custom properties on `:root`, with the dark set on `:root[data-theme="dark"]`; `meta[name="theme-color"]` tracks the active theme so mobile browser chrome matches.

## Decode pipeline

1. The file is drawn to a canvas, capped at 1600 px on the long edge, on a white backdrop so transparent PNGs still decode.
2. `jsQR` runs on the pixels with `attemptBoth` inversion. It handles clean, rotated, tiny, and dense UTF 8 codes.
3. If that misses, `zxing-reader.wasm` is fetched and run with `tryHarder`, `tryRotate`, `tryInvert`, and `tryDownscale`. It recovers low contrast and awkward photos, and can return several codes from one image.
4. Every result gets copy, open (http only, `rel="noopener noreferrer"`), and save as `.txt`.

## Measured, not guessed

Decoded in headless Chromium through the real file input:

| Fixture | Engine | Time |
|---|---|---|
| 320 px clean URL | jsQR | 14 ms |
| 120 px tiny | jsQR | 2 ms |
| 90 degree rotated | jsQR | 4 ms |
| dense Chinese UTF 8 | jsQR | 9 ms |
| low contrast (105 to 150 grey) | ZXing WASM | 12 ms |

Transfer, brotli: 71 KB cold when the server compresses, about 95 KB over GitHub Pages, which serves gzip. The WASM fallback adds roughly 400 KB gzip, once, cached afterwards.

## Editing it

There is no build step. Edit the files, commit, push. GitHub Pages serves the branch directly.

Two things to remember:

- `.nojekyll` keeps `_` prefixed paths served verbatim.
- Bump `CACHE` in `sw.js` whenever an asset changes, otherwise returning visitors keep the old copy.

## Licenses

`jsQR` is Apache 2.0. `zxing-wasm` is MIT, wrapping ZXing C++ under Apache 2.0. Geist is SIL OFL 1.1. License texts are in `vendor/` and `assets/`.
