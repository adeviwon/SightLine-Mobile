/**
 * SightLine pipeline — browser port of the Python on-device pipeline.
 * Mirrors src/offscan/{preprocess,ocr,classifier,ner}.py from the desktop repo.
 * Stages: preprocess (canvas) -> tesseract.js OCR (multi-pass) -> classify -> NER.
 */

"use strict";

const SightLine = (() => {

  // ── Preprocessing: mirrors preprocess.py ──────────────────────────────

  /**
   * Assess image quality: blur (Laplacian variance) + brightness.
   * @returns {{quality:number, blurry:boolean, dark:boolean, warnings:string[]}}
   */
  function assessQuality(gray) {
    const { width: w, height: h } = gray;
    // Laplacian variance via a 4-neighbour kernel on a downsample for speed
    const scale = Math.max(1, Math.floor(Math.max(w, h) / 1200));
    const sw = Math.floor(w / scale), sh = Math.floor(h / scale);
    const c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(gray, 0, 0, sw, sh);
    const px = ctx.getImageData(0, 0, sw, sh).data;

    const lum = new Float32Array(sw * sh);
    let sum = 0;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      lum[j] = l; sum += l;
    }
    const mean = sum / lum.length;

    // Laplacian variance
    let varSum = 0;
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const i = y * sw + x;
        const lap = lum[i - 1] + lum[i + 1] + lum[i - sw] + lum[i + sw] - 4 * lum[i];
        varSum += lap * lap;
      }
    }
    const lapVar = varSum / ((sw - 2) * (sh - 2));

    const blurry = lapVar < 100;
    const dark = mean < 50;
    const warnings = [];
    if (blurry) warnings.push("Image may be blurry. Hold steadier or move closer.");
    if (dark) warnings.push("Image is dark. Try better lighting.");
    return { quality: Math.min(1, lapVar / 500), blurry, dark, warnings };
  }

  /**
   * Deskew estimate from text-line angles (mirrors _estimate_skew_angle).
   */
  function estimateSkew(grayCanvas) {
    const ctx = grayCanvas.getContext("2d", { willReadFrequently: true });
    const { width: w, height: h } = grayCanvas;
    const px = ctx.getImageData(0, 0, w, h).data;
    const lum = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      lum[j] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0;
    }
    // Otsu threshold (single pass histogram)
    const hist = new Uint32Array(256);
    for (let i = 0; i < lum.length; i++) hist[lum[i]]++;
    const total = lum.length;
    let sumB = 0, wB = 0, maxVar = 0, thresh = 127;
    let wF, mB, mF, between, sumTotal = 0;
    for (let t = 0; t < 256; t++) sumTotal += t * hist[t];
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (wB === 0) continue;
      wF = total - wB; if (wF === 0) break;
      sumB += t * hist[t];
      mB = sumB / wB; mF = (sumTotal - sumB) / wF;
      between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) { maxVar = between; thresh = t; }
    }
    // Row-projection profile angle estimate: coarse sweep of shear scores
    // (cheap approximation of minAreaRect on text lines)
    for (let angleDeg = -10; angleDeg <= 10; angleDeg += 0.5) {
      const rad = angleDeg * Math.PI / 180;
      let score = 0;
      for (let y = 2; y < h - 2; y += 4) {
        for (let x = 8; x < w - 8; x += 6) {
          const dy = Math.round(Math.tan(rad) * x);
          const yy = y + dy;
          if (yy < 1 || yy >= h - 1) continue;
          const v = lum[yy * w + x];
          if (v < thresh) score++;
        }
      }
    }
    // pick the angle whose projection sharpens the most
    let bestAngle = 0, bestScore = -1;
    for (let angleDeg = -10; angleDeg <= 10; angleDeg += 0.5) {
      const rad = angleDeg * Math.PI / 180;
      let score = 0;
      for (let y = 2; y < h - 2; y += 4) {
        for (let x = 8; x < w - 8; x += 6) {
          const yy = y + Math.round(Math.tan(rad) * x);
          if (yy < 1 || yy >= h - 1) continue;
          if (lum[yy * w + x] < thresh) score++;
        }
      }
      if (score > bestScore) { bestScore = score; bestAngle = angleDeg; }
    }
    return Math.abs(bestAngle) < 0.5 ? 0 : bestAngle;
  }

  /**
   * Full preprocess: grayscale -> deskew -> contrast (CLAHE-equivalent) -> output canvas.
   * Returns { canvas, candidates, quality, warnings, skew }.
   * candidates = [enhanced, denoised, binarized] mirroring ocr.py stage fallback.
   */
  function preprocess(source, maxDim = 3200) {
    // Load to canvas, downscale only above maxDim (preserve 4K text detail)
    const c0 = document.createElement("canvas");
    const ictx = c0.getContext("2d", { willReadFrequently: true });
    let sw = source.videoWidth || source.naturalWidth || source.width;
    let sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) throw new Error("No image dimensions — invalid input");
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    c0.width = Math.round(sw * scale);
    c0.height = Math.round(sh * scale);
    ictx.drawImage(source, 0, 0, c0.width, c0.height);

    // grayscale
    const gray = document.createElement("canvas");
    gray.width = c0.width; gray.height = c0.height;
    const gctx = gray.getContext("2d", { willReadFrequently: true });
    gctx.drawImage(c0, 0, 0);
    const gd = gctx.getImageData(0, 0, gray.width, gray.height);
    const d = gd.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    gctx.putImageData(gd, 0, 0);

    const q = assessQuality(gray);

    // deskew
    const angle = estimateSkew(gray);
    let deskewed = gray;
    if (angle !== 0) {
      const dk = document.createElement("canvas");
      dk.width = gray.width; dk.height = gray.height;
      const dctx = dk.getContext("2d", { willReadFrequently: true });
      dctx.fillStyle = "#fff";
      dctx.fillRect(0, 0, dk.width, dk.height);
      dctx.translate(dk.width / 2, dk.height / 2);
      dctx.rotate(-angle * Math.PI / 180);  // negative = correct the skew
      dctx.drawImage(gray, -dk.width / 2, -dk.height / 2);
      deskewed = dk;
    }

    // CLAHE-equivalent: tile-based adaptive contrast (8x8 grid like OpenCV)
    const enhanced = document.createElement("canvas");
    enhanced.width = deskewed.width; enhanced.height = deskewed.height;
    const ectx = enhanced.getContext("2d", { willReadFrequently: true });
    ectx.drawImage(deskewed, 0, 0);
    const ed = ectx.getImageData(0, 0, enhanced.width, enhanced.height);
    const ep = ed.data;
    const tileW = Math.max(32, Math.floor(enhanced.width / 8));
    const tileH = Math.max(32, Math.floor(enhanced.height / 8));
    for (let ty = 0; ty < enhanced.height; ty += tileH) {
      for (let tx = 0; tx < enhanced.width; tx += tileW) {
        const ex = Math.min(tx + tileW, enhanced.width);
        const ey = Math.min(ty + tileH, enhanced.height);
        // tile histogram + clip
        const hist = new Uint32Array(256);
        let n = 0;
        for (let yy = ty; yy < ey; yy++) {
          for (let xx = tx; xx < ex; xx++) {
            hist[ep[(yy * enhanced.width + xx) * 4]]++; n++;
          }
        }
        const clip = Math.max(1, (n * 3.0 / 256) | 0);  // clipLimit 3.0
        let excess = 0;
        for (let v = 0; v < 256; v++) { if (hist[v] > clip) { excess += hist[v] - clip; hist[v] = clip; } }
        const add = (excess / 256) | 0;
        const lut = new Uint8Array(256);
        let cdf = 0;
        for (let v = 0; v < 256; v++) {
          cdf += hist[v] + add;
          lut[v] = Math.min(255, (cdf * 255 / n) | 0);
        }
        for (let yy = ty; yy < ey; yy++) {
          for (let xx = tx; xx < ex; xx++) {
            const idx = (yy * enhanced.width + xx) * 4;
            const v = lut[ep[idx]];
            ep[idx] = ep[idx + 1] = ep[idx + 2] = v;
          }
        }
      }
    }
    ectx.putImageData(ed, 0, 0);

    // bilateral-ish denoise: 3x3 median on strong-noise images only (fast path)
    let denoised = enhanced;
    if (q.quality < 0.6) {
      denoised = document.createElement("canvas");
      denoised.width = enhanced.width; denoised.height = enhanced.height;
      const nctx = denoised.getContext("2d", { willReadFrequently: true });
      const srcData = enhanced.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, enhanced.width, enhanced.height);
      const out = nctx.createImageData(enhanced.width, enhanced.height);
      const s = srcData.data, o = out.data, W = enhanced.width;
      for (let y = 1; y < enhanced.height - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = (y * W + x) * 4;
          // 9-tap median on luma channel (approximate, cheap)
          const vals = [];
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            vals.push(s[i + (dy * W + dx) * 4]);
          }
          vals.sort((a, b) => a - b);
          const m = vals[4];
          o[i] = o[i + 1] = o[i + 2] = m; o[i + 3] = 255;
        }
      }
      nctx.putImageData(out, 0, 0);
    }

    // binarize: Otsu fallback candidate
    const binary = document.createElement("canvas");
    binary.width = denoised.width; binary.height = denoised.height;
    const bctx = binary.getContext("2d", { willReadFrequently: true });
    const bd = bctx.getImageData(0, 0, binary.width, binary.height);
    const bp = bd.data;
    const hist = new Uint32Array(256);
    const total = binary.width * binary.height;
    for (let i = 0; i < bp.length; i += 4) hist[bp[i]]++;
    let sumT = 0; for (let t = 0; t < 256; t++) sumT += t * hist[t];
    let wB = 0, sumB = 0, maxVar = 0, otsu = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sumT - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) { maxVar = between; otsu = t; }
    }
    for (let i = 0; i < bp.length; i += 4) {
      const v = bp[i] > otsu ? 255 : 0;
      bp[i] = bp[i + 1] = bp[i + 2] = v;
    }
    bctx.putImageData(bd, 0, 0);

    return {
      canvas: enhanced,
      candidates: [enhanced, denoised, binary],
      quality: q.quality,
      blurry: q.blurry,
      dark: q.dark,
      warnings: q.warnings,
      skew: angle,
      width: c0.width,
      height: c0.height,
    };
  }

  // ── OCR: tesseract.js multi-pass (mirrors ocr.py) ─────────────────────

  let _worker = null;

  async function initWorker(onProgress) {
    if (_worker) return _worker;
    const worker = await Tesseract.createWorker("eng", 1, {
      workerPath: "vendor/tesseract/worker.min.js",
      corePath: "vendor/tesseract",
      langPath: "vendor/tessdata",
      gzip: true,
      logger: (m) => {
        if (onProgress) onProgress(m);
      },
    });
    _worker = worker;
    return worker;
  }

  function isGarbage(text, wordCount) {
    if (!text || text.trim().length < 10) return true;
    if (wordCount > 500) return true;
    const words = text.split(/\s+/);
    const short = words.filter(w => w.length <= 2).length;
    return words.length > 0 && short / words.length > 0.6;
  }

  /**
   * Multi-pass OCR: PSM 6 primary, then PSM 3/11 fallbacks across stage candidates.
   * @param {Array<HTMLCanvasElement>} candidates - preprocessed stage canvases
   */
  async function runOCR(candidates, onProgress) {
    const worker = await initWorker(onProgress);
    const passes = [
      { psm: "6", label: "block" },
      { psm: "3", label: "auto" },
      { psm: "11", label: "sparse" },
    ];
    let best = null;
    for (const img of candidates) {
      for (const p of passes) {
        await worker.setParameters({ tessedit_pageseg_mode: p.psm });
        const res = await worker.recognize(img);
        const data = res.data;
        const garbage = isGarbage(data.text, data.words ? data.words.length : 0);
        const conf = data.confidence || 0;
        if (onProgress) onProgress({ status: `pass ${p.label} conf ${conf.toFixed(0)}%` });
        if (!garbage && conf > 40 && (!best || conf > best.confidence)) {
          best = { text: data.text, confidence: conf / 100, words: data.words || [], psm: p.psm };
          if (best.confidence > 0.75) return best;  // good enough, stop early
        }
      }
    }
    if (!best) {
      // least-bad fallback: first candidate PSM 6
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      const res = await worker.recognize(candidates[0]);
      best = { text: res.data.text, confidence: (res.data.confidence || 0) / 100, words: res.data.words || [], psm: "6" };
    }
    return best;
  }

  // ── Classifier: mirrors classifier.py categories + regex fields ───────

  const DRUGS = ["Amoxicillin","Metformin","Lisinopril","Atorvastatin","Amlodipine","Ibuprofen","Paracetamol","Aspirin","Omeprazole","Simvastatin","Warfarin","Insulin","Prednisolone","Sertraline","Citalopram","Ramipril","Bisoprolol","Salbutamol","Codeine","Tramadol","Diclofenac","Naproxen"];

  const CATEGORY_KEYWORDS = {
    banking: ["account number","sort code","balance","deposit","withdrawal","iban","statement","bank","hsbc","barclays","lloyds","natwest","santander","card ending","direct debit","standing order","mortgage","credit card","transaction","payment","£","$","eur","usd"],
    medical: ["prescription","rx","dosage","mg","ml","tablet","capsule","patient","diagnosis","medication","warning","take one","twice daily","three times","daily","pharmacy","doctor","nhs","drug","dose","treatment","symptoms","keep out of reach","drowsiness"],
    legal: ["contract","agreement","clause","hereby","witnesseth","party","parties","tenant","landlord","lease","liability","terms and conditions","binding","court","case no","plaintiff","defendant","judgment","warrant","affidavit","notarized","power of attorney","testament"],
  };

  function classify(text) {
    const t = text.toLowerCase();
    let best = { category: "general", confidence: 0.1 };
    for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
      let hits = 0;
      for (const kw of kws) {
        if (t.includes(kw)) hits++;
      }
      // confidence heuristic: keyword hit density
      const conf = Math.min(0.95, hits * 0.09 + 0.05);
      if (hits > 0 && conf > best.confidence) {
        best = { category: cat, confidence: conf, hits };
      }
    }
    return best;
  }

  // OCR-confusion normalization (mirrors classifier.py fix)
  function normalizeOCRText(text) {
    return text
      // OCR confusions (verified from real blurry-cam output):
      // S00m9 -> 500mg : leading S before digits is a misread 5
      .replace(/\bS(?=\d{2,4}(?:m[gq]|m1|1m|mg|ml)?\b)/g, "5")
      // m9 -> mg (9 misread for g); m1 -> ml (1 misread for l)
      .replace(/m9\b/gi, "mg")
      .replace(/m1\b/gi, "ml")
      // "50mg mg" style dupes from chained fixes
      .replace(/\s*\b(mg|ml)\s+\1\b/gi, " $1");
  }

  const PATTERNS = {
    medical: {
      "Medication": /(?:Rx\s*:\s*|medication\s*:\s*|prescription\s+for\s+)([A-Z][a-z]+(?:\s\d{1,4}\s?mg)?)/gi,
      "Dosage": /(\d{1,4}[\dOo]?)\s*(m[gq]|m1|1m|mL|mI|tab1ets?|tablets?|capsul[ce]s?)/gi,
      "Frequency": /(every\s*\d+\s*(?:hours?|hrs)|\d+\s*times?\s*(?:a\s*)?day|once daily|twice daily|three times daily|at bedtime)/gi,
      "Warning": /((?:WARNING|Caution|Do not|Avoid|May cause|Consult|Keep out)[^.\n]+)/gi,
      "Patient": /(?:patient|name)\s*[:#]?\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
    },
    banking: {
      "Account Number": /account\s*(?:no|number)?\s*[:#]?\s*(\d{6,12})/gi,
      "Sort Code": /sort\s*code\s*[:#]?\s*(\d{2}[-\s]?\d{2}[-\s]?\d{2})/gi,
      "IBAN": /(GB\d{2}\s?[A-Z]{4}\s?[\dA-Z]{4}\s?\d{4}[\dA-Z]?\s?\d{4})/gi,
      "Balance": /(?:balance|available)\s*[:#]?\s*(?:£|\$|€)?\s*([\d,]+\.\d{2})/gi,
      "Card Ending": /(?:card\s+)?ending\s*(?:in\s*)?(\d{4})/gi,
      "Amount": /(£|\$|€)\s*([\d,]+\.\d{2})/gi,
    },
    legal: {
      "Case Number": /(?:case|matter)\s*(?:no|number)?\s*[:#]?\s*([\w-]+-\d+)/gi,
      "Date": /(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
      "Clause": /(?:clause|section)\s+(\d+(?:\.\d+)?)/gi,
      "Parties": /between\s+([A-Z][\w\s]{2,40}?)\s+and\s+([A-Z][\w\s]{2,40})/gi,
    },
    general: {
      "Date": /(\d{1,2}\/\d{1,2}\/\d{2,4})/g,
      "Phone": /(\+?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4})/g,
      "Email": /([\w.+-]+@[\w-]+\.[\w.-]+)/g,
      "Time": /(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi,
    },
  };

  function extractFields(text, category) {
    const fields = [];
    const pats = PATTERNS[category] || PATTERNS.general;
    for (const [label, re] of Object.entries(pats)) {
      const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m;
      let count = 0;
      while ((m = rx.exec(text)) !== null && count < 6) {
        const value = m.slice(1).filter(Boolean).join(" ").trim();
        if (value && value.length > 1) {
          fields.push({ label, value, confidence: 0.88 });
          count++;
        }
        if (m.index === rx.lastIndex) rx.lastIndex++;  // zero-length guard
      }
    }
    return fields;
  }

  // ── NER: mirrors ner.py regex layer ──────────────────────────────────

  function extractEntities(text) {
    const entities = [];
    const push = (label, value) => {
      if (value && value.trim().length > 1) entities.push({ label, text: value.trim(), confidence: 0.9 });
    };
    for (const drug of DRUGS) {
      const re = new RegExp(`\\b${drug}\\b`, "gi");
      if (re.test(text)) push("DRUG", drug);
    }
    let m;
    const dosageRe = /\b(\d{1,4}\s*(?:mg|ml|mcg|micrograms?|tablets?|capsules?))\b/gi;
    while ((m = dosageRe.exec(text))) push("DOSAGE", m[1]);
    const moneyRe = /(£|\$|€)\s*([\d,]+\.\d{2})|\b([\d,]+\.\d{2})\s*(?:GBP|USD|EUR)/gi;
    while ((m = moneyRe.exec(text))) push("MONEY", (m[2] ? m[1] + m[2] : m[3] + " " + m[4]).trim());
    const dateRe = /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/gi;
    while ((m = dateRe.exec(text))) push("DATE", m[1]);
    const orgRe = /\b(HSBC|Barclays|Lloyds|NatWest|Santander|NHS|Halifax|TSB|Monzo|Revolut)\b/gi;
    while ((m = orgRe.exec(text))) push("ORG", m[1]);
    const personRe = /(?:patient|name|account holder)\s*[:#]\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/g;
    while ((m = personRe.exec(text))) push("PERSON", m[1]);
    // dedupe by label+text
    const seen = new Set();
    return entities.filter(e => {
      const k = e.label + ":" + e.text;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  // ── Summary: natural language for TTS (mirrors classifier.py summary) ─

  function buildSummary(category, fields, text) {
    const byLabel = {};
    for (const f of fields) (byLabel[f.label] = byLabel[f.label] || []).push(f.value);
    const g = (l) => byLabel[l] || [];
    const parts = [];
    if (category === "medical") {
      parts.push("This is a medical prescription.");
      if (g("Patient").length) parts.push(`Patient: ${g("Patient")[0]}.`);
      if (g("Medication").length) parts.push(`Medications: ${g("Medication").slice(0, 4).join(", ")}.`);
      if (g("Dosage").length) parts.push(`Dosages: ${g("Dosage").slice(0, 4).join(", ")}.`);
      if (g("Frequency").length) parts.push(`Frequency: ${g("Frequency").slice(0, 2).join(", ")}.`);
      if (g("Warning").length) parts.push(`Warning: ${g("Warning").slice(0, 2).join(" ")}`);
    } else if (category === "banking") {
      parts.push("This is a banking document.");
      if (g("Account Number").length) parts.push(`Account number: ${g("Account Number")[0]}.`);
      if (g("Card Ending").length) parts.push(`Card ending ${g("Card Ending")[0]}.`);
      if (g("Balance").length) parts.push(`Balance: ${g("Balance")[0]}.`);
      if (g("Amount").length) parts.push(`Amounts: ${g("Amount").slice(0, 3).join(", ")}.`);
    } else if (category === "legal") {
      parts.push("This is a legal document.");
      if (g("Case Number").length) parts.push(`Case reference: ${g("Case Number")[0]}.`);
      if (g("Date").length) parts.push(`Date: ${g("Date")[0]}.`);
      if (g("Clause").length) parts.push(`Clauses: ${g("Clause").slice(0, 3).join(", ")}.`);
    } else {
      parts.push("This is a document.");
      if (g("Date").length) parts.push(`Date: ${g("Date")[0]}.`);
      if (g("Time").length) parts.push(`Time: ${g("Time")[0]}.`);
    }
    return parts.join(" ");
  }

  // ── Full pipeline ─────────────────────────────────────────────────────

  async function scan(source, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    onProgress({ status: "preprocessing", progress: 5 });
    const pp = preprocess(source, opts.maxDim || 3200);
    onProgress({ status: `image ${pp.width}x${pp.height}${pp.blurry ? " (blurry)" : ""}`, progress: 15 });

    onProgress({ status: "loading OCR engine", progress: 20 });
    const ocr = await runOCR(pp.candidates, (m) => onProgress({ status: m.status || "OCR", progress: 20 + Math.min(60, (m.progress || 0) * 0.6) }));
    onProgress({ status: "OCR complete", progress: 85 });

    const normalized = normalizeOCRText(ocr.text);
    const cls = classify(normalized);
    const fields = extractFields(normalized, cls.category);
    const entities = extractEntities(normalized);
    const summary = buildSummary(cls.category, fields, normalized);
    onProgress({ status: "done", progress: 100 });

    return {
      ocrText: ocr.text,
      ocrConfidence: ocr.confidence,
      normalized,
      category: cls.category,
      categoryLabel: { banking: "Banking / Financial Document", medical: "Medical Prescription", legal: "Legal Document", general: "General Document" }[cls.category],
      classificationConfidence: cls.confidence,
      fields,
      entities,
      summary,
      warnings: pp.warnings,
      quality: pp.quality,
      imageDims: `${pp.width}x${pp.height}`,
      timestamp: new Date().toISOString(),
    };
  }

  async function dispose() {
    if (_worker) { try { await _worker.terminate(); } catch (e) {} _worker = null; }
  }

  return { scan, preprocess, initWorker, dispose, classify, normalizeOCRText, extractFields, extractEntities, buildSummary };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SightLine;
