import { VERSION, DEFAULT_SETTINGS, DIFFICULTIES, QUESTION_COUNTS, TIME_OPTIONS, TRACKS } from './config.js';
import { loadData, put, write, all, storageState, requestPersistence, clearUserData } from './db.js';
import { statKey, summarize } from './core.js';
import { overview, graphDays } from './stats.js';
import { lineChart } from './charts.js';
import { openDeckEditor, openQuestionEditor, bulkAdd, renderEditor, bindEditor, reorderDeck, questionRecord } from './editor.js';
import { sanitizeSettings, exportBackup, exportAI, previewRestore } from './backup.js';
import { recognitionState, installLocalRecognition } from './speech.js';
import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { $, $$, escapeHTML as esc, sorted, uuid, nowISO, toast, bind, dialog, closeDialog, percent, seconds, dateLabel, copyText, handleError } from './utils.js';
const state = { settings: { ...DEFAULT_SETTINGS }, decks: [], questions: [], stats: {}, sessions: [] };
let page = 'home', period = '7', scopeAll = false, game = null, installPrompt = null, swRegistration = null, previewAudio = null;
const ctx = { state, selection: new Set(), search: '', order: 'order', reload, render, showResult };
async function reload() {
  const data = await loadData(); let skipped = 0;
  const filter = (rows, test) => rows.filter(r => { const valid = r && test(r); if (!valid) skipped++; return valid; });
  state.settings = sanitizeSettings(data.settings.find(s => s.id === 'main'));
  state.decks = filter(data.decks, d => typeof d.id === 'string' && /^[\w:-]+$/.test(d.id) && typeof d.name === 'string' && d.name.trim());
  const deckIds = new Set(state.decks.map(d => d.id));
  state.questions = filter(data.questions, q => typeof q.id === 'string' && /^[\w:-]+$/.test(q.id) && deckIds.has(q.deckId) && typeof q.prompt === 'string' && typeof q.answer === 'string' && q.prompt.trim() && q.answer.trim()).map(q => ({ ...q, acceptedAnswers: Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers.filter(a => typeof a === 'string') : [], tags: Array.isArray(q.tags) ? q.tags.filter(a => typeof a === 'string') : [] }));
  state.stats = Object.fromEntries(filter(data.stats, s => typeof s.id === 'string' && ['asked', 'accuracy', 'mastery', 'averageTime', 'averageRatio', 'streak'].every(k => Number.isFinite(s[k]))).map(s => [s.id, s]));
  state.sessions = filter(data.sessions, s => typeof s.id === 'string' && Array.isArray(s.answers) && Number.isFinite(Date.parse(s.startedAt))).map(s => ({ ...s, deckNameSnapshot: String(s.deckNameSnapshot || '削除済みゲーム'), answers: s.answers.filter(a => a && ['PERFECT', 'GREAT', 'GOOD', 'MISS'].includes(a.grade) && Number.isFinite(a.elapsed) && Number.isFinite(Date.parse(a.at))).map(a => ({ ...a, promptSnapshot: String(a.promptSnapshot || ''), answerSnapshot: String(a.answerSnapshot || '') })) }));
  if (!deckIds.has(state.settings.selectedDeckId)) state.settings.selectedDeckId = sorted(state.decks)[0]?.id || null;
  if (skipped) toast(`読み込めないデータ${skipped}件を除外して起動しました。元データは削除していません`, true);
}
async function setting(values) { const next = { ...state.settings, ...values }; await put('settings', next); state.settings = next; }
const deck = () => state.decks.find(d => d.id === state.settings.selectedDeckId);
function tabs() {
  $('#deck-tabs').innerHTML = sorted(state.decks).map(d => `<button role="tab" aria-selected="${d.id === state.settings.selectedDeckId}" data-deck="${esc(d.id)}" class="deck-tab ${d.id === state.settings.selectedDeckId ? 'selected' : ''}"><span>${esc(d.icon || '▣')}</span>${esc(d.name)}</button>`).join('') + '<button id="new-deck" class="deck-add" aria-label="ゲームを作成">＋</button>';
  $$('[data-deck]').forEach(el => bind(`[data-deck="${el.dataset.deck}"]`, 'click', async () => { await setting({ selectedDeckId: el.dataset.deck }); ctx.selection.clear(); ctx.search = ''; render(); }));
  bind('#new-deck', 'click', () => openDeckEditor(ctx));
}
function render() {
  if (game && !game.ended && document.body.classList.contains('playing')) return;
  previewAudio?.stop(); tabs(); const d = deck();
  document.documentElement.style.setProperty('--deck-color', /^#[0-9a-f]{6}$/i.test(d?.color || '') ? d.color : '#a695ff');
  $$('[data-page]').forEach(el => { el.classList.toggle('active', el.dataset.page === page); el.setAttribute('aria-current', el.dataset.page === page ? 'page' : 'false'); });
  if (!d && ['home', 'editor'].includes(page)) {
    $('#main').innerHTML = `<section class="empty-state"><div class="empty-mark">▣</div><span class="eyebrow">YOUR FIRST GAME</span><h1>最初のゲームを作ろう</h1><p class="muted">問題と答えを登録したら、すぐに反復できるよ。</p><button id="empty-create" class="primary wide">＋ ゲームを作成</button><button id="sample-create" class="text-button wide">架空のサンプルで試す</button></section>`;
    bind('#empty-create', 'click', () => openDeckEditor(ctx)); bind('#sample-create', 'click', createSample); return;
  }
  if (page === 'home') { $('#main').innerHTML = home(d); bindHome(); }
  else if (page === 'editor') { $('#main').innerHTML = renderEditor(ctx); bindEditor(ctx); }
  else if (page === 'stats') { $('#main').innerHTML = statsPage(); bindStats(); }
  else if (page === 'history') { $('#main').innerHTML = historyPage(); bindHistory(); }
  else if (page === 'settings') { $('#main').innerHTML = settingsPage(); bindSettings(); }
}
function trendHead(o) {
  return `<div class="today-grid"><div><span class="eyebrow">TODAY</span><strong>${percent(o.today?.accuracy)}</strong><small>${o.today?.count || 0}問回答</small></div><div><small>前回学習日</small><strong>${percent(o.previous?.accuracy)}</strong><small>${o.previous?.date.slice(5).replace('-', '/') || 'まだなし'}</small></div><div><small>前回比</small><strong class="${o.change != null && o.change >= 0 ? 'positive' : ''}">${o.change == null ? '—' : `${o.change >= 0 ? '+' : ''}${o.change.toFixed(1)}`}<em>${o.change == null ? '' : 'pt'}</em></strong><small>正答率の差</small></div></div>`;
}
function home(d) {
  const o = overview(state, d.id), s = state.settings, totalQuestions = state.questions.filter(q => q.deckId === d.id).length;
  return `<section><div class="section-head"><div><span class="eyebrow">READY TO RECALL</span><h1>${esc(d.name)}</h1></div><button id="home-edit-deck" class="icon-button" aria-label="ゲームを編集">⚙</button></div>
    ${d.description ? `<p class="muted deck-description">${esc(d.description)}</p>` : ''}
    <div class="card progress-card">${trendHead(o)}<div class="mastery-row"><span>習熟度 <b>${o.mastery}</b><small> / 100</small></span><span>${o.questionCount}問${o.disabledCount ? ` / 無効${o.disabledCount}` : ''}</span></div><div class="mastery-track"><i style="width:${o.mastery}%"></i></div></div>
    ${!o.questionCount ? `<div class="card empty"><h2>${totalQuestions ? '出題できる問題がありません' : '最初の問題を追加しよう'}</h2><p class="muted">${totalQuestions ? '問題管理から「出題する」を有効にしてね。' : '問題と答えだけで登録できるよ。'}</p><button id="home-add" class="primary wide">＋ 問題を追加</button><button id="home-bulk" class="secondary wide">まとめて追加</button></div>` : `<div class="card play-card"><div class="row between"><span class="eyebrow">PLAY SETUP</span><span class="pill">${o.questionCount} CARDS</span></div><div class="segmented"><button data-mode="count" class="${s.sessionMode === 'count' ? 'selected' : ''}">問題数</button><button data-mode="time" class="${s.sessionMode === 'time' ? 'selected' : ''}">時間</button></div>
      <div class="chips">${(s.sessionMode === 'count' ? QUESTION_COUNTS : [...new Set([...TIME_OPTIONS, ...s.favoriteMinutes])].sort((a, b) => a - b)).map(n => `<button data-target="${n}" class="${n === (s.sessionMode === 'count' ? s.count : s.minutes) ? 'selected' : ''}">${n}${s.sessionMode === 'count' ? '問' : '分'}</button>`).join('')}${s.sessionMode === 'time' ? '<button id="favorite-time" aria-label="お気に入り時間を追加">＋</button>' : ''}</div>
      <div class="grid2 setup-fields"><label>難易度<select id="home-difficulty">${Object.entries(DIFFICULTIES).map(([key, ms]) => `<option value="${key}" ${s.difficulty === key ? 'selected' : ''}>${key} · ${ms / 1000}秒</option>`).join('')}</select></label><label>出題方向<select id="direction"><option value="forward" ${s.direction === 'forward' ? 'selected' : ''}>問題 → 答え</option><option value="reverse" ${s.direction === 'reverse' ? 'selected' : ''}>答え → 問題</option></select></label></div>
      <div class="track-select"><span class="track-symbol">♫</span><label>BGM<select id="home-track">${trackOptions()}</select></label><button id="home-bgm-preview" class="icon-button" aria-label="BGM試聴">▷</button></div>
      <button class="start-button" id="start-game">START <span>▸</span></button><div class="play-meta"><span>${s.sessionMode === 'count' ? `${Math.min(s.count, o.questionCount)}問 · 重複なし` : `${s.minutes}分 · 苦手を優先`}</span><span id="home-recognition">音声設定を確認中…</span></div></div>`}
    <div class="card mini-trend"><div class="row between"><h3>最近の正答率</h3><button id="home-stats" class="text-button">STATS</button></div>${lineChart(graphDays(o.days, 7))}<div class="row between muted"><span>連続正解 ${o.streak}</span><span>平均 ${seconds(o.today?.averageTime ?? o.total.averageTime)}</span></div></div></section>`;
}
function trackOptions() { return TRACKS.map(t => `<option value="${t.id}" ${state.settings.bgmTrack === t.id ? 'selected' : ''}>${t.name} · ${t.bpm} BPM</option>`).join('') + `<option value="custom" ${state.settings.bgmTrack === 'custom' ? 'selected' : ''}>自分の音楽</option>`; }
function bindHome() {
  bind('#home-edit-deck', 'click', () => openDeckEditor(ctx, deck())); bind('#home-add', 'click', () => openQuestionEditor(ctx)); bind('#home-bulk', 'click', () => bulkAdd(ctx));
  $$('[data-mode]').forEach(el => bind(`[data-mode="${el.dataset.mode}"]`, 'click', async () => { await setting({ sessionMode: el.dataset.mode }); render(); }));
  $$('[data-target]').forEach(el => bind(`[data-target="${el.dataset.target}"]`, 'click', async () => { await setting({ [state.settings.sessionMode === 'count' ? 'count' : 'minutes']: Number(el.dataset.target) }); render(); }));
  bind('#home-difficulty', 'change', e => setting({ difficulty: e.target.value })); bind('#direction', 'change', e => setting({ direction: e.target.value }));
  bind('#home-track', 'change', async e => { previewAudio?.stop(); await setting({ bgmTrack: e.target.value }); });
  bind('#home-bgm-preview', 'click', async e => { if (previewAudio?.timer || previewAudio?.custom) { previewAudio.stop(); e.currentTarget.textContent = '▷'; return; } previewAudio = new AudioEngine(state.settings); await previewAudio.start(); e.currentTarget.textContent = '■'; });
  bind('#home-stats', 'click', () => navigate('stats'));
  bind('#favorite-time', 'click', () => {
    dialog('お気に入り時間', `<form id="favorite-form"><label>時間（1〜120分）<input name="minutes" type="number" min="1" max="120" required value="4"></label><button class="primary wide">追加する</button></form>${state.settings.favoriteMinutes.length ? `<div class="chips wrap">${state.settings.favoriteMinutes.map(n => `<button data-remove-time="${n}">${n}分 ×</button>`).join('')}</div>` : ''}`);
    bind('#favorite-form', 'submit', async e => { e.preventDefault(); const n = Number(new FormData(e.currentTarget).get('minutes')); await setting({ favoriteMinutes: [...new Set([...state.settings.favoriteMinutes, n])], minutes: n }); closeDialog(); render(); });
    $$('[data-remove-time]').forEach(el => bind(`[data-remove-time="${el.dataset.removeTime}"]`, 'click', async () => { await setting({ favoriteMinutes: state.settings.favoriteMinutes.filter(n => n !== Number(el.dataset.removeTime)), minutes: 2 }); closeDialog(); render(); }));
  });
  bind('#start-game', 'click', async e => {
    e.currentTarget.disabled = true; previewAudio?.stop();
    const questions = state.questions.filter(q => q.deckId === deck().id && q.enabled !== false);
    const newGame = new Game(ctx, deck(), questions);
    try { await requestPersistence(); game = newGame; await game.start(); } catch (error) { newGame.ended = true; newGame.speech.stop(); newGame.audio.stop(); document.body.classList.remove('playing'); game = null; render(); throw error; }
  });
  recognitionState(state.settings.recognitionMode === 'remote' && !state.settings.remoteConsent ? 'off' : state.settings.recognitionMode).then(s => { if (page === 'home' && $('#home-recognition')) $('#home-recognition').textContent = s.mode === 'manual' ? '手動判定' : s.mode === 'local' ? '端末内音声' : '通常音声'; });
}
function statsPage() {
  const selected = scopeAll ? null : state.settings.selectedDeckId, o = overview(state, selected);
  const weak = state.questions.filter(q => !selected || q.deckId === selected).sort((a, b) => (state.stats[statKey(a)]?.mastery || 0) - (state.stats[statKey(b)]?.mastery || 0)).slice(0, 8);
  return `<div class="section-head"><div><span class="eyebrow">YOUR PROGRESS</span><h1>成績</h1></div></div><div class="segmented"><button id="stats-deck" class="${!scopeAll ? 'selected' : ''}">このゲーム</button><button id="stats-all" class="${scopeAll ? 'selected' : ''}">全ゲーム</button></div>
    <div class="card">${trendHead(o)}<div class="metric-grid"><div><strong>${o.mastery}</strong><small>習熟度 / 100</small></div><div><strong>${o.total.count}</strong><small>総回答数</small></div><div><strong>${seconds(o.total.averageTime)}</strong><small>平均回答時間</small></div></div></div>
    <div class="card"><div class="row between"><h3>正答率の推移</h3><span class="muted">${scopeAll ? '全ゲーム' : esc(deck()?.name || '')}</span></div><div class="chips">${['7', '14', '30', 'all'].map(p => `<button data-period="${p}" class="${p === period ? 'selected' : ''}">${p === 'all' ? '全期間' : `${p}日`}</button>`).join('')}</div>${lineChart(graphDays(o.days, period))}<p class="muted chart-note">学習していない日は欠測として表示します。</p></div>
    <div class="card"><h3>苦手・未学習の問題</h3>${weak.length ? weak.map(q => `<button class="weak-row" data-weak="${esc(q.id)}"><span><strong>${esc(q.prompt)}</strong><small>${esc(q.answer)}</small></span><b>${state.stats[statKey(q)]?.mastery || 0}</b></button>`).join('') : '<p class="muted">問題を追加するとここに表示されます。</p>'}</div>
    <div class="card"><h3>最近間違えた問題</h3>${state.sessions.filter(s => !selected || s.deckId === selected).flatMap(s => s.answers).filter(a => a.grade === 'MISS').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5).map(a => `<div class="recent-row"><strong>${esc(a.promptSnapshot)}</strong><span>${esc(a.answerSnapshot)}</span><small>${dateLabel(a.at)}</small></div>`).join('') || '<p class="muted">まだ間違えた問題はありません。</p>'}</div>`;
}
function bindStats() {
  bind('#stats-deck', 'click', () => { scopeAll = false; render(); }); bind('#stats-all', 'click', () => { scopeAll = true; render(); });
  $$('[data-period]').forEach(el => bind(`[data-period="${el.dataset.period}"]`, 'click', () => { period = el.dataset.period; render(); }));
  $$('[data-weak]').forEach(el => bind(`[data-weak="${el.dataset.weak}"]`, 'click', () => openQuestionEditor(ctx, state.questions.find(q => q.id === el.dataset.weak))));
}
function historyPage() {
  const list = [...state.sessions].filter(s => scopeAll || s.deckId === state.settings.selectedDeckId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return `<div class="section-head"><div><span class="eyebrow">PLAY HISTORY</span><h1>学習履歴</h1></div></div><div class="segmented"><button id="history-deck" class="${!scopeAll ? 'selected' : ''}">このゲーム</button><button id="history-all" class="${scopeAll ? 'selected' : ''}">全ゲーム</button></div>
    <div class="history-list">${list.length ? list.map(s => { const o = summarize(s.answers); return `<button class="history-item" data-session="${esc(s.id)}"><div class="row between"><strong>${esc(s.deckNameSnapshot)}</strong><b>${percent(o.accuracy)}</b></div><div class="row between"><small>${dateLabel(s.startedAt)} · ${esc(s.difficulty || '')}${s.status === 'playing' ? ' · 中断' : ''}</small><small>${o.count}問 · ${o.score}点</small></div><div class="row between muted"><span>平均${seconds(o.averageTime)}</span><span>最大${o.bestCombo} COMBO</span></div></button>`; }).join('') : '<div class="empty">学習すると結果が残るよ。</div>'}</div>`;
}
function bindHistory() {
  bind('#history-deck', 'click', () => { scopeAll = false; render(); }); bind('#history-all', 'click', () => { scopeAll = true; render(); });
  $$('[data-session]').forEach(el => bind(`[data-session="${el.dataset.session}"]`, 'click', () => sessionDetail(state.sessions.find(s => s.id === el.dataset.session))));
}
function answerList(session) {
  return session.answers.map(a => `<div class="answer-item"><span class="grade-pill ${a.grade.toLowerCase()}">${a.grade}</span><div><strong>${esc(a.promptSnapshot)}</strong><span>${esc(a.answerSnapshot)}</span><small>${seconds(a.elapsed)} · ${a.source === 'manual' ? '手動' : a.source === 'typed' ? '文字' : '音声'}${a.recognitionCorrected ? ' · 認識ミス修正' : ''}</small>${a.recognized ? `<small>認識：${esc(a.recognized)}</small>` : ''}</div></div>`).join('');
}
function sessionDetail(s) { dialog(s.deckNameSnapshot, `<p class="muted">${dateLabel(s.startedAt)} · ${esc(s.difficulty)}</p>${answerList(s)}`); }
function showResult(session) {
  const s = summarize(session.answers); page = 'home'; tabs();
  $('#main').innerHTML = `<section class="result"><span class="eyebrow">SESSION COMPLETE</span><h1>おつかれさま！</h1><p class="muted">${esc(session.deckNameSnapshot)} · ${s.count}問</p><div class="result-score"><small>SCORE</small><strong>${s.score.toLocaleString()}</strong><span>${percent(s.accuracy)} 正答</span></div><div class="grade-grid">${['PERFECT', 'GREAT', 'GOOD', 'MISS'].map(g => `<div><strong class="${g.toLowerCase()}">${s[g]}</strong><small>${g}</small></div>`).join('')}</div><div class="metric-grid"><div><strong>${s.bestCombo}</strong><small>最大コンボ</small></div><div><strong>${seconds(s.averageTime)}</strong><small>平均回答時間</small></div></div><button id="result-home" class="primary wide">ホームへ</button><button id="result-details" class="secondary wide">回答を振り返る</button></section>`;
  bind('#result-home', 'click', () => navigate('home')); bind('#result-details', 'click', () => sessionDetail(session));
}
function settingsPage() {
  const s = state.settings;
  return `<div class="section-head"><div><span class="eyebrow">SETTINGS</span><h1>設定</h1></div></div>
    <div class="card"><h3>音声・サウンド</h3><label class="toggle">問題の読み上げ<input id="speechEnabled" type="checkbox" ${s.speechEnabled ? 'checked' : ''}></label><p class="muted">端末内の日本語音声を使用します。利用できない場合は文字で出題します。</p>
      ${[['speechVolume', '発音音量'], ['bgmVolume', 'BGM音量'], ['seVolume', '効果音音量']].map(([key, label]) => `<label class="volume-label">${label}<output id="${key}-value">${Math.round(s[key] * 100)}%</output><input id="${key}" type="range" min="0" max="1" step="0.01" value="${s[key]}"></label>`).join('')}
      <label>BGM<select id="settings-track">${trackOptions()}</select></label><button id="bgm-preview" class="secondary wide">BGMを試聴</button>
      <label class="file-picker">自分の音楽を読み込む<input id="audio-import" type="file" accept="audio/*"></label><p class="muted" id="audio-name">音楽ファイルを確認中…</p><button id="audio-remove" class="text-button">自分の音楽を削除</button></div>
    <div class="card"><h3>音声回答</h3><label>認識方法<select id="recognition-mode"><option value="local" ${s.recognitionMode === 'local' ? 'selected' : ''}>端末内認識を優先</option><option value="remote" ${s.recognitionMode === 'remote' ? 'selected' : ''}>通常の音声認識を使用</option><option value="off" ${s.recognitionMode === 'off' ? 'selected' : ''}>音声認識を使用しない</option></select></label>
      <p class="notice">通常認識では、ブラウザーによって音声が認識サービスへ送信される場合があります。会社の機密情報は、端末内認識または手動判定で扱ってください。</p><p id="local-status" class="muted">端末内認識の状態を確認中…</p><button id="local-install" class="secondary wide" hidden>日本語認識パックをダウンロード</button><label class="toggle">「さん」の有無を許容<input id="allowSan" type="checkbox" ${s.allowSan ? 'checked' : ''}></label><p class="muted">誤認識する言葉は「別解」に登録すると判定しやすくなるよ。</p></div>
    <div class="card"><h3>ゲーム</h3><label>難易度<select id="settings-difficulty">${Object.entries(DIFFICULTIES).map(([key, ms]) => `<option value="${key}" ${s.difficulty === key ? 'selected' : ''}>${key} · ${ms / 1000}秒</option>`).join('')}</select></label><label class="toggle">振動<input id="vibration" type="checkbox" ${s.vibration ? 'checked' : ''}></label><label class="toggle">正解エフェクト<input id="effects-enabled" type="checkbox" ${s.effects ? 'checked' : ''}></label><p class="muted">端末の「動きを減らす」設定も反映します。</p></div>
    <div class="card"><h3>データ保存</h3><p id="storage-state" class="muted">保存状態を確認中…</p><button id="persist" class="secondary wide">永続保存を再申請</button><button id="export-backup" class="primary wide">完全バックアップを書き出す</button><label class="file-picker">バックアップから復元<input id="restore-file" type="file" accept="application/json,.json"></label><button id="export-ai" class="secondary wide">AI編集用JSONを書き出す</button><p class="muted">問題と履歴はこのブラウザーに保存されます。別端末への移動はバックアップを使ってね。音楽ファイルはバックアップに含まれません。</p></div>
    <div class="card"><h3>ゲームの並び順</h3>${sorted(state.decks).map(d => `<div class="deck-order"><span>${esc(d.icon || '▣')} ${esc(d.name)}</span><button data-deck-up="${esc(d.id)}" class="icon-button" aria-label="${esc(d.name)}を上へ">↑</button><button data-deck-down="${esc(d.id)}" class="icon-button" aria-label="${esc(d.name)}を下へ">↓</button></div>`).join('') || '<p class="muted">まだゲームがありません。</p>'}</div>
    <div class="card"><h3>アプリ情報</h3><p>MEMORY BEAT v${VERSION}</p><label>アプリのアドレス</label><div class="url-row"><code>${esc(new URL('./', location.href).href)}</code><button id="copy-url" class="secondary">コピー</button></div><button id="install-app" class="secondary wide">ホーム画面に追加</button><button id="update-app" class="text-button wide">アプリの更新を確認</button><p class="muted" id="offline-status">アプリのキャッシュを確認中…</p></div>
    <details class="danger-zone"><summary>全データ削除</summary><p class="muted">問題・ゲーム・成績・音楽をすべて削除します。</p><button id="clear-data" class="danger wide">全データ削除へ</button></details>`;
}
function bindSettings() {
  for (const key of ['speechEnabled', 'vibration', 'allowSan']) bind(`#${key}`, 'change', e => setting({ [key]: e.target.checked }));
  bind('#effects-enabled', 'change', e => setting({ effects: e.target.checked }));
  for (const key of ['speechVolume', 'bgmVolume', 'seVolume']) {
    bind(`#${key}`, 'input', e => { $(`#${key}-value`).value = `${Math.round(Number(e.target.value) * 100)}%`; });
    bind(`#${key}`, 'change', async e => { previewAudio?.stop(); await setting({ [key]: Number(e.target.value) }); });
  }
  bind('#settings-difficulty', 'change', e => setting({ difficulty: e.target.value }));
  bind('#settings-track', 'change', async e => { previewAudio?.stop(); await setting({ bgmTrack: e.target.value }); });
  bind('#bgm-preview', 'click', async e => { if (previewAudio?.timer || previewAudio?.custom) { previewAudio.stop(); e.currentTarget.textContent = 'BGMを試聴'; return; } previewAudio = new AudioEngine(state.settings); await previewAudio.start(); e.currentTarget.textContent = '試聴を停止'; });
  bind('#audio-import', 'change', async e => {
    const file = e.target.files[0]; if (!file) return; if (file.size > 50 * 1024 * 1024 || !file.type.startsWith('audio/')) throw new Error('50MB以下の音楽ファイルを選んでね');
    previewAudio?.stop(); await put('audio', { id: 'custom', name: file.name, blob: file, importedAt: nowISO() }); await setting({ bgmTrack: 'custom' }); render(); toast('音楽を読み込んだよ');
  });
  bind('#audio-remove', 'click', async () => { if (!confirm('保存した音楽を削除しますか？')) return; previewAudio?.stop(); await write([{ store: 'audio', type: 'delete', id: 'custom' }]); await setting({ bgmTrack: 'focus' }); render(); });
  bind('#recognition-mode', 'change', async e => {
    const mode = e.target.value;
    if (mode === 'remote' && !state.settings.remoteConsent) {
      e.target.value = state.settings.recognitionMode;
      dialog('通常の音声認識を使う？', '<p class="notice">ブラウザーによっては音声が認識サービスへ送信される場合があります。会社情報を含む回答を送信してよいか確認してください。</p><button id="consent-remote" class="primary wide">理解して通常認識を使用する</button><button id="consent-cancel" class="secondary wide">端末内認識・手動判定を使う</button>');
      bind('#consent-remote', 'click', async () => { await setting({ recognitionMode: 'remote', remoteConsent: true }); closeDialog(); render(); }); bind('#consent-cancel', 'click', closeDialog);
    } else { await setting({ recognitionMode: mode, remoteConsent: mode === 'remote' ? state.settings.remoteConsent : false }); render(); }
  });
  bind('#local-install', 'click', async e => { e.currentTarget.disabled = true; toast('日本語パックをダウンロードしています'); const success = await installLocalRecognition(); toast(success ? '準備できたよ' : 'この環境ではダウンロードできませんでした', !success); render(); });
  bind('#persist', 'click', async () => { const result = await requestPersistence(); toast(result ? '永続保存が許可されたよ' : '今回は許可されませんでした。バックアップも保存してね'); render(); });
  bind('#export-backup', 'click', () => exportBackup(state)); bind('#export-ai', 'click', () => exportAI(state)); bind('#restore-file', 'change', e => previewRestore(ctx, e.target.files[0]));
  bind('#copy-url', 'click', async e => { await copyText(new URL('./', location.href).href); e.currentTarget.textContent = 'コピー済み ✓'; setTimeout(() => { if ($('#copy-url')) $('#copy-url').textContent = 'コピー'; }, 2500); });
  bind('#install-app', 'click', async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; } else dialog('ホーム画面に追加', '<p>Android Chromeの右上メニューから「ホーム画面に追加」または「アプリをインストール」を選んでね。</p>'); });
  bind('#update-app', 'click', async () => { if (!swRegistration) { toast('キャッシュの準備にはHTTPSでの公開が必要です', true); return; } await swRegistration.update(); if (swRegistration.waiting) { swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' }); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); } else toast('更新を確認したよ'); });
  for (const direction of ['up', 'down']) $$(`[data-deck-${direction}]`).forEach(el => bind(`[data-deck-${direction}="${el.dataset[direction === 'up' ? 'deckUp' : 'deckDown']}"]`, 'click', () => reorderDeck(ctx, el.dataset[direction === 'up' ? 'deckUp' : 'deckDown'], direction === 'up' ? -1 : 1)));
  bind('#clear-data', 'click', () => {
    dialog('削除前にバックアップ', '<p>すべてのゲーム・問題・学習履歴・音楽を削除します。先にバックアップを保存してください。</p><button id="clear-backup" class="primary wide">バックアップを書き出す</button><button id="clear-stage2" class="danger wide">削除の最終確認へ</button>');
    bind('#clear-backup', 'click', () => exportBackup(state));
    bind('#clear-stage2', 'click', () => {
      dialog('全データを削除', '<p>この操作は元に戻せません。「削除」と入力してください。</p><input id="delete-word" aria-label="削除と入力" autocomplete="off"><button id="clear-final" class="danger wide" disabled>すべて削除する</button>');
      bind('#delete-word', 'input', e => { $('#clear-final').disabled = e.target.value !== '削除'; });
      bind('#clear-final', 'click', async () => { await clearUserData(); closeDialog(); await reload(); page = 'home'; ctx.selection.clear(); render(); toast('全データを削除しました'); });
    });
  });
  storageState().then(s => { if ($('#storage-state')) $('#storage-state').textContent = `${s.persistent ? '永続保存：許可済み' : '永続保存：未許可'}${s.estimate ? ` / 使用 ${(s.estimate.usage / 1024 / 1024).toFixed(1)} MB` : ''}`; });
  recognitionState('local').then(s => { if ($('#local-status')) { $('#local-status').textContent = s.label; $('#local-install').hidden = !['downloadable', 'downloading'].includes(s.status); } });
  all('audio').then(files => { if ($('#audio-name')) $('#audio-name').textContent = files.find(f => f.id === 'custom')?.name || '音楽ファイルはまだ登録していません'; });
  if ($('#offline-status')) $('#offline-status').textContent = swRegistration?.active ? 'オフライン用キャッシュ：準備済み' : 'オフライン用キャッシュ：準備中';
}
async function createSample() {
  const now = nowISO(), sample = { id: uuid(), name: 'サンプル', description: '架空の合言葉で試してみよう', icon: '✦', color: '#a695ff', sortOrder: state.decks.length * 10, createdAt: now, updatedAt: now };
  const rows = [['青チームの合言葉', 'スター', ['すたー']], ['赤チームの合言葉', 'ムーン', ['むーん']], ['緑チームの合言葉', 'リーフ', ['りーふ']], ['黄色チームの合言葉', 'サン', ['さん']], ['星のマークの色', '青', ['あお']], ['月のマークの色', '赤', ['あか']]];
  await write([{ store: 'decks', value: sample }, ...rows.map(([prompt, answer, acceptedAnswers], i) => ({ store: 'questions', value: questionRecord(sample.id, { prompt, answer, acceptedAnswers }, i * 10) })), { store: 'settings', value: { ...state.settings, selectedDeckId: sample.id } }]);
  await reload(); render();
}
function navigate(nextPage) { if (document.body.classList.contains('playing')) return; page = nextPage; ctx.selection.clear(); render(); window.scrollTo(0, 0); }
bind('#dialog-close', 'click', closeDialog); bind('#brand-home', 'click', () => navigate('home'));
$$('[data-page]').forEach(el => bind(`[data-page="${el.dataset.page}"]`, 'click', () => navigate(el.dataset.page)));
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && game && !game.ended) { e.preventDefault(); game.paused ? game.resume() : game.pause(); } });
async function init() {
  try { await reload(); render(); }
  catch (error) { $('#main').innerHTML = `<div class="empty"><h1>保存領域を開けませんでした</h1><p>${esc(error.message)}</p><button id="retry-init" class="primary">再試行</button></div>`; bind('#retry-init', 'click', init); }
  if ('serviceWorker' in navigator) {
    try { swRegistration = await navigator.serviceWorker.register('./sw.js'); swRegistration.addEventListener('updatefound', () => { const worker = swRegistration.installing; worker.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) toast('新しい版があります。設定から更新できます'); }); }); }
    catch { toast('オフライン用キャッシュを準備できませんでした。オンラインでは利用できます', true); }
  }
}
init();
