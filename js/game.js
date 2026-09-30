import { DIFFICULTIES, GAME_TIMING } from './config.js';
import { selectQuestions, statKey, matches, judge, updateStat, summarize, choicesFor } from './core.js';
import { write } from './db.js';
import { Speech, recognitionState } from './speech.js';
import { AudioEngine } from './audio.js';
import { rewardEffect } from './effects.js';
import { $, bind, escapeHTML as esc, uuid, nowISO, toast, seconds } from './utils.js';
export class Game {
  constructor(ctx, deck, questions) {
    this.ctx = ctx; this.deck = deck; this.questions = questions; this.settings = { ...ctx.state.settings };
    this.limit = DIFFICULTIES[this.settings.difficulty]; this.speech = new Speech(this.settings); this.audio = new AudioEngine(this.settings);
    this.queue = []; this.phase = 'init'; this.paused = false; this.ended = false; this.token = 0; this.saving = false; this.saved = true;
    this.remainingSession = this.settings.minutes * 60000;
    this.session = { id: uuid(), deckId: deck.id, deckNameSnapshot: deck.name, difficulty: this.settings.difficulty, mode: this.settings.sessionMode, direction: this.settings.direction,
      answerMode: this.settings.answerMode, target: this.settings.sessionMode === 'count' ? Math.min(this.settings.count, questions.length) : this.settings.minutes,
      startedAt: nowISO(), endedAt: null, status: 'playing', answers: [], summary: summarize([]) };
    this.onVisibility = () => { if (document.hidden && !this.ended) this.pause(); };
  }
  async start() {
    await this.audio.unlock();
    this.recognition = this.settings.answerMode === 'choices' ? { mode: 'manual', label: '選択肢をタップして回答' } : await recognitionState(this.settings.recognitionMode === 'remote' && !this.settings.remoteConsent ? 'off' : this.settings.recognitionMode);
    await write([{ store: 'sessions', value: this.session }]);
    document.body.classList.add('playing'); this.render(); document.addEventListener('visibilitychange', this.onVisibility);
    this.lastFrame = performance.now(); this.raf = requestAnimationFrame(t => this.frame(t)); await this.audio.start();
    await this.next();
  }
  render() {
    $('#main').innerHTML = `<section class="game"><div class="game-top"><div><small>SCORE</small><strong id="score-value">0</strong></div><div><small>COMBO</small><strong id="combo-value">0</strong></div><div><small id="remaining-label">${this.settings.sessionMode === 'count' ? '残り' : 'TIME'}</small><strong id="remaining-value"></strong></div><button class="icon-button" id="game-pause" aria-label="一時停止">Ⅱ</button><button class="icon-button" id="game-end" aria-label="終了">×</button></div>
      <div class="game-caption"><span>${esc(this.deck.name)}</span><span>${esc(this.settings.difficulty)} · ${this.settings.direction === 'reverse' ? '答え → 問題' : '問題 → 答え'}</span></div>
      <div class="arena"><div class="lane"></div><div id="falling" class="falling"><small>RECALL</small><strong id="game-prompt"></strong></div><div class="judgment-line"><span>ANSWER LINE</span></div><div id="pause-layer" class="pause-layer" hidden><span class="eyebrow">PAUSED</span><h2>ひと休み</h2><button id="game-resume" class="primary">再開する</button></div></div>
      <div class="game-bottom"><div class="listening"><span id="speech-status">${esc(this.recognition.label)}</span><span id="question-index"></span></div><p id="recognized" class="recognized" aria-live="polite">声に出して答えよう</p><div class="time-bar"><i id="time-fill"></i></div>
      <div id="choice-controls" hidden><div id="answer-choices" class="answer-choices" aria-label="答えの選択肢"></div><p id="choice-hint" class="muted"></p></div>
      <div id="answer-controls"><button id="reveal-answer" class="secondary wide">答えを見る・手動で判定</button><div class="typed-answer"><input id="typed-text" autocomplete="off" aria-label="文字で回答" placeholder="文字で回答もできる"><button id="typed-submit" class="secondary">回答</button></div><button id="retry-mic" class="text-button" ${this.recognition.mode === 'manual' ? 'hidden' : ''}>マイクを再開</button></div>
      <div id="manual-controls" hidden><div id="revealed-answer" class="revealed-answer"></div><div class="grid2"><button id="manual-correct" class="primary">○ 正解</button><button id="manual-wrong" class="danger">× 不正解</button></div></div>
      <div id="feedback-controls" hidden><div class="feedback-head"><strong id="grade-label" aria-live="polite"></strong><span id="response-time"></span></div><div class="answer-review"><small id="review-prompt"></small><strong id="review-answer"></strong><p id="review-note"></p><small id="review-recognition"></small></div><button id="correct-recognition" class="secondary wide" hidden>正解扱いに修正</button><button id="next-question" class="primary wide">次へ</button><small id="save-status" class="muted"></small></div></div></section>`;
    bind('#game-pause', 'click', () => this.pause()); bind('#game-resume', 'click', () => this.resume());
    bind('#game-end', 'click', async () => { this.pause(); if (confirm('ここまでの成績を保存して終了しますか？')) await this.finish(); else this.resume(); });
    bind('#reveal-answer', 'click', () => this.reveal());
    bind('#manual-correct', 'click', () => this.settle(true, 'manual', this.revealElapsed)); bind('#manual-wrong', 'click', () => this.settle(false, 'manual', this.revealElapsed));
    bind('#typed-submit', 'click', () => { if (this.phase === 'answer' && !this.paused) this.settle(matches($('#typed-text').value, this.displayQuestion, this.settings.allowSan), 'typed', this.elapsed, $('#typed-text').value); });
    bind('#typed-text', 'keydown', e => { if (e.key === 'Enter') $('#typed-submit').click(); });
    bind('#retry-mic', 'click', () => this.listen()); bind('#next-question', 'click', () => this.next());
    bind('#correct-recognition', 'click', () => this.correct());
  }
  frame(time) {
    if (this.ended) return;
    const delta = Math.max(0, time - this.lastFrame); this.lastFrame = time;
    if (!this.paused) {
      if (this.settings.sessionMode === 'time') {
        this.remainingSession = Math.max(0, this.remainingSession - delta);
        if (!this.remainingSession && !this.saving) {
          if (this.phase === 'answer' || this.phase === 'revealed') this.settle(false, 'timeout', Math.min(this.elapsed, this.limit));
          else if (this.phase !== 'finishing') this.finish();
        }
      }
      if (this.phase === 'answer') {
        this.elapsed += delta;
        const ratio = Math.min(1, this.elapsed / this.limit), card = $('#falling'), arena = $('.arena');
        if (card && arena) {
          const distance = Math.max(0, arena.clientHeight - card.clientHeight - 50); card.style.transform = `translateY(${distance * ratio}px)`;
          $('#time-fill').style.transform = `scaleX(${1 - ratio})`;
        }
        if (this.elapsed >= this.limit) {
          if (this.speechStart != null && this.speechStart < this.limit && this.elapsed < this.limit + GAME_TIMING.recognitionGrace) $('#speech-status').textContent = '認識結果を待っています…';
          else this.settle(false, 'timeout', this.speechStart ?? this.limit, this.recognized);
        }
      }
      if (this.phase === 'feedback' && this.autoNext && !this.saving) {
        this.autoNext -= delta; if (this.autoNext <= 0) { this.autoNext = 0; this.next(); }
      }
    }
    const remainingSeconds = Math.ceil(this.remainingSession / 1000);
    if ($('#remaining-value')) $('#remaining-value').textContent = this.settings.sessionMode === 'count' ? `${Math.max(0, this.session.target - this.session.answers.length)}問` : `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;
    this.raf = requestAnimationFrame(t => this.frame(t));
  }
  async next() {
    if (this.ended || this.saving || this.paused || this.phase === 'reading' || this.phase === 'answer' || this.phase === 'revealed') return;
    if (!this.saved && !(await this.persistPending())) return;
    if ((this.settings.sessionMode === 'count' && this.session.answers.length >= this.session.target) || (this.settings.sessionMode === 'time' && this.remainingSession <= 0)) return this.finish();
    this.autoNext = 0; this.speech.stop();
    if (!this.queue.length) this.queue = selectQuestions(this.questions, this.ctx.state.stats, this.settings.sessionMode === 'count' ? this.session.target : this.questions.length, Math.random, Date.now(), this.current?.id);
    const q = this.queue.shift(); if (!q) return this.finish();
    this.current = q; this.displayQuestion = this.orient(q);
    this.choices = this.settings.answerMode === 'choices' ? choicesFor(this.displayQuestion, this.questions.map(question => this.orient(question))) : [];
    this.usingChoices = this.choices.length > 1;
    this.baseline = this.ctx.state.stats[statKey(q)]; this.elapsed = 0; this.speechStart = null; this.recognized = ''; this.pendingIndex = null;
    $('#game-prompt').textContent = this.displayQuestion.prompt; $('#falling').style.transform = 'translateY(0)'; $('#falling').hidden = false; $('#falling').className = this.displayQuestion.prompt.length > 40 ? 'falling long' : 'falling';
    $('#answer-controls').hidden = this.usingChoices; $('#manual-controls').hidden = true; $('#feedback-controls').hidden = true; $('#choice-controls').hidden = !this.usingChoices;
    $('#retry-mic').hidden = this.recognition.mode === 'manual';
    $('#answer-choices').innerHTML = this.usingChoices ? this.choices.map((text, index) => `<button class="answer-choice" data-choice="${index}" disabled><small>${index + 1}</small><span>${esc(text)}</span></button>`).join('') : '';
    document.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => this.choose(Number(button.dataset.choice))));
    $('#choice-hint').textContent = '正しい答えをタップ';
    $('#recognized').textContent = '問題を読み上げています'; $('#typed-text').value = ''; $('#time-fill').style.transform = 'scaleX(1)';
    $('#question-index').textContent = `${this.session.answers.length + 1}問目`;
    await this.readQuestion();
  }
  orient(q) {
    return this.settings.direction === 'reverse' ? { ...q, prompt: q.answer, answer: q.prompt, promptSpeech: q.answerSpeech, answerSpeech: q.promptSpeech, promptLang: q.answerLang, answerLang: q.promptLang, acceptedAnswers: [], choices: [], excludeChoices: [] } : q;
  }
  choose(index) {
    if (!this.usingChoices || this.phase !== 'answer' || this.paused || this.ended || !Number.isInteger(index) || index < 0 || index >= this.choices.length) return;
    const chosen = this.choices[index];
    this.settle(chosen === this.displayQuestion.answer, 'choice', this.elapsed, chosen);
  }
  async readQuestion() {
    const token = ++this.token; this.phase = 'reading'; this.audio.duck(true);
    const spoken = await this.speech.speak(this.displayQuestion.promptSpeech || this.displayQuestion.prompt, this.displayQuestion.promptLang || 'ja-JP');
    if (token !== this.token || this.ended || this.paused) return;
    this.phase = 'answer'; this.lastFrame = performance.now();
    $('#recognized').textContent = this.usingChoices ? '正しい答えをタップしよう' : this.settings.answerMode === 'choices' ? '選択肢が足りないため、答えを思い出して手動で判定' : this.recognition.mode === 'manual' ? '口頭で答えてから「答えを見る」' : '声に出して答えよう';
    document.querySelectorAll('[data-choice]').forEach(button => { button.disabled = false; });
    $('#speech-status').textContent = !spoken && this.settings.speechEnabled ? '端末内の読み上げなし・文字で出題' : this.recognition.label;
    if (this.recognition.mode !== 'manual') this.listen(); else this.audio.duck(false);
  }
  listen() {
    if (this.phase !== 'answer' || this.paused || this.recognition.mode === 'manual') return;
    const token = this.token;
    const active = () => token === this.token && this.phase === 'answer' && !this.paused && !this.ended;
    this.speech.listen(this.recognition.mode, {
      onStatus: label => { if (active()) $('#speech-status').textContent = label; },
      onSpeechStart: () => { if (active() && this.speechStart == null) this.speechStart = this.elapsed; },
      onText: text => { if (active()) { this.recognized = text; $('#recognized').textContent = text; } },
      onResult: texts => {
        if (!active()) return; const correct = texts.some(text => matches(text, this.displayQuestion, this.settings.allowSan));
        const text = texts.find(text => matches(text, this.displayQuestion, this.settings.allowSan)) || texts[0];
        this.settle(correct, 'voice', this.speechStart ?? this.elapsed, text);
      },
      onError: code => {
        if (!active()) return;
        $('#speech-status').textContent = `音声認識を利用できません (${code})・手動で続けられます`;
        this.audio.duck(false);
      },
      onEnd: () => { if (active()) { $('#speech-status').textContent = '聞き取り終了・マイク再開または手動判定'; this.audio.duck(false); } }
    });
  }
  reveal() {
    if (this.phase !== 'answer' || this.paused) return;
    this.revealElapsed = this.elapsed; this.phase = 'revealed'; this.speech.stopRecognition(); this.audio.duck(false);
    $('#answer-controls').hidden = true; $('#manual-controls').hidden = false; $('#falling').hidden = true;
    $('#revealed-answer').textContent = this.displayQuestion.answer; $('#recognized').textContent = '口頭で答えた内容と比べて判定してね'; $('#speech-status').textContent = '手動判定';
  }
  async settle(correct, source, elapsed, recognized = '') {
    if (!['answer', 'revealed'].includes(this.phase) || this.paused || this.ended) return;
    this.phase = 'feedback'; this.token++; this.speech.stopRecognition(); this.audio.duck(false);
    const answer = { id: uuid(), questionId: this.current.id, statKey: statKey(this.current), deckId: this.deck.id,
      promptSnapshot: this.displayQuestion.prompt, answerSnapshot: this.displayQuestion.answer, noteSnapshot: this.current.note || '',
      at: nowISO(), elapsed: Math.max(0, elapsed), limit: this.limit, grade: judge(correct, Math.max(0, elapsed), this.limit), source,
      recognized: recognized || this.recognized || '', recognitionCorrected: false, direction: this.settings.direction };
    if (source === 'choice') { answer.selectedAnswerSnapshot = recognized; answer.choicesSnapshot = [...this.choices]; }
    this.session.answers.push(answer); this.pendingIndex = this.session.answers.length - 1; this.saved = false;
    this.updateFeedback(); const saved = await this.persistPending();
    if (saved && answer.grade !== 'MISS' && !this.paused) this.autoNext = 1100;
  }
  updateFeedback() {
    const answer = this.session.answers[this.pendingIndex]; this.session.summary = summarize(this.session.answers);
    $('#score-value').textContent = this.session.summary.score; $('#combo-value').textContent = this.session.summary.combo;
    $('#falling').className = `falling ${this.displayQuestion.prompt.length > 40 ? 'long' : ''} reward-${answer.grade.toLowerCase()}`; $('#answer-controls').hidden = true; $('#manual-controls').hidden = true; $('#feedback-controls').hidden = false;
    document.querySelectorAll('[data-choice]').forEach(button => {
      const text = this.choices[Number(button.dataset.choice)]; button.disabled = true;
      button.classList.toggle('correct', text === answer.answerSnapshot);
      button.classList.toggle('wrong', answer.source === 'choice' && text === answer.selectedAnswerSnapshot && text !== answer.answerSnapshot);
    });
    $('#choice-hint').textContent = answer.grade === 'MISS' ? '緑の選択肢が正解' : '正解！';
    $('#grade-label').textContent = answer.grade; $('#grade-label').className = answer.grade.toLowerCase(); $('#response-time').textContent = seconds(answer.elapsed);
    $('#review-prompt').textContent = answer.promptSnapshot; $('#review-answer').textContent = answer.answerSnapshot;
    $('#review-note').textContent = answer.noteSnapshot; $('#review-recognition').textContent = answer.source === 'choice' ? `選んだ答え：${answer.selectedAnswerSnapshot}` : answer.recognized ? `認識：${answer.recognized}${answer.recognitionCorrected ? '（正解に修正済み）' : ''}` : answer.source === 'timeout' ? '時間切れ' : answer.source === 'manual' ? '手動判定' : '文字で回答';
    $('#correct-recognition').hidden = answer.grade !== 'MISS' || !['voice', 'timeout'].includes(answer.source) || this.recognition.mode === 'manual';
    $('#recognized').textContent = answer.grade === 'MISS' ? '答えを確認して、もう一度覚えよう' : '覚えた！';
    this.audio.reward(answer.grade); rewardEffect(answer.grade, this.session.summary.combo, this.settings);
  }
  async persistPending() {
    if (this.saved || this.pendingIndex == null) return true;
    if (this.saving) return false; this.saving = true; $('#next-question').disabled = true; $('#correct-recognition').disabled = true; $('#save-status').textContent = '保存中…';
    const answer = this.session.answers[this.pendingIndex]; const stat = updateStat(this.baseline, answer, this.current);
    try {
      this.session.summary = summarize(this.session.answers); await write([{ store: 'stats', value: stat }, { store: 'sessions', value: this.session }]);
      this.ctx.state.stats[stat.id] = stat; const idx = this.ctx.state.sessions.findIndex(s => s.id === this.session.id);
      if (idx >= 0) this.ctx.state.sessions[idx] = structuredClone(this.session); else this.ctx.state.sessions.push(structuredClone(this.session));
      this.saved = true; $('#save-status').textContent = '成績を保存済み'; return true;
    } catch (e) { $('#save-status').textContent = '保存できませんでした。「次へ」で保存を再試行します'; this.autoNext = 0; toast(`成績の保存に失敗：${e.message}`, true); return false; }
    finally { this.saving = false; $('#next-question').disabled = false; $('#correct-recognition').disabled = false; }
  }
  async correct() {
    if (this.phase !== 'feedback' || this.saving || this.pendingIndex == null) return;
    const answer = this.session.answers[this.pendingIndex]; if (answer.recognitionCorrected) return;
    answer.recognitionCorrected = true;
    // 認識結果待ちの時間切れは速度の推定を過大評価しないようGOODにする。
    if (answer.elapsed >= answer.limit) answer.elapsed = answer.limit - 1;
    answer.grade = judge(true, answer.elapsed, answer.limit); this.saved = false; this.updateFeedback(); await this.persistPending(); this.autoNext = 0;
  }
  pause() {
    if (this.paused || this.ended) return; this.paused = true; this.phaseBeforePause = this.phase; this.token++; this.speech.stop(); this.audio.stop(); $('#pause-layer').hidden = false;
    $('#answer-controls').inert = true; $('#manual-controls').inert = true; $('#feedback-controls').inert = true; $('#choice-controls').inert = true;
  }
  async resume() {
    if (!this.paused || this.ended) return; this.paused = false; this.lastFrame = performance.now(); $('#pause-layer').hidden = true;
    $('#answer-controls').inert = false; $('#manual-controls').inert = false; $('#feedback-controls').inert = false; $('#choice-controls').inert = false;
    await this.audio.start();
    if (this.phaseBeforePause === 'reading') await this.readQuestion();
    else if (this.phase === 'answer') { this.audio.duck(this.recognition.mode !== 'manual'); this.listen(); }
  }
  async finish() {
    if (this.ended || this.saving || this.phase === 'finishing') return;
    if (!this.saved && !(await this.persistPending())) return;
    const prior = this.phase; this.phase = 'finishing'; this.token++; this.speech.stop(); this.audio.stop();
    this.session.endedAt = nowISO(); this.session.status = 'completed'; this.session.summary = summarize(this.session.answers);
    try { await write([{ store: 'sessions', value: this.session }]); }
    catch (e) { this.phase = prior; this.pause(); toast(`終了結果を保存できませんでした：${e.message}`, true); return; }
    this.ended = true; cancelAnimationFrame(this.raf); document.removeEventListener('visibilitychange', this.onVisibility); document.body.classList.remove('playing');
    await this.ctx.reload(); this.ctx.showResult(this.session);
  }
}
