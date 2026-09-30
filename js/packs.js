import { all, write } from './db.js';
import { questionRecord } from './editor.js';
import { nowISO } from './utils.js';

// 公開可能な学習教材だけを追加する。個人名・会社情報は端末内へ登録する。
export const BUILTIN_PACKS = [{ id: 'toeic-v1', url: 'data/toeic.json' }];
export function packRecords(pack, sortOrder = 0) {
  if (!pack || !/^[\w-]+$/.test(pack.id) || typeof pack.name !== 'string' || !Array.isArray(pack.questions) || !pack.questions.length) throw new Error('教材の形式が不正です');
  const now = nowISO(), deckId = `pack-${pack.id}`, ids = new Set();
  const deck = { id: deckId, name: pack.name, description: pack.description || '', icon: pack.icon || '▣', color: pack.color || '#a695ff', sortOrder, createdAt: now, updatedAt: now, packId: pack.id };
  const questions = pack.questions.map((q, i) => {
    if (!q || typeof q.id !== 'string' || !/^[\w-]+$/.test(q.id) || ids.has(q.id) || typeof q.prompt !== 'string' || !q.prompt.trim() || typeof q.answer !== 'string' || !q.answer.trim()) throw new Error('教材の問題が不正です');
    ids.add(q.id); return questionRecord(deckId, { ...q, id: `${deckId}-${q.id}`, deckId }, i * 10);
  });
  return { deck, questions };
}
export async function ensureStarterPacks(state, io = { all, write, fetch: (...args) => fetch(...args) }) {
  const markers = new Set((await io.all('meta')).map(m => m.id));
  let installed = 0;
  for (const spec of BUILTIN_PACKS) {
    const marker = `installed-${spec.id}`; if (markers.has(marker)) continue;
    const response = await io.fetch(spec.url); if (!response.ok) throw new Error('TOEIC教材を読み込めませんでした。オンラインで再度開いてね');
    const pack = await response.json(); if (pack.id !== spec.id) throw new Error('教材IDが一致しません');
    const { deck, questions } = packRecords(pack, (state.decks.length + installed) * 10);
    // 既に同じ教材を復元済みなら上書きしない。削除後にも再追加しない。
    const exists = state.decks.some(d => d.id === deck.id);
    await io.write([...(exists ? [] : [{ store: 'decks', value: deck }, ...questions.map(value => ({ store: 'questions', value })), { store: 'settings', value: { ...state.settings, selectedDeckId: deck.id, answerMode: 'choices', recognitionMode: 'off' } }]), { store: 'meta', value: { id: marker, installedAt: nowISO() } }]);
    installed++;
  }
  return installed;
}
