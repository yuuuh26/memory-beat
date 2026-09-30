import { escapeHTML as esc, percent } from './utils.js';
export function lineChart(days) {
  const points = days.filter(d => d.accuracy != null);
  if (!points.length) return '<div class="empty small">学習すると、正答率の推移がここに表示されるよ。</div>';
  const W = 520, H = 174, left = 40, top = 16, bottom = 143;
  const coords = days.map((d, i) => d.accuracy == null ? null : [left + i / Math.max(1, days.length - 1) * (W - left - 16), bottom - d.accuracy * (bottom - top), d]);
  const segments = []; let current = [];
  for (const c of coords) { if (c) current.push(c); else if (current.length) { segments.push(current); current = []; } }
  if (current.length) segments.push(current);
  const lines = segments.map(s => `<polyline points="${s.map(c => `${c[0]},${c[1]}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`).join('');
  const sampled = coords.filter(Boolean).filter((_, i, arr) => arr.length <= 80 || i % Math.ceil(arr.length / 80) === 0 || i === arr.length - 1);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(points.length)}学習日の正答率推移。最新${percent(points.at(-1).accuracy)}">
    ${[0, .5, 1].map(v => `<line x1="${left}" x2="504" y1="${bottom - v * (bottom - top)}" y2="${bottom - v * (bottom - top)}" class="grid-line"/><text x="4" y="${bottom - v * (bottom - top) + 4}">${v * 100}%</text>`).join('')}
    ${lines}${sampled.map(([x, y, d]) => `<circle cx="${x}" cy="${y}" r="4" fill="currentColor"><title>${esc(d.date)} ${percent(d.accuracy)} (${d.count}問)</title></circle>`).join('')}
    <text x="${left}" y="169">${esc(days[0].date.slice(5).replace('-', '/'))}</text><text x="504" y="169" text-anchor="end">${esc(days.at(-1).date.slice(5).replace('-', '/'))}</text></svg>`;
}
