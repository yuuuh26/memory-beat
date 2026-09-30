import { DIFFICULTIES, JUDGMENT, POINTS } from './config.js';
// DOM / IndexedDB / 音声APIに依存しない学習ロジック。
export function normalize(text, allowSan = false) {
  let s = String(text ?? '').normalize('NFKC').toLocaleLowerCase('ja').replace(/[\s\p{P}\p{S}]/gu, '');
  if (allowSan && s.length > 2 && s.endsWith('さん')) s = s.slice(0, -2);
  return s;
}
export function matches(text, question, allowSan = true) {
  const s = normalize(text, allowSan);
  return !!s && [question.answer, ...(question.acceptedAnswers || [])].some(a => normalize(a, allowSan) === s);
}
export function judge(correct, elapsed, limit = DIFFICULTIES.NORMAL) {
  if (!correct || !Number.isFinite(elapsed) || elapsed >= limit || elapsed < 0) return 'MISS';
  return elapsed <= limit * JUDGMENT.perfect ? 'PERFECT' : elapsed <= limit * JUDGMENT.great ? 'GREAT' : 'GOOD';
}
export function blankStat(question) {
  return { id: statKey(question), questionId: question.id, deckId: question.deckId, asked: 0,
    correct: 0, incorrect: 0, PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0,
    totalTime: 0, totalRatio: 0, averageTime: 0, averageRatio: 0, streak: 0,
    accuracy: 0, mastery: 0, lastAnswered: null, lastMiss: null };
}
export const statKey = q => `${q.id}:${q.statVersion || 1}`;
export function updateStat(old, answer, question) {
  const s = { ...blankStat(question), ...old, deckId: question.deckId };
  s.asked++; s[answer.grade]++; s.totalTime += answer.elapsed;
  s.totalRatio += Math.min(1, answer.elapsed / answer.limit);
  s.averageTime = s.totalTime / s.asked; s.averageRatio = s.totalRatio / s.asked;
  s.lastAnswered = answer.at;
  if (answer.grade === 'MISS') { s.incorrect++; s.streak = 0; s.lastMiss = answer.at; }
  else { s.correct++; s.streak++; }
  s.accuracy = s.correct / s.asked;
  s.mastery = Math.max(0, Math.min(100, Math.round(s.accuracy * 55 + Math.min(5, s.streak) * 5 + (1 - s.averageRatio) * 15 + Math.min(5, s.asked))));
  return s;
}
export function weight(stat, now = Date.now()) {
  if (!stat?.asked) return 9;
  const days = stat.lastAnswered ? Math.max(0, (now - Date.parse(stat.lastAnswered)) / 86400000) : 30;
  const recentMiss = stat.lastMiss && now - Date.parse(stat.lastMiss) < 3 * 86400000 ? 2 : 0;
  return Math.max(.4, .5 + (1 - stat.accuracy) * 5 + stat.averageRatio * 2 + recentMiss + Math.min(4, days / 7));
}
export function selectQuestions(questions, stats, count, rng = Math.random, now = Date.now(), previousId = null) {
  const pool = questions.filter(q => q.enabled !== false && typeof q.prompt === 'string' && q.prompt.trim() && typeof q.answer === 'string' && q.answer.trim());
  const result = [];
  while (pool.length && result.length < count) {
    const weights = pool.map(q => weight(stats[statKey(q)], now) * (!result.length && q.id === previousId && pool.length > 1 ? 0 : 1));
    let ticket = rng() * weights.reduce((a, b) => a + b, 0), i = 0;
    while (i < pool.length - 1 && (ticket -= weights[i]) >= 0) i++;
    result.push(pool.splice(i, 1)[0]);
  }
  return result;
}
export function summarize(answers) {
  const s = { score: 0, count: answers.length, accuracy: null, averageTime: null, bestCombo: 0, combo: 0, PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  let total = 0;
  for (const a of answers) {
    s[a.grade]++; s.score += POINTS[a.grade]; total += a.elapsed;
    s.combo = a.grade === 'MISS' ? 0 : s.combo + 1; s.bestCombo = Math.max(s.bestCombo, s.combo);
  }
  if (answers.length) { s.accuracy = (answers.length - s.MISS) / answers.length; s.averageTime = total / answers.length; }
  return s;
}
// ローカル日付。UTC変換で日本の深夜の記録を前日へずらさない。
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function aggregateDays(sessions, deckId = null) {
  const groups = new Map();
  for (const session of sessions) {
    if (deckId && session.deckId !== deckId) continue;
    for (const a of session.answers || []) {
      const date = new Date(a.at); if (!Number.isFinite(date.getTime())) continue;
      const key = dayKey(date); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(a);
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, answers]) => ({ date, ...summarize(answers) }));
}
export function parseTSV(text) {
  const rows = [], errors = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const [prompt, answer, aliases = '', note = ''] = line.split('\t');
    if (!prompt?.trim() || !answer?.trim()) { errors.push(`${i + 1}行目：問題と答えをタブで区切ってください`); return; }
    rows.push({ prompt: prompt.trim(), answer: answer.trim(), acceptedAnswers: aliases.split('|').map(s => s.trim()).filter(Boolean), note: note.trim() });
  });
  return { rows, errors };
}
