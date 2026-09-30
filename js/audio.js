import { TRACKS } from './config.js';
import { all } from './db.js';
// 依存音源なしのオリジナルBGM。ユーザーの音源はaudio storeだけに保存。
export class AudioEngine {
  constructor(settings) { this.settings = settings; this.context = null; this.timer = null; this.custom = null; this.customURL = null; this.step = 0; }
  async unlock() {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext; if (!Ctor) return;
    this.context ||= new Ctor(); if (this.context.state === 'suspended') await this.context.resume();
  }
  tone(freq, time, duration, volume, type = 'sine', target = null) {
    if (!this.context) return;
    const osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, time); gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + .01); gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    osc.connect(gain); gain.connect(target || this.context.destination); osc.start(time); osc.stop(time + duration + .03);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  drum(kind, time, volume) {
    if (!this.context) return;
    if (kind === 'kick') {
      const osc = this.context.createOscillator(), gain = this.context.createGain();
      osc.frequency.setValueAtTime(115, time); osc.frequency.exponentialRampToValueAtTime(38, time + .14);
      gain.gain.setValueAtTime(volume, time); gain.gain.exponentialRampToValueAtTime(.0001, time + .2);
      osc.connect(gain); gain.connect(this.bgmGain); osc.start(time); osc.stop(time + .22); osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    } else {
      const duration = kind === 'hat' ? .045 : .12, buffer = this.context.createBuffer(1, this.context.sampleRate * duration, this.context.sampleRate);
      const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      source.buffer = buffer; filter.type = 'highpass'; filter.frequency.value = kind === 'hat' ? 6500 : 1600; gain.gain.value = volume;
      source.connect(filter); filter.connect(gain); gain.connect(this.bgmGain); source.start(time); source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    }
  }
  async start() {
    this.stop(); const token = this.token = Symbol(); await this.unlock(); if (!this.context || this.token !== token || !this.settings.bgmVolume) return;
    if (this.settings.bgmTrack === 'custom') {
      const files = await all('audio'); if (this.token !== token) return;
      const file = files.find(f => f.id === 'custom'); if (!file) return;
      this.customURL = URL.createObjectURL(file.blob); this.custom = new Audio(this.customURL); this.custom.loop = true; this.custom.volume = this.settings.bgmVolume;
      try { await this.custom.play(); } catch {} return;
    }
    this.bgmGain = this.context.createGain(); this.bgmGain.gain.value = this.settings.bgmVolume; this.bgmGain.connect(this.context.destination);
    const track = TRACKS.find(t => t.id === this.settings.bgmTrack) || TRACKS[0]; const beat = 60 / track.bpm / 4;
    this.nextTime = this.context.currentTime + .06; this.step = 0;
    const schedule = () => {
      while (this.nextTime < this.context.currentTime + .12) {
        const t = this.nextTime, step = this.step % 16, root = track.roots[Math.floor(this.step / 16) % 4];
        const midi = n => 440 * 2 ** ((n - 69) / 12);
        if (step % 4 === 0) this.drum('kick', t, .55);
        if (step === 4 || step === 12) this.drum('snare', t, .2);
        if (step % 2 === 0) this.drum('hat', t, .1);
        if (step === 0 || step === 8) {
          this.tone(midi(root - 12), t, beat * 3, .28, 'sine', this.bgmGain);
          for (const note of track.notes) this.tone(midi(root + note), t, beat * 7, .035, track.wave, this.bgmGain);
        }
        if (step % 4 === 2) this.tone(midi(root + 12 + track.notes[(step / 2) % track.notes.length]), t, beat * 1.8, .065, track.wave, this.bgmGain);
        this.step++; this.nextTime += beat;
      }
    }; schedule(); this.timer = setInterval(schedule, 40);
  }
  duck(enabled) {
    const volume = this.settings.bgmVolume * (enabled ? .3 : 1);
    if (this.bgmGain && this.context) this.bgmGain.gain.setTargetAtTime(volume, this.context.currentTime, .08);
    if (this.custom) this.custom.volume = volume;
  }
  reward(grade) {
    if (!this.context || !this.settings.seVolume) return;
    const t = this.context.currentTime, v = this.settings.seVolume * .15;
    const notes = grade === 'PERFECT' ? [659, 831, 988, 1319] : grade === 'GREAT' ? [523, 659, 880] : grade === 'GOOD' ? [523, 784] : [180, 120];
    notes.forEach((n, i) => this.tone(n, t + i * .055, .2, v, grade === 'MISS' ? 'triangle' : 'sine'));
  }
  stop() {
    this.token = null; clearInterval(this.timer); this.timer = null;
    if (this.bgmGain && this.context) { const gain = this.bgmGain; gain.gain.setTargetAtTime(0, this.context.currentTime, .02); setTimeout(() => gain.disconnect(), 600); this.bgmGain = null; }
    if (this.custom) { this.custom.pause(); this.custom.src = ''; this.custom = null; }
    if (this.customURL) { URL.revokeObjectURL(this.customURL); this.customURL = null; }
  }
}
