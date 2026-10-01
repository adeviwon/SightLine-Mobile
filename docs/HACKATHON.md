# Imperial Hackathon Hong Kong & Macau 2026 — Submission Kit

## Track & policy anchor

**Open Challenge** (capped at 5 teams/track — lowest-competition route; the 2025
Gold winner, Team Handy Helpers from Malvern College Hong Kong, won on this track).

SightLine anchors to **five** HK 2026 Policy Address priorities (delivered
2026-09-16, verbatim paragraph numbers):

| Para | Priority | SightLine connection |
|---|---|---|
| 108 | AI Application in Healthcare | on-device AI reads prescriptions/dosages aloud |
| 113 | AI for Welfare Lab ($300M) | exactly the profile of AI-welfare solution the lab funds |
| 398-400 | Gerontechnology Promotion Scheme ($100M) | gerontechnology product for elderly with vision loss |
| 376-377 | Support Persons with Disabilities & Carers | independent document reading without a carer |
| 441-442 | Cybersecurity & digital resilience | zero-network architecture is secure by design |

## Round 1 deliverables (due 2026-10-25)

1. **150-word proposal** — see draft below.
2. **3-5 minute video pitch** — structure in the next section.

### 150-word proposal (draft, 148 words)

> In Hong Kong, over 50,000 people are visually impaired. Many are elderly and
> cannot read medical prescriptions, banking statements, or government letters —
> risking medication errors, financial fraud, and loss of independence. Existing
> reading apps send private documents to cloud servers, violating data privacy.
> SightLine is a fully offline document reader that runs entirely on an iPhone:
> point the camera at any document, and it reads the type, key details, and
> full text aloud — prescriptions, account numbers, warning labels. Nothing
> leaves the device: no internet required, no cloud, zero privacy risk, and it
> works in airplane mode forever after a one-time install. All AI runs on-device
> through WebAssembly OCR with preprocessing for blur, noise, and shadows.
> Aligned with the 2026 Policy Address's AI in Healthcare (Para 108), AI for
> Welfare Lab (Para 113), and Gerontechnology Promotion Scheme (Para 398-400).
> A working installable app with verified zero-network operation demonstrates
> feasibility today.

### Video pitch structure (aim 3:30)

| Time | Beat |
|---|---|
| 0:00-0:25 | Mrs. Chan, 78, alone in Wong Tai Sin, can't read her prescription label |
| 0:25-0:50 | Problem: cloud apps = privacy violation; offline = usable anywhere |
| 0:50-1:00 | Airplane mode ON — on screen, undeniable |
| 1:00-2:20 | Live demo: scan a real prescription → spoken summary with dosages; scan a bank letter → account/card details; show zero bytes on screen |
| 2:20-3:00 | Technical depth: pipeline diagram, 8-condition robustness table, blur/noise handling |
| 3:00-3:20 | Policy: Paras 108/113/398-400 — this is what the $400M funds should buy |
| 3:20-3:30 | Close: "Your eyes, offline. Nothing leaves your phone." + team |

## Grand Final (2026-11-14, Data Technology Hub, TKO)

- Slides submitted 48h ahead (10 slides max — deck outline in VICTORY notes)
- Bring laptop with the PWA served over local hotspot; phone in airplane mode
- Live demo is mandatory — practice 5x, keep a screen recording as backup
- Judges: Imperial academics + industry (Prof Shahid Khan — healthcare; Dr Jackie
  Bell — computing/EDI; Lucas Cheung — Google HK digital strategy). Lead with
  healthcare impact for Khan, technical rigor for Bell, deployment path for Cheung.

## Anticipated Q&A

**"Why not Google Lens / Seeing AI?"** — They upload your bank statement and
prescription to cloud servers. Ours never makes a network call — provable from
the service-worker code in minutes. Also: 90% of blind users live where
internet is unreliable.

**"Is the OCR good enough?"** — 85-95% confidence on readable documents across
eight stress conditions (blur, noise, shadow, rotation, low contrast). When
input is unreadable even to humans, it degrades honestly with a retake prompt
instead of guessing.

**"What about Cantonese?"** — Architecture is language-agnostic: tesseract
traineddata for yue/chi_tra is a drop-in file; the pipeline, UI, and offline
guarantee are unchanged. English ships first for hackathon scope.

**"Team across STEMB?"** — T (on-device WASM ML pipeline), E (image-processing
and degradation engineering), S (vision-science and accessibility research),
M (medication-safety framing), B (deployment via the $100M gerontechnology
scheme and NGO partnerships).

## Evidence to show judges

- Live airplane-mode demo (the mic drop)
- `docs/PRIVACY.md` — five verifiable enforcement mechanisms
- `docs/ARCHITECTURE.md` — 8-condition robustness table with real confidences
- This repo: 25 files, ~41 MB, auditable in minutes
