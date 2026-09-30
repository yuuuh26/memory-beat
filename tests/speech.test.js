import test from 'node:test';
import assert from 'node:assert/strict';
import { Speech, recognitionState, installLocalRecognition } from '../js/speech.js';
import { graphDays } from '../js/stats.js';
const settings = { speechEnabled: true, speechVolume: .9 };
class FakeRecognition {
  processLocally = false;
  static state = 'available';
  static available = async options => { assert.equal(options.processLocally, true); return FakeRecognition.state; };
  static install = async options => { assert.deepEqual(options.langs, ['ja-JP']); return true; };
  start() { this.started = true; this.onstart?.(); }
  abort() { this.aborted = true; this.onend?.(); }
}
test('音声認識機能検出：非対応・OFFでは手動', async () => {
  delete globalThis.SpeechRecognition; delete globalThis.webkitSpeechRecognition;
  assert.equal((await recognitionState('local')).mode, 'manual'); assert.equal((await recognitionState('off')).mode, 'manual');
});
test('端末内日本語パックの有無、通常認識への無断切り替えなし', async () => {
  globalThis.SpeechRecognition = FakeRecognition;
  FakeRecognition.state = 'available'; assert.equal((await recognitionState('local')).mode, 'local');
  for (const state of ['unavailable', 'downloadable', 'downloading']) { FakeRecognition.state = state; assert.equal((await recognitionState('local')).mode, 'manual'); }
  assert.equal((await recognitionState('remote')).mode, 'remote'); assert.equal(await installLocalRecognition(), true);
});
test('音声成功、話し始め・認識別候補、エラー後も状態コールバック', () => {
  globalThis.SpeechRecognition = FakeRecognition; const speech = new Speech(settings); const results = []; let started = 0, error = null;
  assert(speech.listen('local', { onSpeechStart: () => started++, onResult: texts => results.push(texts), onError: e => error = e }));
  const r = speech.recognition; assert.equal(r.processLocally, true); assert.equal(r.lang, 'ja-JP'); r.onspeechstart();
  const result = [{ transcript: 'スター' }, { transcript: 'すたー' }]; result.isFinal = true; r.onresult({ results: [result], resultIndex: 0 });
  assert.equal(started, 1); assert.deepEqual(results, [['スター', 'すたー']]); r.onerror({ error: 'network' }); assert.equal(error, 'network'); assert.equal(r.processLocally, true);
});
test('停止・一時停止後の古い認識結果を無視する', () => {
  globalThis.SpeechRecognition = FakeRecognition; const speech = new Speech(settings); let called = false;
  speech.listen('local', { onResult: () => called = true }); const r = speech.recognition, oldHandler = r.onresult;
  speech.stopRecognition(); const result = [{ transcript: 'スター' }]; result.isFinal = true; oldHandler({ results: [result], resultIndex: 0 });
  assert.equal(called, false); assert.equal(r.aborted, true);
});
test('端末内認識プロパティがなければ開始しない', () => {
  class NoLocal { start() { throw new Error('開始してはいけない'); } }
  globalThis.SpeechRecognition = NoLocal; const speech = new Speech(settings); assert.equal(speech.listen('local', {}), false);
});
test('TTS：端末内音声なしでは外部音声で読み上げない', async () => {
  let sent = false;
  globalThis.speechSynthesis = { cancel() {}, getVoices: () => [{ lang: 'ja-JP', localService: false }], speak() { sent = true; } };
  assert.equal(await new Speech(settings).speak('架空の問い'), false); assert.equal(sent, false);
});
test('TTS成功・失敗と音量設定、キャンセルでもPromiseを解決', async () => {
  const voice = { lang: 'ja-JP', localService: true };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  let utterance;
  globalThis.speechSynthesis = { cancel() {}, getVoices: () => [voice], speak(u) { utterance = u; queueMicrotask(() => u.onend()); } };
  assert.equal(await new Speech(settings).speak('架空の問い'), true); assert.equal(utterance.voice, voice); assert.equal(utterance.volume, .9);
  speechSynthesis.speak = u => queueMicrotask(() => u.onerror()); assert.equal(await new Speech(settings).speak('架空'), false);
  speechSynthesis.speak = () => {}; const speech = new Speech(settings), pending = speech.speak('架空'); await Promise.resolve(); speech.cancelSpeech(); assert.equal(await pending, false);
});
test('グラフ：未学習日は0%ではなく欠測', () => {
  const days = graphDays([{ date: '2026-09-29', accuracy: .8, count: 2 }], 3, new Date(2026, 8, 30));
  assert.equal(days.length, 3); assert.equal(days[0].accuracy, null); assert.equal(days[1].accuracy, .8); assert.equal(days[2].accuracy, null);
});
