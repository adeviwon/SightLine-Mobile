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
