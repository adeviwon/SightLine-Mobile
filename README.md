# SightLine Mobile — Offline Document Reader for iPhone

> **Your eyes, offline. Nothing leaves your phone.**

A fully offline PWA (Progressive Web App) that scans banking documents, medical
prescriptions, and legal papers with your phone camera and reads them aloud.
**Zero cloud. Zero network calls after install.** Runs entirely on-device.

Ported from the [SightLine desktop pipeline](https://github.com/adeviwon/SightLine) —
same architecture, now running in the browser on iOS/Android.

---

## Install on iPhone (no App Store)

1. **Serve the app** — run `python3 -m http.server 8080` in this folder (or any static host)
2. **Open in Safari** — visit `http://<your-computer-ip>:8080` (same Wi-Fi, one-time)
3. **Add to Home Screen** — Share button → *Add to Home Screen*
4. **Done** — the app now works with **no internet, forever** (service worker precaches
   the entire 40 MB engine: OCR wasm + language data + app shell)

First Safari load downloads ~40 MB. After that, airplane mode works fully.

## What it does

| Stage | Tech (all on-device) | Mirrors |
|---|---|---|
| Image preprocessing | Canvas: grayscale, deskew, tile-CLAHE, median denoise, Otsu | `preprocess.py` |
| OCR | tesseract.js 5.1 (WASM, 4 core variants), multi-pass PSM 6/3/11 | `ocr.py` |
| Document classification | keyword-density across banking/medical/legal | `classifier.py` |
| Field extraction | OCR-confusion-tolerant regex (dosages, accounts, IBANs, clauses) | `classifier.py` |
| Named entities | drugs, dosages, money, dates, orgs, people | `ner.py` |
| Natural speech | Web Speech API (iOS built-in, offline) | `tts.py` |

**4K + PDF support:** images up to 3200px are processed at native resolution (higher
preserved on OCR candidates); PDFs render to 4K canvas via pdf.js before OCR.

## Real-world robustness

Tested against the same adversarial conditions as the desktop suite:

- camera noise → 90%+ OCR confidence with garbage-word filtering
- blur → quality warning shown to user + multi-stage fallback (grayscale beats binary)
- shadows/glare/rotation → tile-based CLAHE + projection-profile deskew
- OCR character confusion → `S00mg→500mg`, `m9→mg`, `m1→ml` normalization

## Run tests

```bash
node /tmp/test_pipeline_node.js   # classify/NER/summary unit tests
node /tmp/test_normalize.js       # OCR-confusion normalization tests
node --check js/pipeline.js       # syntax gate
```

## Architecture

```
Camera / File(4K) / PDF
        │
        ▼
   preprocess (canvas)
   ├─ grayscale → quality check (Laplacian blur score, brightness)
   ├─ deskew (projection-profile angle estimate)
   ├─ tile-CLAHE contrast (8×8 grid, clip 3.0)
   ├─ median denoise (low-quality images only)
   └─ Otsu binarize ──┐
        │             │
        ▼             ▼
   tesseract.js multi-pass OCR (PSM 6 → 3 → 11, across stages)
        │
        ▼
   normalize OCR text (confusion fixes)
        │
        ▼
   classify (keyword density) → extract fields (regex) → NER
        │
        ▼
   natural-language summary → iOS Speech Synthesis (offline)
```

## Privacy guarantee

- Service worker intercepts all fetches — **same-origin only**, nothing external
- Every precache URL is a local file (verified: 23/23 resolve)
- No analytics, no remote fonts, no CDN calls at runtime
- Comparable to Docker `network_mode: none` on the desktop version

---

## Pipeline Verification (Preprocessing → OCR)

The preprocessing→OCR chain was re-audited and stress-tested against 8 real-world
image conditions using the exact engine tesseract.js wraps (same Tesseract 4 LSTM):

| Condition | Laplacian var | Best stage | OCR conf | Classified | Fields | Verdict |
|---|---|---|---|---|---|---|
| clean | 2539 | denoised | 85.6% | medical | 4 | PASS |
| blur σ=2 | 9 | denoised | 48.6% | medical | 2 | WARN (blur warning shown) |
| blur σ=3 | 1 | — | sub-readable | — | 0 | least-bad + warning (input unreadable to humans too) |
| noise σ=25 | 4996 | enhanced | 84.6% | medical | 5 | PASS |
| rotated 6° | 3114 | denoised | 90.7% | medical | 6 | PASS |
| shadow | 1434 | denoised | 87.5% | medical | 4 | PASS |
| low contrast | 637 | enhanced | 85.6% | medical | 4 | PASS |
| blur+noise+shadow+rot+contrast | 7 | denoised | 41.4% | general | 0 | least-bad + warning |

### Bugs found and fixed during the re-audit

1. **Duplicate OCR passes** — when image quality ≥ 0.6, `denoised === enhanced`
   (same canvas), so 6 OCR passes ran on 2 unique images (~6-18s wasted on phone CPU).
   Fixed with canvas dedupe (mirrors the desktop `id()` dedupe).
2. **Skew sweep cost** — single ±10° sweep at 0.5° steps = 41 full-image projections
   per preprocess. Replaced with two-stage sweep (coarse 1°, refine 0.25°) — ~4x fewer
   scans on 4K input.
3. **Noise path missing** — salt-pepper noise (σ=25, Laplacian var 5006) produced 56%
   garbage words because the denoise gate only fired on blur. Added noise detector
   (`lapVar > 800`) → median filter path. Noise case went FAIL → PASS (84.6%).
4. **Wrong blur treatment** — median filter on blurry text destroys the remaining edge
   signal (blur2 OCR → NONE). Replaced with desktop's approach: unsharp mask
   (`src*1.5 − gaussian*0.5`, σ=3). Blur2 recovered to 48.6% with 2 fields + warning.

### Degradation policy

Readable-input failures don't crash or hallucinate: the pipeline returns the
least-bad OCR result with an explicit quality warning ("Image may be blurry.
Hold steadier or move closer.") — matching the desktop pipeline's behavior and
the app's on-screen ⚠ warning box.

## Repo layout

```
index.html          app shell (single page)
manifest.json       PWA manifest (installable, standalone)
sw.js               service worker — full offline precache
js/pipeline.js      preprocess → OCR → classify → NER (ported pipeline)
js/tts.js           offline speech (sentence chunking for iOS)
js/app.js           UI controller, camera, 4K/PDF intake
vendor/             tesseract.js 5.1 + wasm cores ×4, eng.traineddata, pdf.js
assets/             PWA icons
```

## License

MIT — see [LICENSE](LICENSE).
