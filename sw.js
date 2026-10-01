/* SightLine service worker — offline-first.
 * Precaches the full app shell + OCR engine (wasm + traineddata) on install.
 * Version bump = cache bust. */
const VERSION = "v1.0.0";
const CACHE = `sightline-${VERSION}`;

const PRECACHE = [
  "./", "./index.html",
  "./manifest.json",
  "./js/pipeline.js", "./js/tts.js", "./js/app.js",
  "./vendor/tesseract/tesseract.min.js",
  "./vendor/tesseract/worker.min.js",
  "./vendor/tesseract/tesseract-core.wasm.js",
  "./vendor/tesseract/tesseract-core-simd.wasm.js",
  "./vendor/tesseract/tesseract-core-lstm.wasm.js",
  "./vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
  "./vendor/tesseract/tesseract-core.wasm",
  "./vendor/tesseract/tesseract-core-simd.wasm",
  "./vendor/tesseract/tesseract-core-lstm.wasm",
  "./vendor/tesseract/tesseract-core-simd-lstm.wasm",
  "./vendor/tessdata/eng.traineddata.gz",
  "./vendor/pdfjs/pdf.min.js",
  "./vendor/pdfjs/pdf.worker.min.js",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // addAll fails the whole batch on one miss — add individually and report
      const results = await Promise.allSettled(
        PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" })))
      );
      const failed = results.filter(r => r.status === "rejected").length;
      if (failed > 0) console.warn(`[sw] precache: ${failed}/${PRECACHE.length} failed`);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("sightline-") && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;  // hard offline boundary: same-origin only

  // cache-first for everything (app is fully static)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((resp) => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return resp;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
