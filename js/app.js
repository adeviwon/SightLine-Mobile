/**
 * SightLine Mobile — app controller.
 * Camera capture, 4K image + PDF intake, pipeline wiring, results UI.
 */
"use strict";

(function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    video: $("video"), preview: $("preview"), flash: $("scan-flash"), scanLine: $("scan-line"),
    qualityHint: $("quality-hint"), capture: $("btn-capture"), retake: $("btn-retake"),
    speak: $("btn-speak"), fileInput: $("file-input"),
    tabCam: $("tab-cam"), tabFile: $("tab-file"),
    progressWrap: $("progress-wrap"), progressLabel: $("progress-label"), progressFill: $("progress-fill"),
    warningBox: $("warning-box"), results: $("results"),
    docType: $("doc-type"), summaryText: $("summary-text"), resultMeta: $("result-meta"),
    fieldsCard: $("fields-card"), fieldsList: $("fields-list"),
    entitiesCard: $("entities-card"), entitiesList: $("entities-list"),
    audio: $("audio-player"), ocrText: $("ocr-text"),
    badge: $("badge"), errorBanner: $("error-banner"),
  };

  let stream = null;
  let lastResult = null;
  let lastSourceCanvas = null;
  let mode = "camera";

  // ── PWA service worker registration ──
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then(() => {
      console.log("[sw] registered — offline cache active");
    }).catch((e) => console.warn("[sw] failed:", e));
  }

  // ── Init OCR engine on load (warm cache) ──
  async function warmEngine() {
    els.badge.textContent = "ENGINE: LOADING…";
    els.badge.className = "pending";
    try {
      await SightLine.initWorker((m) => {
        if (m.status === "loading language traineddata") {
          els.badge.textContent = `ENGINE: DATA ${(m.progress || 0).toFixed(0)}%`;
        } else if (m.status) {
          els.badge.textContent = `ENGINE: ${m.status.toUpperCase()}`;
        }
      });
      els.badge.textContent = "ENGINE: READY · OFFLINE";
      els.badge.className = "";
    } catch (e) {
      els.badge.textContent = "ENGINE ERROR";
      showError("OCR engine failed to initialize: " + e.message);
    }
  }

  function showError(msg) {
    els.errorBanner.style.display = "block";
    els.errorBanner.textContent = "⚠ " + msg;
  }
  function clearError() { els.errorBanner.style.display = "none"; }

  // ── Camera ──
  async function startCamera() {
    if (stream) return;
    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3840 },   // request 4K — Safari picks device max
          height: { ideal: 2160 },
        },
        audio: false,
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      els.video.srcObject = stream;
      await els.video.play();
      // report actual resolution
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      console.log("[camera] resolution:", settings.width, "x", settings.height);
      els.capture.textContent = "Scan Document";
      els.capture.disabled = false;
    } catch (e) {
      els.capture.disabled = true;
      els.capture.textContent = "Camera Unavailable";
      showError("Camera access denied or unavailable. Use the Files tab to select a photo or PDF. (" + e.name + ")");
      switchTab("file");
    }
  }

  function stopCamera() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; els.video.srcObject = null; }
  }

  // ── Tabs ──
  function switchTab(next) {
    mode = next;
    els.tabCam.classList.toggle("active", next === "camera");
    els.tabFile.classList.toggle("active", next === "file");
    if (next === "camera") {
      els.video.style.display = "block";
      els.preview.style.display = "none";
      els.capture.style.display = "block";
      els.capture.textContent = "Scan Document";
      els.retake.style.display = "none";
      els.speak.style.display = "none";
      els.fileInput.style.display = "none";
      startCamera();
    } else {
      els.video.style.display = "none";
      els.capture.style.display = "none";
      els.fileInput.style.display = "block";
      stopCamera();
    }
  }
  els.tabCam.addEventListener("click", () => switchTab("camera"));
  els.tabFile.addEventListener("click", () => switchTab("file"));

  // ── Capture + flash ──
  els.capture.addEventListener("click", async () => {
    clearError();
    if (mode === "camera") {
      if (!stream || els.video.videoWidth === 0) { showError("Camera not ready."); return; }
      const canvas = document.createElement("canvas");
      canvas.width = els.video.videoWidth;
      canvas.height = els.video.videoHeight;
      canvas.getContext("2d").drawImage(els.video, 0, 0);
      els.flash.classList.add("on");
      setTimeout(() => els.flash.classList.remove("on"), 200);
      await processImage(canvas);
    }
  });

  els.retake.addEventListener("click", () => {
    els.results.style.display = "none";
    els.preview.style.display = "none";
    els.retake.style.display = "none";
    els.speak.style.display = "none";
    els.warningBox.style.display = "none";
    TTS.stop();
    if (mode === "camera") switchTab("camera"); else switchTab("file");
  });

  els.speak.addEventListener("click", async () => {
    if (!lastResult) return;
    els.speak.disabled = true;
    els.speak.textContent = "Reading…";
    try {
      const full = els.speak.dataset.full === "1";
      const text = full ? lastResult.ocrText : lastResult.summary;
      await TTS.speak(text);
    } catch (e) {
      showError("Speech failed: " + e.message);
    }
    els.speak.disabled = false;
    els.speak.textContent = "Read Aloud";
  });

  // ── File intake: images (any resolution incl. 4K/48MP) + PDF ──
  els.fileInput.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    clearError();
    try {
      if (file.type === "application/pdf") {
        await processPDF(file);
      } else if (file.type.startsWith("image/")) {
        const bmp = await createImageBitmap(file);
        // draw at native resolution (createImageBitmap keeps full 4K+ pixels)
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width; canvas.height = bmp.height;
        canvas.getContext("2d").drawImage(bmp, 0, 0);
        bmp.close && bmp.close();
        els.preview.src = URL.createObjectURL(file);
        els.preview.style.display = "block";
        els.video.style.display = "none";
        els.retake.style.display = "block";
        els.capture.style.display = "none";
        await processImage(canvas);
      } else {
        showError("Unsupported file type. Use an image or PDF.");
      }
    } catch (e) {
      showError("Could not read file: " + e.message);
    }
    ev.target.value = "";
  });

  async function processPDF(file) {
    setProgress(true, "Reading PDF…");
    try {
      const buf = await file.arrayBuffer();
      pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const page = await pdf.getPage(1);
      // Render at 2x viewport scale for text quality (up to 4K)
      const vp0 = page.getViewport({ scale: 1 });
      const targetW = Math.min(4096, vp0.width * 3);
      const scale = targetW / vp0.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d", { willReadFrequently: true }), viewport }).promise;
      els.preview.src = canvas.toDataURL("image/jpeg", 0.92);
      els.preview.style.display = "block";
      els.retake.style.display = "block";
      els.capture.style.display = "none";
      await processImage(canvas);
    } finally {
      setProgress(false);
    }
  }

  // ── Progress UI ──
  function setProgress(on, label) {
    els.progressWrap.style.display = on ? "block" : "none";
    if (label) els.progressLabel.textContent = label;
  }
  function updateProgress(m) {
    if (m.status) els.progressLabel.textContent = m.status;
    if (typeof m.progress === "number") {
      els.progressFill.style.width = Math.max(0, Math.min(100, m.progress)) + "%";
    }
  }

  // ── Main pipeline run ──
  async function processImage(source) {
    els.results.style.display = "none";
    els.warningBox.style.display = "none";
    els.capture.disabled = true;
    els.capture.textContent = "Scanning…";
    els.scanLine.classList.add("on");
    setProgress(true, "Starting…");
    try {
      lastResult = await SightLine.scan(source, { onProgress: updateProgress, maxDim: 3200 });
      render(lastResult);
      // auto-read summary
      try { await TTS.speak(lastResult.summary); } catch (e) { /* user can tap Read Aloud */ }
    } catch (e) {
      showError("Scan failed: " + e.message);
      console.error(e);
    } finally {
      els.scanLine.classList.remove("on");
      setProgress(false);
      els.capture.disabled = false;
      els.capture.textContent = "Scan Document";
      if (mode === "camera" && !els.preview.style.display || els.preview.style.display === "none") {
        els.speak.style.display = "none";
      } else {
        els.speak.style.display = "block";
      }
      els.speak.textContent = "Read Aloud";
      els.speak.dataset.full = "0";
    }
  }

  function render(r) {
    els.results.style.display = "block";
    els.docType.textContent = r.categoryLabel;
    els.summaryText.textContent = r.summary;
    els.resultMeta.textContent =
      `OCR ${Math.round(r.ocrConfidence * 100)}% · class ${Math.round(r.classificationConfidence * 100)}% · ${r.imageDims} · ${new Date(r.timestamp).toLocaleTimeString()} · 0 bytes sent`;
    els.ocrText.textContent = r.ocrText;

    els.warningBox.style.display = r.warnings.length ? "block" : "none";
    els.warningBox.textContent = "⚠ " + r.warnings.join(" ");

    if (r.fields.length) {
      els.fieldsCard.style.display = "block";
      els.fieldsList.innerHTML = r.fields.map(f =>
        `<div class="field-row"><span class="label">${esc(f.label)}</span><span class="val">${esc(f.value)}</span></div>`
      ).join("");
    } else { els.fieldsCard.style.display = "none"; }

    if (r.entities.length) {
      els.entitiesCard.style.display = "block";
      els.entitiesList.innerHTML = r.entities.map(e =>
        `<span class="tag">${esc(e.label)}: ${esc(e.text)}</span>`
      ).join("");
    } else { els.entitiesCard.style.display = "none"; }

    els.speak.style.display = "block";
    els.retake.style.display = "block";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // pause camera when tab hidden (battery)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { TTS.stop(); stopCamera(); }
    else if (mode === "camera" && els.preview.style.display !== "block") startCamera();
  });

  // iOS voices load async — warm them
  if (TTS.available()) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.getVoices();
  }

  // boot
  switchTab("camera");
  warmEngine();
})();
