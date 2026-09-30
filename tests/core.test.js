import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, matches, judge, blankStat, statKey, updateStat, weight, selectQuestions, summarize, dayKey, aggregateDays, parseTSV } from '../js/core.js';
import { validateBackup, sanitizeSettings } from '../js/backup.js';
import { DIFFICULTIES } from '../js/config.js';
const q = { id: 'q1', deckId: 'd1', prompt: '架空の問い', answer: '星', acceptedAnswers: ['ほし'], enabled: true, statVersion: 1 };
const answer = (grade, elapsed = 900, at = '2026-09-30T09:00:00+09:00') => ({ questionId: q.id, promptSnapshot: q.prompt, answerSnapshot: q.answer, grade, elapsed, limit: 4500, at });
test('正規化・別解・敬称、短い名前を曖昧に一致させない', () => {
  assert.equal(normalize(' ＡＢＣ、１２。'), 'abc12'); assert(matches('ほし。', q)); assert(matches('星', q));
  assert(matches('星さん', q, true)); assert(!matches('星さん', q, false)); assert(!matches('ほ', q)); assert(!matches('', q));
  assert(!matches('ミラー', { ...q, answer: 'ミラ', acceptedAnswers: ['みら'] }));
});
test('各難易度のPERFECT/GREAT/GOOD/MISS境界', () => {
  for (const limit of Object.values(DIFFICULTIES)) {
    assert.equal(judge(true, 0, limit), 'PERFECT'); assert.equal(judge(true, limit * .35, limit), 'PERFECT');
    assert.equal(judge(true, limit * .35 + 1, limit), 'GREAT'); assert.equal(judge(true, limit * .7, limit), 'GREAT');
    assert.equal(judge(true, limit * .7 + 1, limit), 'GOOD'); assert.equal(judge(true, limit - 1, limit), 'GOOD');
    assert.equal(judge(true, limit, limit), 'MISS'); assert.equal(judge(false, 0, limit), 'MISS'); assert.equal(judge(true, NaN, limit), 'MISS');
  }
});
test('問題統計と学習版を分離', () => {
  let s = updateStat(undefined, answer('PERFECT'), q); s = updateStat(s, answer('MISS', 4500), q);
  assert.equal(s.asked, 2); assert.equal(s.correct, 1); assert.equal(s.incorrect, 1); assert.equal(s.streak, 0); assert.equal(s.accuracy, .5); assert.equal(s.averageTime, 2700);
  assert.equal(updateStat(undefined, answer('MISS'), q).mastery, 0); assert.equal(s.PERFECT, 1); assert.equal(s.MISS, 1); assert(s.mastery >= 0 && s.mastery <= 100);
  assert.notEqual(statKey(q), statKey({ ...q, statVersion: 2 })); assert.equal(blankStat({ ...q, statVersion: 2 }).asked, 0);
});
test('コンボ・誤認識修正を含むセッション集計', () => {
  const s = summarize([answer('PERFECT'), answer('GREAT'), answer('MISS'), answer('GOOD'), answer('PERFECT'), answer('GREAT')]);
  assert.equal(s.score, 410); assert.equal(s.bestCombo, 3); assert.equal(s.combo, 3); assert.equal(s.accuracy, 5 / 6);
  assert.equal(summarize([]).accuracy, null);
});
test('未学習・低正答率・遅い回答・最近のミス・長期未出題に重み', () => {
  const now = Date.parse('2026-09-30T10:00:00Z');
  const good = { asked: 20, accuracy: 1, averageRatio: .1, lastAnswered: '2026-09-30T09:00:00Z' };
  assert(weight(null, now) > weight(good, now)); assert(weight({ ...good, accuracy: .2 }, now) > weight(good, now));
  assert(weight({ ...good, averageRatio: .9 }, now) > weight(good, now)); assert(weight({ ...good, lastMiss: '2026-09-30T08:00:00Z' }, now) > weight(good, now));
  assert(weight({ ...good, lastAnswered: '2026-08-01T00:00:00Z' }, now) > weight(good, now));
});
test('重複なし、無効除外、周期の最初に直前問題を避ける', () => {
  const qs = [q, { ...q, id: 'q2' }, { ...q, id: 'q3', enabled: false }];
  const selected = selectQuestions(qs, {}, 50, () => .4); assert.equal(selected.length, 2); assert.equal(new Set(selected.map(q => q.id)).size, 2);
  assert.equal(selectQuestions(qs, {}, 2, () => 0, Date.now(), 'q1')[0].id, 'q2');
});
test('日別集計はゲームを分離し、日本時間の深夜を保持', () => {
  const sessions = [{ deckId: 'd1', answers: [answer('PERFECT', 900, '2026-09-30T00:05:00+09:00')] }, { deckId: 'd2', answers: [answer('MISS', 4500, '2026-09-30T00:10:00+09:00')] }];
  assert.equal(aggregateDays(sessions, 'd1')[0].accuracy, 1); assert.equal(aggregateDays(sessions, 'd2')[0].accuracy, 0);
  assert.equal(aggregateDays(sessions)[0].accuracy, .5); assert.equal(dayKey(new Date('2026-09-30T00:05:00+09:00')), '2026-09-30');
});
test('TSV基本・拡張列と壊れた行のプレビュー検出', () => {
  const data = parseTSV('青\t星\tほし|スター\tメモ\n赤\t月\n\n'); assert.equal(data.rows.length, 2); assert.equal(data.errors.length, 0); assert.deepEqual(data.rows[0].acceptedAnswers, ['ほし', 'スター']);
  assert.deepEqual(parseTSV('青\t星\tほし｜スター').rows[0].acceptedAnswers, ['ほし', 'スター']); assert.equal(parseTSV('列が一つだけ').errors.length, 1); assert.equal(parseTSV('\t答え').rows.length, 0);
});
const backup = () => ({ schemaVersion: 1, settings: {}, decks: [{ id: 'd1', name: '架空', color: '#a695ff' }], questions: [q], stats: [], sessions: [{ id: 's1', deckId: 'd1', deckNameSnapshot: '架空', startedAt: '2026-09-30T00:00:00Z', answers: [answer('GOOD')] }] });
test('完全バックアップ検証：壊れたJSON・参照・ID・履歴を拒否', () => {
  assert.equal(validateBackup(backup()).questions.length, 1);
  for (const modify of [b => { b.schemaVersion = 2; }, b => { b.questions[0] = { ...q, deckId: 'missing' }; }, b => { b.questions.push(q); }, b => { b.questions[0] = { ...q, id: 'bad"id' }; }, b => { b.sessions[0].answers[0].elapsed = -1; }]) { const b = structuredClone(backup()); modify(b); assert.throws(() => validateBackup(b)); }
});
test('削除済み問題・ゲームの過去履歴を復元可能', () => {
  const b = backup(); b.questions = []; b.decks = []; assert.equal(validateBackup(b).sessions.length, 1);
});
test('設定復元の許可値と安全な既定値', () => {
  const s = sanitizeSettings({ bgmVolume: 3, recognitionMode: 'arbitrary', favoriteMinutes: [0, 2, 2, 120, 200], selectedDeckId: 'safe-uuid', difficulty: 'HARD' });
  assert.equal(s.bgmVolume, .22); assert.equal(s.recognitionMode, 'off'); assert.deepEqual(s.favoriteMinutes, [2, 120]); assert.equal(s.difficulty, 'HARD');
});
