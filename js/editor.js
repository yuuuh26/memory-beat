import { write } from './db.js';
import { statKey, normalize, parseTSV } from './core.js';
import { $, $$, escapeHTML as esc, uuid, nowISO, sorted, dialog, closeDialog, toast, bind, percent, dateLabel } from './utils.js';
const colors = ['#a695ff', '#66e3d3', '#ffa67d', '#83b7ff', '#ed96dc', '#f3d577'];
export function questionRecord(deckId, data, order) {
  const now = nowISO(); return { id: uuid(), deckId, acceptedAnswers: [], promptSpeech: '', answerSpeech: '', note: '', tags: [], enabled: true, statVersion: 1, sortOrder: order, createdAt: now, updatedAt: now, ...data };
}
function options(state, selected) { return sorted(state.decks).map(d => `<option value="${esc(d.id)}" ${d.id === selected ? 'selected' : ''}>${esc(d.name)}</option>`).join(''); }
export function openDeckEditor(ctx, existing = null) {
  dialog(existing ? 'ゲームを編集' : 'ゲームを作成', `<form id="deck-form"><label>ゲーム名<input name="name" required maxlength="80" value="${esc(existing?.name)}" placeholder="例：覚えたい用語"></label>
    <details><summary>詳細設定</summary><label>説明<textarea name="description" maxlength="2000">${esc(existing?.description)}</textarea></label><div class="grid2"><label>アイコン<input name="icon" maxlength="6" value="${esc(existing?.icon || '▣')}"></label><label>テーマ色<select name="color">${colors.map(c => `<option value="${c}" ${c === existing?.color ? 'selected' : ''}>${c === '#a695ff' ? 'パープル' : c === '#66e3d3' ? 'ミント' : c === '#ffa67d' ? 'オレンジ' : c === '#83b7ff' ? 'ブルー' : c === '#ed96dc' ? 'ピンク' : 'イエロー'}</option>`).join('')}</select></label></div></details>
    <button class="primary wide" type="submit">${existing ? '変更を保存' : 'ゲームを作成'}</button></form>
    ${existing ? '<button class="danger wide" id="delete-deck">このゲームを削除</button>' : ''}`);
  bind('#deck-form', 'submit', async e => {
    e.preventDefault(); const form = new FormData(e.currentTarget); const now = nowISO();
    const deck = { id: uuid(), sortOrder: ctx.state.decks.length * 10, createdAt: now, ...existing, name: form.get('name').trim(), description: form.get('description').trim(), icon: form.get('icon').trim() || '▣', color: form.get('color'), updatedAt: now };
    if (!deck.name) return;
    await write([{ store: 'decks', value: deck }, { store: 'settings', value: { ...ctx.state.settings, selectedDeckId: deck.id } }]);
    closeDialog(); await ctx.reload(); ctx.render(); toast('ゲームを保存したよ');
  });
  bind('#delete-deck', 'click', () => {
    const count = ctx.state.questions.filter(q => q.deckId === existing.id).length;
    dialog('ゲームを削除する？', `<p>「${esc(existing.name)}」と問題${count}件を削除します。過去の学習履歴は残ります。</p><button id="confirm-delete-deck" class="danger wide">ゲームと問題を削除</button>`);
    bind('#confirm-delete-deck', 'click', async () => {
      await write([{ store: 'decks', type: 'delete', id: existing.id }, ...ctx.state.questions.filter(q => q.deckId === existing.id).map(q => ({ store: 'questions', type: 'delete', id: q.id }))]);
      closeDialog(); await ctx.reload(); ctx.render(); toast('ゲームを削除しました');
    });
  });
}
export function openQuestionEditor(ctx, existing = null) {
  const deckId = existing?.deckId || ctx.state.settings.selectedDeckId;
  dialog(existing ? '問題を編集' : '問題を追加', `<form id="question-form">
    <label>問題<input name="prompt" required maxlength="1000" value="${esc(existing?.prompt)}" placeholder="何を聞く？"></label>
    <label>答え<input name="answer" required maxlength="1000" value="${esc(existing?.answer)}" placeholder="覚えたい答え"></label>
    <details ${existing ? 'open' : ''}><summary>詳細設定</summary>
      <label>別解 <small>｜または改行で区切る</small><textarea name="acceptedAnswers" placeholder="漢字やひらがなの別表記">${esc((existing?.acceptedAnswers || []).join('\n'))}</textarea></label>
      <label>選択肢 <small>1行に1つ。空欄なら同じゲームの答えから作成。正解は自動で追加。</small><textarea name="choices" placeholder="選択肢を個別に指定したい場合だけ入力">${esc((existing?.choices || []).join('\n'))}</textarea></label>
      <div class="grid2"><label>問題の読み上げ<input name="promptSpeech" value="${esc(existing?.promptSpeech)}" placeholder="空欄なら問題と同じ"></label><label>答えの読み上げ<input name="answerSpeech" value="${esc(existing?.answerSpeech)}" placeholder="空欄なら答えと同じ"></label></div>
      <label>メモ<textarea name="note" maxlength="10000">${esc(existing?.note)}</textarea></label>
      <label>タグ <small>カンマで区切る</small><input name="tags" value="${esc((existing?.tags || []).join(', '))}"></label>
      <label>ゲーム<select name="deckId">${options(ctx.state, deckId)}</select></label><label class="toggle">出題する<input name="enabled" type="checkbox" ${existing?.enabled !== false ? 'checked' : ''}></label>
    </details><button class="primary wide" type="submit">${existing ? '変更を保存' : '問題を追加'}</button></form>
    ${existing ? '<button id="delete-question" class="danger wide">この問題を削除</button>' : ''}`);
  bind('#question-form', 'submit', async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const values = { prompt: f.get('prompt').trim(), answer: f.get('answer').trim(), acceptedAnswers: f.get('acceptedAnswers').split(/[|｜\n]/).map(s => s.trim()).filter(Boolean), promptSpeech: f.get('promptSpeech').trim(), answerSpeech: f.get('answerSpeech').trim(), note: f.get('note').trim(), tags: f.get('tags').split(/[,、]/).map(s => s.trim()).filter(Boolean), deckId: f.get('deckId'), enabled: f.has('enabled'), updatedAt: nowISO() };
    if (!values.prompt || !values.answer) return;
    values.choices = f.get('choices').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const q = existing ? { ...existing, ...values } : questionRecord(values.deckId, values, ctx.state.questions.length * 10);
    const save = async reset => {
      if (reset) q.statVersion = (existing.statVersion || 1) + 1;
      const operations = [{ store: 'questions', value: q }];
      const s = ctx.state.stats[statKey(q)]; if (s) operations.push({ store: 'stats', value: { ...s, deckId: q.deckId } });
      await write(operations); closeDialog(); await ctx.reload(); ctx.render(); toast('問題を保存したよ');
    };
    if (existing && normalize(existing.answer) !== normalize(q.answer)) {
      dialog('答えが変更されています', `<p>新しい答えの習熟度を、どのように扱いますか？過去のセッション履歴は両方とも残ります。</p><button id="reset-mastery" class="primary wide">新しい問題として学習する</button><button id="keep-mastery" class="secondary wide">過去の学習成績を引き継ぐ</button>`);
      bind('#reset-mastery', 'click', () => save(true)); bind('#keep-mastery', 'click', () => save(false));
    } else await save(false);
  });
  bind('#delete-question', 'click', () => confirmDelete(ctx, [existing.id]));
}
function confirmDelete(ctx, ids) {
  dialog('問題を削除する？', `<p>${ids.length}件の問題を削除します。過去の学習履歴は残ります。</p><button class="danger wide" id="confirm-question-delete">${ids.length}件を削除</button>`);
  bind('#confirm-question-delete', 'click', async () => {
    await write(ids.map(id => ({ store: 'questions', type: 'delete', id }))); closeDialog(); ctx.selection.clear(); await ctx.reload(); ctx.render(); toast('問題を削除しました');
  });
}
export function bulkAdd(ctx) {
  dialog('問題を一括追加', `<p class="muted">問題・答えをタブで区切って貼り付けてね。3列目は別解（｜区切り）、4列目はメモです。</p><label>貼り付け<textarea id="bulk-text" rows="8" placeholder="青チームの合言葉&#9;スター&#10;赤チームの合言葉&#9;ムーン"></textarea></label><button class="primary wide" id="bulk-preview">プレビュー</button>`);
  bind('#bulk-preview', 'click', () => {
    const parsed = parseTSV($('#bulk-text').value);
    if (parsed.errors.length) { dialog('形式を確認してね', `<p>${parsed.errors.map(esc).join('<br>')}</p><button class="secondary wide" id="bulk-back">貼り付けに戻る</button>`); bind('#bulk-back', 'click', () => bulkAdd(ctx)); return; }
    if (!parsed.rows.length) { toast('問題と答えを貼り付けてね', true); return; }
    const deckId = ctx.state.settings.selectedDeckId;
    dialog(`${parsed.rows.length}件追加します`, `<div class="preview-list">${parsed.rows.map(r => `<div class="preview-row"><strong>${esc(r.prompt)}</strong><span>${esc(r.answer)}</span>${r.acceptedAnswers.length ? `<small>${esc(r.acceptedAnswers.join(' / '))}</small>` : ''}</div>`).join('')}</div><button class="primary wide" id="bulk-save">${parsed.rows.length}件を登録</button>`);
    bind('#bulk-save', 'click', async e => {
      e.currentTarget.disabled = true;
      try { await write(parsed.rows.map((row, i) => ({ store: 'questions', value: questionRecord(deckId, row, (ctx.state.questions.length + i) * 10) }))); closeDialog(); await ctx.reload(); ctx.render(); toast(`${parsed.rows.length}件を追加したよ`); }
      catch (error) { e.currentTarget.disabled = false; throw error; }
    });
  });
}
export function renderEditor(ctx) {
  const { state } = ctx, deckId = state.settings.selectedDeckId;
  let questions = state.questions.filter(q => q.deckId === deckId);
  const query = (ctx.search || '').toLocaleLowerCase(); if (query) questions = questions.filter(q => [q.prompt, q.answer, q.note, ...(q.tags || [])].some(s => String(s).toLocaleLowerCase().includes(query)));
  questions = ctx.order === 'name' ? questions.sort((a, b) => a.prompt.localeCompare(b.prompt, 'ja')) : ctx.order === 'weak' ? questions.sort((a, b) => (state.stats[statKey(a)]?.mastery || 0) - (state.stats[statKey(b)]?.mastery || 0)) : sorted(questions);
  return `<div class="section-head"><div><span class="eyebrow">QUESTIONS</span><h1>問題管理</h1></div><button id="edit-deck" class="icon-button" aria-label="ゲームを編集">⚙</button></div>
    <div class="row"><button class="primary grow" id="add-question">＋ 問題を追加</button><button class="secondary" id="bulk-add">一括追加</button></div>
    <div class="search-row"><input type="search" id="question-search" aria-label="問題を検索" placeholder="問題・答え・タグを検索" value="${esc(ctx.search)}"><select id="question-sort" aria-label="問題の並び順"><option value="order">登録順</option><option value="name" ${ctx.order === 'name' ? 'selected' : ''}>名前順</option><option value="weak" ${ctx.order === 'weak' ? 'selected' : ''}>苦手順</option></select></div>
    <div class="row between selection-head"><label class="check"><input type="checkbox" id="select-all" ${questions.length && questions.every(q => ctx.selection.has(q.id)) ? 'checked' : ''}>全選択</label><span class="muted">${questions.length}件 / 選択${ctx.selection.size}件</span></div>
    ${ctx.selection.size ? '<div class="bulk-actions"><button data-bulk="move">移動</button><button data-bulk="copy">コピー</button><button data-bulk="disable">無効化</button><button data-bulk="delete" class="danger">削除</button></div>' : ''}
    <div class="question-list">${questions.length ? questions.map(q => { const s = state.stats[statKey(q)]; return `<div class="question-row ${q.enabled === false ? 'disabled' : ''}"><input type="checkbox" data-select="${esc(q.id)}" aria-label="${esc(q.prompt)}を選択" ${ctx.selection.has(q.id) ? 'checked' : ''}><button data-edit="${esc(q.id)}" class="question-body"><strong>${esc(q.prompt)}</strong><span>${esc(q.answer)}</span><small>習熟 ${s?.mastery || 0} · 正答 ${percent(s?.asked ? s.accuracy : null)} · ${dateLabel(s?.lastAnswered)}${q.enabled === false ? ' · 無効' : ''}</small></button><div class="reorder"><button data-up="${esc(q.id)}" aria-label="上へ">↑</button><button data-down="${esc(q.id)}" aria-label="下へ">↓</button></div></div>`; }).join('') : '<div class="empty">最初の問題を追加しよう。<br>一括追加なら、まとめて登録できるよ。</div>'}</div>`;
}
export function bindEditor(ctx) {
  bind('#add-question', 'click', () => openQuestionEditor(ctx)); bind('#edit-deck', 'click', () => openDeckEditor(ctx, ctx.state.decks.find(d => d.id === ctx.state.settings.selectedDeckId)));
  bind('#bulk-add', 'click', () => bulkAdd(ctx));
  bind('#question-search', 'input', e => { const position = e.target.selectionStart; ctx.search = e.target.value; ctx.render(); $('#question-search').focus(); $('#question-search').setSelectionRange(position, position); });
  bind('#question-sort', 'change', e => { ctx.order = e.target.value; ctx.render(); });
  $$('[data-edit]').forEach(el => bind(`[data-edit="${el.dataset.edit}"]`, 'click', () => openQuestionEditor(ctx, ctx.state.questions.find(q => q.id === el.dataset.edit))));
  $$('[data-select]').forEach(el => el.addEventListener('change', () => { el.checked ? ctx.selection.add(el.dataset.select) : ctx.selection.delete(el.dataset.select); ctx.render(); }));
  bind('#select-all', 'change', e => { $$('[data-select]').forEach(el => e.target.checked ? ctx.selection.add(el.dataset.select) : ctx.selection.delete(el.dataset.select)); ctx.render(); });
  $$('[data-up], [data-down]').forEach(el => el.addEventListener('click', async () => {
    try {
      const list = sorted(ctx.state.questions.filter(q => q.deckId === ctx.state.settings.selectedDeckId)); const index = list.findIndex(q => q.id === (el.dataset.up || el.dataset.down)); const target = index + (el.dataset.up ? -1 : 1); if (!list[target]) return;
      [list[index], list[target]] = [list[target], list[index]];
      await write(list.map((q, i) => ({ store: 'questions', value: { ...q, sortOrder: i * 10 } }))); await ctx.reload(); ctx.render();
    } catch (error) { toast(error.message, true); }
  }));
  $$('[data-bulk]').forEach(el => bind(`[data-bulk="${el.dataset.bulk}"]`, 'click', async () => {
    const qs = sorted(ctx.state.questions.filter(q => ctx.selection.has(q.id))); const action = el.dataset.bulk;
    if (action === 'delete') return confirmDelete(ctx, qs.map(q => q.id));
    if (action === 'disable') { await write(qs.map(q => ({ store: 'questions', value: { ...q, enabled: false, updatedAt: nowISO() } }))); ctx.selection.clear(); await ctx.reload(); ctx.render(); return; }
    dialog(action === 'move' ? '別ゲームへ移動' : '問題をコピー', `<p>${qs.length}件の問題</p><label>登録先<select id="target-deck">${options(ctx.state, ctx.state.settings.selectedDeckId)}</select></label><button id="bulk-apply" class="primary wide">${action === 'move' ? '移動する' : 'コピーする'}</button>`);
    bind('#bulk-apply', 'click', async () => {
      const deckId = $('#target-deck').value, operations = [];
      qs.forEach((q, i) => {
        const record = action === 'copy' ? questionRecord(deckId, { ...q, id: uuid(), deckId, statVersion: 1, createdAt: nowISO(), updatedAt: nowISO(), sortOrder: (ctx.state.questions.length + i) * 10 }, 0) : { ...q, deckId, updatedAt: nowISO() };
        operations.push({ store: 'questions', value: record });
        if (action === 'move' && ctx.state.stats[statKey(q)]) operations.push({ store: 'stats', value: { ...ctx.state.stats[statKey(q)], deckId } });
      });
      await write(operations); closeDialog(); ctx.selection.clear(); await ctx.reload(); ctx.render(); toast(action === 'copy' ? 'コピーしたよ' : '移動したよ');
    });
  }));
}
export async function reorderDeck(ctx, id, direction) {
  const list = sorted(ctx.state.decks), index = list.findIndex(d => d.id === id), target = index + direction;
  if (!list[target]) return; [list[index], list[target]] = [list[target], list[index]];
  await write(list.map((d, i) => ({ store: 'decks', value: { ...d, sortOrder: i * 10 } }))); await ctx.reload(); ctx.render();
}
