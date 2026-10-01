# SightLine Mobile — Privacy & Offline Guarantee

## The claim

**Nothing you scan leaves your phone.** SightLine Mobile performs all OCR,
classification, entity extraction, and speech synthesis on-device. There is no
server, no API key, no telemetry, and no network dependency after install.

## How the guarantee is enforced (verifiable, not a promise)

1. **Service worker precache** — `sw.js` caches all 23 app files (40.7 MB,
   including the tesseract.js WASM cores and English traineddata) on first load.
   Every subsequent load is served from cache.
2. **Same-origin fetch policy** — the fetch handler rejects anything not on the
   app's own origin. There is no code path that can send image bytes anywhere.
3. **Zero external URLs** — runtime source (index.html, js/*, sw.js, manifest.json)
   regex-scanned for `https?://`: **0 hits**.
4. **Camera frames never leave memory** — video frames are drawn to an in-memory
   canvas and handed to WASM inference. No upload path exists in the code.
5. **Installable from a LAN** — the app can be served from a laptop over local
   Wi-Fi one time; after install it works in airplane mode forever.

An auditor can verify all five claims in minutes: the repo is small, static,
and dependency-free. This is the browser equivalent of the desktop repo's
Docker `network_mode: "none"`.

## Why it matters (hackathon framing)

- Existing apps (Google Lens, Seeing AI, Be My Eyes) upload document photos to
  cloud servers. For banking statements, prescriptions, and legal letters, that
  is a privacy violation blind users are forced to accept for independence.
- 2026 HK Policy Address anchor: Para 441-442 (cybersecurity & digital
  resilience) — zero-network architecture is security by design.
- 90% of visually impaired people live in regions with unreliable internet —
  offline isn't a feature, it's the difference between usable and useless.

## Data handling

| Data | Where it lives | Lifetime |
|---|---|---|
| Camera frames | RAM (canvas) | discarded after scan |
| OCR text/results | JS memory + on-screen | session only |
| Speech | device audio output | transient |
| OCR engine files | browser cache (installed app) | until app removed |

No data is written to disk beyond the standard browser app cache. Uninstall
(the Home-Screen delete) removes everything.
