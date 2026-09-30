import { GAME_TIMING } from './config.js';
const Recognition = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export async function recognitionState(mode) {
  const Ctor = Recognition();
  if (mode === 'off') return { mode: 'manual', label: '手動判定' };
  if (!Ctor) return { mode: 'manual', label: '音声認識は非対応・手動判定' };
  if (mode === 'remote') return { mode: 'remote', label: '通常の音声認識' };
  try {
    const recognition = new Ctor();
    if (!('processLocally' in recognition)) return { mode: 'manual', label: '端末内認識は非対応・手動判定' };
    if (typeof Ctor.available !== 'function') return { mode: 'manual', label: '端末内認識の準備状態を確認できません・手動判定' };
    const status = await Promise.race([Ctor.available({ langs: ['ja-JP'], processLocally: true }), new Promise(resolve => setTimeout(() => resolve('unavailable'), 3500))]);
    return { mode: status === 'available' ? 'local' : 'manual', status, label: status === 'available' ? '端末内の日本語認識が利用可能' : status === 'downloadable' ? '日本語パックをダウンロードすると利用可能' : status === 'downloading' ? '日本語パックをダウンロード中' : '端末内の日本語認識は利用できません・手動判定' };
  } catch { return { mode: 'manual', label: '端末内認識を確認できません・手動判定' }; }
}
export async function installLocalRecognition() {
  const Ctor = Recognition(); if (!Ctor?.install) return false;
  return Ctor.install({ langs: ['ja-JP'], processLocally: true });
}
export class Speech {
  constructor(settings) { this.settings = settings; this.recognition = null; this.utterance = null; this.resolveSpeech = null; this.speechTimer = null; }
  cancelSpeech() {
    clearTimeout(this.speechTimer); globalThis.speechSynthesis?.cancel(); this.utterance = null;
    if (this.resolveSpeech) { const resolve = this.resolveSpeech; this.resolveSpeech = null; resolve(false); }
  }
  async speak(text) {
    this.cancelSpeech();
    if (!this.settings.speechEnabled || !globalThis.speechSynthesis || !text) return false;
    // localService=trueの日本語音声のみ使用。会社情報を読み上げサービスへ送らない。
    let voices = speechSynthesis.getVoices();
    if (!voices.length) {
      await new Promise(resolve => {
        const done = () => { speechSynthesis.removeEventListener('voiceschanged', done); resolve(); };
        speechSynthesis.addEventListener('voiceschanged', done, { once: true }); setTimeout(done, 500);
      }); voices = speechSynthesis.getVoices();
    }
    const voice = voices.find(v => /^ja/i.test(v.lang) && v.localService);
    if (!voice) return false;
    return new Promise(resolve => {
      this.resolveSpeech = resolve; const u = new SpeechSynthesisUtterance(text); this.utterance = u;
      u.lang = 'ja-JP'; u.voice = voice; u.volume = this.settings.speechVolume; u.rate = 1;
      const done = success => { clearTimeout(this.speechTimer); if (this.utterance !== u) return; this.utterance = null; this.resolveSpeech = null; resolve(success); };
      u.onend = () => done(true); u.onerror = () => done(false);
      this.speechTimer = setTimeout(() => { done(false); speechSynthesis.cancel(); }, GAME_TIMING.ttsTimeout);
      try { speechSynthesis.speak(u); } catch { done(false); }
    });
  }
  listen(mode, callbacks) {
    this.stopRecognition(); const Ctor = Recognition();
    if (!Ctor || mode === 'manual') return false;
    const recognition = new Ctor(); this.recognition = recognition;
    recognition.lang = 'ja-JP'; recognition.interimResults = true; recognition.maxAlternatives = 3; recognition.continuous = false;
    if (mode === 'local') {
      if (!('processLocally' in recognition)) { this.recognition = null; return false; }
      recognition.processLocally = true;
    }
    const current = () => this.recognition === recognition;
    recognition.onstart = () => { if (current()) callbacks.onStatus?.('聞き取り中'); };
    recognition.onspeechstart = () => { if (current()) callbacks.onSpeechStart?.(); };
    recognition.onresult = event => {
      if (!current()) return;
      const result = event.results[event.resultIndex];
      if (!result) return;
      const texts = Array.from(result).map(r => r.transcript);
      callbacks.onText?.(texts[0] || ''); if (result.isFinal) callbacks.onResult?.(texts);
    };
    recognition.onerror = event => { if (current()) callbacks.onError?.(event.error); };
    recognition.onend = () => { if (current()) { this.recognition = null; callbacks.onEnd?.(); } };
    try { recognition.start(); return true; } catch { this.recognition = null; callbacks.onError?.('start-failed'); return false; }
  }
  stopRecognition() {
    const recognition = this.recognition; this.recognition = null;
    if (recognition) { recognition.onend = null; recognition.onresult = null; recognition.onerror = null; try { recognition.abort(); } catch {} }
  }
  stop() { this.stopRecognition(); this.cancelSpeech(); }
}
