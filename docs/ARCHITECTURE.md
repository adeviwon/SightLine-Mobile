# SightLine Mobile — Pipeline Architecture

> For the Imperial Hackathon Hong Kong & Macau 2026 — Open Challenge track.
> Anchored to HK 2026 Policy Address: Para 108 (AI in Healthcare), Para 113
> (AI for Welfare Lab), Para 398-400 (Gerontechnology Promotion Scheme).

## System overview

```
┌─────────────────────────────────────────────────────────────┐
│                    iPhone (Safari PWA)                       │
│                                                              │
│  ┌──────────┐   ┌───────────────┐   ┌───────────────────┐  │
│  │  Camera   │   │ Files (4K)    │   │ PDF (pdf.js → 4K) │  │
│  │ getUserM. │   │ createImageB. │   │ 3x render scale   │  │
│  └────┬─────┘   └──────┬────────┘   └────────┬──────────┘  │
│       └────────────────┼─────────────────────┘             │
│                        ▼                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  PREPROCESS (js/pipeline.js — canvas, ~50-200ms)     │   │
│  │  1. load to canvas (≤3200px OCR canvas; detail kept) │   │
│  │  2. grayscale                                        │   │
│  │  3. quality: Laplacian var (blur) + mean (dark)      │   │
│  │     + noise detector (lapVar > 800)                  │   │
│  │  4. deskew: two-stage projection sweep               │   │
│  │     (coarse ±10°@1° → refine ±1°@0.25°)              │   │
│  │  5. tile-CLAHE contrast (8×8 grid, clip 3.0)         │   │
│  │  6. adaptive restore:                                │   │
│  │     noisy → 3×3 median · blurry → unsharp σ3         │   │
│  │     both → median then unsharp                       │   │
│  │  7. Otsu binarize (fallback candidate)               │   │
│  │  output: deduped candidates [enhanced, restored,     │   │
│  │          binary] + quality flags + warnings          │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  OCR — tesseract.js 5.1 (WASM, on-device)            │   │
│  │  multi-pass: 3 stages × 3 PSMs (6/3/11)              │   │
│  │  early-exit ≥75% conf · garbage reject (>500 words   │   │
│  │  or >60% 1-2-char words) · conf >40% gate            │   │
│  │  least-bad fallback + quality warning                │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  UNDERSTANDING (pure JS, <5ms)                       │   │
│  │  1. normalize OCR confusions (S00mg→500mg, m9→mg)    │   │
│  │  2. classify: keyword density (banking/medical/      │   │
│  │     legal/general)                                   │   │
│  │  3. extract fields: dosage, account, IBAN, sort      │   │
│  │     code, balance, clause, case no, patient          │   │
│  │  4. NER: drugs (22), dosages, money, dates, orgs     │   │
│  │  5. natural-language summary                         │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  SPEECH — iOS Speech Synthesis (offline)             │   │
│  │  sentence-chunked (180 chars) · en-GB · queue        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  Service worker: 23-file precache (40MB) · same-origin      │
│  fetch only · zero external URLs                            │
└─────────────────────────────────────────────────────────────┘
```

## Why these choices (design rationale)

**Grayscale-first OCR input, binary as fallback.** Empirically verified: on blur σ=2,
CLAHE grayscale reads at 62-89% confidence while Otsu binary drops to 59% — thresholding
destroys weak edges on blurred strokes. The binary candidate is kept for shadow cases
where it wins. Candidates are deduped to avoid repeat passes.

**Multi-pass OCR with early exit.** Tesseract's page-segmentation modes trade recall
against noise rejection. PSM 6 (uniform block) suits documents; PSM 3 (auto) recovers
when layout is irregular; PSM 11 (sparse) survives heavy noise. Early exit at ≥75%
keeps median latency near one pass (~1-2s on iPhone).

**Adaptive restoration instead of one-size denoise.** Median filtering salt-pepper
noise is a win (84.6% vs 0% at σ=25) but destroys blurred strokes (blur2 → NONE).
Unsharp mask restores blur. Applying the right inverse per damage type is the single
biggest accuracy lever in the chain.

**Confusion normalization is a hackathon-grade trick worth highlighting:** OCR reads
blurry "500mg" as "S00mg" or "m9". Deterministic post-fixes recover structured fields
that pure regex would miss —Dosage extraction works at 48% image confidence.

**Speech via the platform, not bundled.** iOS Speech Synthesis runs offline on-device,
supports 180-char sentence chunking (iOS truncates long utterances), and costs 0 bytes
of app size versus a bundled neural TTS.

## Performance (iPhone-class hardware, measured on the VPS replica)

| Stage | Clean | Blur/Noise |
|---|---|---|
| preprocess (incl. deskew sweep) | 50-150ms | 150-400ms |
| OCR (first good pass) | 1-2s | 2-4s (multi-pass) |
| classify + extract + NER | <5ms | <5ms |
| speech start | <100ms | <100ms |

## Failure policy

No stage throws on bad input. Degradation ladder:
readable → full result · noisy/blurry → result + ⚠ on-screen warning ·
sub-readable → least-bad text + retake guidance. The user is never stuck
without feedback.

## Desktop ↔ Mobile parity

| Concern | Desktop (SightLine) | Mobile (this repo) |
|---|---|---|
| preprocess | OpenCV (bilateral, CLAHE, deskew) | Canvas (median, tile-CLAHE, projection deskew) |
| OCR | Tesseract CLI/pytesseract, PSM 6/3/11 | tesseract.js WASM, same PSM ladder |
| restore | bilateral + unsharp | median + unsharp |
| classify/NER | sklearn TF-IDF + regex | keyword-density + regex (no deps) |
| TTS | espeak-ng WAV | iOS Speech Synthesis |
| offline enforcement | Docker `network_mode: none` | SW precache + same-origin fetch only |
| tests | pytest, 37 (22 core + 15 real-world) | node unit batteries + 8-condition image gate |

## Verification evidence

- 8-condition image gate (clean/blur2/blur3/noise25/rot6/shadow/lowcontrast/everything):
  6 PASS, blur2 WARN with fields, blur3 degrades with warning (sub-readable input).
- Node unit batteries: classification, normalization, NER, summary.
- 23/23 service-worker precache entries resolve on disk.
- Zero external URLs in runtime code (regex-scanned).
