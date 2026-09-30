import { SCHEMA_VERSION, DEFAULT_SETTINGS, DIFFICULTIES, TRACKS } from './config.js';
import { write } from './db.js';
import { $, bind, dialog, closeDialog, downloadJSON, escapeHTML as esc, toast, nowISO } from './utils.js';
const fail = message => { throw new Error(message); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const safeId = id => typeof id === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(id);
function list(data, key) {
  if (!Array.isArray(data[key]) || data[key].length > 500000) fail(`${key}の形式・件数が不正です`);
  const ids = new Set();
  for (const record of data[key]) {
    if (!object(record) || !safeId(record.id) || ids.has(record.id)) fail(`${key}のIDが不正または重複しています`);
    ids.add(record.id);
  }
  return ids;
}
export function sanitizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS };
  for (const key of ['speechEnabled', 'vibration', 'effects', 'allowSan', 'remoteConsent']) if (typeof input[key] === 'boolean') s[key] = input[key];
  for (const key of ['speechVolume', 'bgmVolume', 'seVolume']) if (Number.isFinite(input[key]) && input[key] >= 0 && input[key] <= 1) s[key] = input[key];
  if (['local', 'remote', 'off'].includes(input.recognitionMode)) s.recognitionMode = input.recognitionMode;
  if (Object.hasOwn(DIFFICULTIES, input.difficulty)) s.difficulty = input.difficulty;
  if ([...TRACKS.map(t => t.id), 'custom'].includes(input.bgmTrack)) s.bgmTrack = input.bgmTrack;
  if (Array.isArray(input.favoriteMinutes)) s.favoriteMinutes = [...new Set(input.favoriteMinutes.filter(n => Number.isInteger(n) && n > 0 && n <= 120))];
  if (['count', 'time'].includes(input.sessionMode)) s.sessionMode = input.sessionMode;
  if ([10, 20, 30, 50].includes(input.count)) s.count = input.count;
  if (Number.isInteger(input.minutes) && input.minutes > 0 && input.minutes <= 120) s.minutes = input.minutes;
  if (['forward', 'reverse'].includes(input.direction)) s.direction = input.direction;
  if (safeId(input.selectedDeckId)) s.selectedDeckId = input.selectedDeckId;
  return s;
}
export function validateBackup(data) {
  if (!object(data) || data.schemaVersion !== SCHEMA_VERSION) fail('対応していないバックアップ形式です');
  const decks = list(data, 'decks'); list(data, 'questions'); list(data, 'stats'); list(data, 'sessions');
  if (!object(data.settings)) fail('settingsが不正です');
  for (const d of data.decks) if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 80 || (d.color && !/^#[0-9a-f]{6}$/i.test(d.color))) fail('ゲームの名前・色が不正です');
  for (const q of data.questions) {
    if (!decks.has(q.deckId) || typeof q.prompt !== 'string' || !q.prompt.trim() || q.prompt.length > 1000 || typeof q.answer !== 'string' || !q.answer.trim() || q.answer.length > 1000) fail('問題・答え・所属ゲームが不正です');
    for (const key of ['acceptedAnswers', 'tags']) if (q[key] != null && (!Array.isArray(q[key]) || q[key].some(v => typeof v !== 'string'))) fail(`${key}が不正です`);
    if (q.statVersion != null && (!Number.isInteger(q.statVersion) || q.statVersion < 1)) fail('問題の学習版が不正です');
  }
  for (const s of data.stats) {
    if (!safeId(s.questionId) || !safeId(s.deckId)) fail('統計の関連IDが不正です');
    for (const key of ['asked', 'correct', 'incorrect', 'PERFECT', 'GREAT', 'GOOD', 'MISS', 'totalTime', 'totalRatio', 'averageTime', 'averageRatio', 'streak', 'accuracy', 'mastery']) if (!Number.isFinite(s[key]) || s[key] < 0) fail('統計の数値が不正です');
    if (s.correct + s.incorrect !== s.asked || s.accuracy > 1 || s.mastery > 100) fail('統計の整合性が不正です');
  }
  for (const session of data.sessions) {
    if (!safeId(session.deckId) || typeof session.deckNameSnapshot !== 'string' || !Array.isArray(session.answers) || !Number.isFinite(Date.parse(session.startedAt))) fail('履歴が不正です');
    for (const a of session.answers) {
      if (!safeId(a.questionId) || !['PERFECT', 'GREAT', 'GOOD', 'MISS'].includes(a.grade) || typeof a.promptSnapshot !== 'string' || typeof a.answerSnapshot !== 'string' || !Number.isFinite(a.elapsed) || a.elapsed < 0 || !Number.isFinite(a.limit) || a.limit <= 0 || !Number.isFinite(Date.parse(a.at))) fail('履歴の回答が不正です');
    }
  }
  // 削除済み問題・ゲームの履歴および過去の統計版は保持可能。
  return { ...data, settings: sanitizeSettings(data.settings) };
}
export function fullBackup(state) {
  return { schemaVersion: SCHEMA_VERSION, exportedAt: nowISO(), settings: state.settings, decks: state.decks, questions: state.questions, stats: Object.values(state.stats), sessions: state.sessions };
}
export function exportBackup(state) { downloadJSON(fullBackup(state), `memory-beat-backup-${new Date().toISOString().slice(0, 10)}.json`); toast('バックアップを書き出したよ。音楽ファイルは含まれません'); }
export function exportAI(state) {
  dialog('AI編集用に書き出す', `<p class="notice">会社情報・個人名を外部AIに渡す可能性があります。共有してよい内容か確認してね。アプリから自動送信はしません。</p><p class="muted">問題・答え・別解・読み上げ・メモ・タグを含めます。成績・設定・学習履歴は含めません。</p><button class="primary wide" id="ai-download">確認してJSONを書き出す</button>`);
  bind('#ai-download', 'click', () => {
    const data = { format: 'memory-beat-ai-edit', schemaVersion: SCHEMA_VERSION, exportedAt: nowISO(), decks: state.decks.map(({ id, name, description }) => ({ id, name, description })), questions: state.questions.map(({ id, deckId, prompt, answer, acceptedAnswers, promptSpeech, answerSpeech, note, tags, enabled }) => ({ id, deckId, prompt, answer, acceptedAnswers, promptSpeech, answerSpeech, note, tags, enabled })) };
    downloadJSON(data, 'memory-beat-ai-edit.json'); closeDialog();
  });
}
export async function previewRestore(ctx, file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) fail('50MB以下のJSONを選んでください');
  let data; try { data = validateBackup(JSON.parse(await file.text())); } catch (e) { throw new Error(`復元を中止しました。現在のデータは変更していません。${e.message}`); }
  dialog('バックアップを復元', `<div class="metric-grid"><div><strong>${data.decks.length}</strong><small>ゲーム</small></div><div><strong>${data.questions.length}</strong><small>問題</small></div><div><strong>${data.sessions.length}</strong><small>履歴</small></div></div>
    <p class="muted">${esc(data.exportedAt || '')}<br>音楽ファイルは現在のものを維持します。通常音声認識の同意は復元後に再確認します。</p>
    <label>復元方法<select id="restore-mode"><option value="merge">追加・同じIDだけ上書き</option><option value="replace">バックアップの内容で置き換え</option></select></label>
    <p class="notice" id="restore-warning" hidden>現在のゲーム・問題・成績・履歴を置き換えます。先に現在のバックアップを保存してください。</p><button id="restore-confirm" class="primary wide">復元する</button>`);
  bind('#restore-mode', 'change', e => { $('#restore-warning').hidden = e.target.value !== 'replace'; });
  bind('#restore-confirm', 'click', async e => {
    const replace = $('#restore-mode').value === 'replace';
    if (replace && !confirm('現在の学習データを、このバックアップで置き換えます。実行しますか？')) return;
    e.currentTarget.disabled = true;
    const stores = ['decks', 'questions', 'stats', 'sessions', 'settings']; const operations = replace ? stores.map(store => ({ store, type: 'clear' })) : [];
    for (const store of stores.filter(s => s !== 'settings')) operations.push(...data[store].map(value => ({ store, value })));
    operations.push({ store: 'settings', value: { ...data.settings, recognitionMode: data.settings.recognitionMode === 'remote' ? 'local' : data.settings.recognitionMode, remoteConsent: false } });
    try { await write(operations); closeDialog(); ctx.selection.clear(); await ctx.reload(); ctx.render(); toast('復元したよ'); }
    catch (error) { e.currentTarget.disabled = false; throw error; }
  });
}
