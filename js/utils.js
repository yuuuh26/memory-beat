export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uuid = () => crypto.randomUUID();
export const nowISO = () => new Date().toISOString();
export const percent = n => n == null ? '—' : `${Math.round(n * 100)}%`;
export const seconds = n => n == null ? '—' : `${(n / 1000).toFixed(1)}秒`;
export const dateLabel = s => s ? new Date(s).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未学習';
export const sorted = rows => [...rows].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
export function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, error ? 6500 : 3000);
}
export function dialog(title, content) {
  const el = $('#dialog'); $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = content;
  if (!el.open) el.showModal(); return el;
}
export const closeDialog = () => $('#dialog').close();
export function downloadJSON(data, name) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const el = document.createElement('textarea'); el.value = text; el.style.position = 'fixed'; el.style.opacity = '0'; document.body.append(el); el.select();
  const copied = document.execCommand('copy'); el.remove(); if (!copied) throw new Error('コピーできませんでした');
}
export function handleError(error) { console.error(error); toast(`保存・処理できませんでした：${error.message || error}`, true); }
export function bind(selector, event, handler, root = document) {
  const el = $(selector, root); if (el) el.addEventListener(event, async e => { try { await handler(e); } catch (err) { handleError(err); } });
}
