import { aggregateDays, dayKey, summarize, statKey } from './core.js';
export function overview(state, deckId) {
  const days = aggregateDays(state.sessions, deckId); const todayKey = dayKey();
  const today = days.find(d => d.date === todayKey); const previous = [...days].reverse().find(d => d.date < todayKey);
  const questions = state.questions.filter(q => !deckId || q.deckId === deckId);
  const stats = questions.map(q => state.stats[statKey(q)]).filter(Boolean);
  const total = summarize(state.sessions.filter(s => !deckId || s.deckId === deckId).flatMap(s => s.answers || []));
  return { days, today, previous, total, mastery: questions.length ? Math.round(stats.reduce((n, s) => n + s.mastery, 0) / questions.length) : 0,
    questionCount: questions.filter(q => q.enabled !== false).length, disabledCount: questions.filter(q => q.enabled === false).length,
    change: today && previous ? (today.accuracy - previous.accuracy) * 100 : null,
    streak: stats.length ? Math.max(...stats.map(s => s.streak)) : 0 };
}
export function graphDays(days, period, now = new Date()) {
  if (!days.length) return [];
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start = period === 'all' ? new Date(`${days[0].date}T00:00:00`) : new Date(end.getFullYear(), end.getMonth(), end.getDate() - Number(period) + 1);
  const byDate = new Map(days.map(d => [d.date, d])); const result = [];
  while (start <= end) { const key = dayKey(start); result.push(byDate.get(key) || { date: key, accuracy: null, count: 0 }); start.setDate(start.getDate() + 1); }
  // 全期間の表示も軽くする。データ集計自体は全件を保持。
  return result;
}
