/**
 * SightLine TTS — offline text-to-speech.
 * Primary: Web Speech API (speechSynthesis) — built into iOS Safari, works offline.
 * Fallback: none needed on iOS; desktop browsers also support speechSynthesis.
 */

"use strict";

const TTS = (() => {
  let lastUtterance = null;

  function available() {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  function speak(text, opts = {}) {
    if (!available()) return Promise.reject(new Error("speechSynthesis unavailable"));
    if (!text || !text.trim()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        window.speechSynthesis.cancel();  // stop anything queued
        // Long text: iOS truncates utterances > ~200 chars in some versions.
        // Split into sentences and queue them.
        const chunks = chunkText(text, 180);
        let completed = 0;
        chunks.forEach((chunk, idx) => {
          const u = new SpeechSynthesisUtterance(chunk);
          u.rate = opts.rate ?? 1.0;
          u.pitch = opts.pitch ?? 1.0;
          u.volume = 1.0;
          u.lang = opts.lang || "en-GB";
          const voices = window.speechSynthesis.getVoices();
          const v = voices.find(v => v.lang && v.lang.startsWith("en")) ||
                    voices[0];
          if (v) u.voice = v;
          if (idx === chunks.length - 1) {
            u.onend = () => resolve();
            u.onerror = (e) => reject(new Error("TTS error: " + (e.error || "unknown")));
          }
          lastUtterance = u;
          window.speechSynthesis.speak(u);
        });
        // Safety resolve if no events fire (some WebViews)
        setTimeout(() => {
          if (!window.speechSynthesis.speaking && completed === 0) resolve();
        }, 500);
      } catch (e) {
        reject(e);
      }
    });
  }

  function chunkText(text, maxLen) {
    // split on sentence boundaries, then hard-wrap long sentences
    const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
    const chunks = [];
    let cur = "";
    for (const s of sentences) {
      if ((cur + " " + s).trim().length <= maxLen) {
        cur = (cur + " " + s).trim();
      } else {
        if (cur) chunks.push(cur);
        if (s.length <= maxLen) { cur = s; }
        else {
          for (let i = 0; i < s.length; i += maxLen) chunks.push(s.slice(i, i + maxLen));
          cur = "";
        }
      }
    }
    if (cur) chunks.push(cur);
    return chunks.length ? chunks : [text.slice(0, maxLen)];
  }

  function stop() {
    if (available()) window.speechSynthesis.cancel();
  }

  return { speak, stop, available, chunkText };
})();

if (typeof module !== "undefined" && module.exports) module.exports = TTS;
