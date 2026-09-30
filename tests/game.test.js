import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { DEFAULT_SETTINGS } from '../js/config.js';
import { summarize } from '../js/core.js';
const elements = new Map();
globalThis.document = { querySelectorAll: () => [], querySelector: selector => { if(!elements.has(selector)) elements.set(selector,{textContent:'',style:{},clientHeight:selector==='.arena'?400:90}); return elements.get(selector); } };
globalThis.requestAnimationFrame = () => 1;
function game() {
  const q={id:'q1',deckId:'d1',prompt:'架空',answer:'スター',acceptedAnswers:['すたー']};
  const ctx={state:{settings:{...DEFAULT_SETTINGS,effects:false,vibration:false},stats:{},sessions:[]}};
  const g=new Game(ctx,{id:'d1',name:'架空'},[q]);g.phase='answer';g.lastFrame=0;g.current=q;g.displayQuestion=q;g.elapsed=0;g.recognition={mode:'local'};g.limit=4500;
  return g;
}
test('回答時計の期限と話し始めた後の認識猶予を分離',()=>{
  const g=game();const calls=[];g.settle=(...args)=>{calls.push(args);g.phase='feedback';};
  g.frame(4499);assert.equal(calls.length,0);g.frame(4501);assert.equal(calls.length,1);assert.equal(calls[0][1],'timeout');
  const grace=game();grace.speechStart=1200;const pending=[];grace.settle=(...args)=>pending.push(args);
  grace.frame(4501);assert.equal(pending.length,0);grace.frame(6099);assert.equal(pending.length,0);grace.frame(6101);assert.equal(pending.length,1);assert.equal(pending[0][2],1200);
});
test('選択肢タップは正誤と速度を判定し、読上中・停止中・二重タップを無視',()=>{
  const g=game();g.usingChoices=true;g.choices=['ムーン','スター','リーフ','サン'];g.elapsed=800;const calls=[];g.settle=(...args)=>{calls.push(args);g.phase='feedback';};
  g.phase='reading';g.choose(1);assert.equal(calls.length,0);g.phase='answer';g.paused=true;g.choose(1);assert.equal(calls.length,0);g.paused=false;
  g.choose(1);g.choose(0);assert.deepEqual(calls,[[true,'choice',800,'スター']]);
  g.phase='answer';g.choose(0);assert.equal(calls[1][0],false);g.phase='answer';g.choose(-1);g.choose(20);assert.equal(calls.length,2);
});
test('逆方向では問題・答え・読上言語を交換し、順方向の選択肢を再利用しない',()=>{
  const g=game();g.settings.direction='reverse';const q=g.orient({prompt:'allocate',answer:'割り当てる',promptLang:'en-US',answerLang:'ja-JP',choices:['承認する'],excludeChoices:['委任する']});
  assert.equal(q.prompt,'割り当てる');assert.equal(q.answer,'allocate');assert.equal(q.promptLang,'ja-JP');assert.deepEqual(q.choices,[]);assert.deepEqual(q.excludeChoices,[]);
});
test('時間モードは指定時間で終了、一時停止中は両時計を維持',()=>{
  const g=game();g.settings.sessionMode='time';g.remainingSession=500;g.paused=true;g.frame(400);assert.equal(g.remainingSession,500);assert.equal(g.elapsed,0);
  g.paused=false;let timedOut=false;g.settle=()=>{timedOut=true;g.phase='feedback';};g.frame(1000);assert.equal(g.remainingSession,0);assert.equal(timedOut,true);
});
test('音声確定が遅くても話し始めの時刻を判定に使用',()=>{
  const g=game();let handlers,actual;g.speech={listen:(_mode,callbacks)=>{handlers=callbacks;}};g.settle=(...args)=>actual=args;
  g.listen();g.elapsed=400;handlers.onSpeechStart();g.elapsed=2200;handlers.onResult(['すたー']);assert.equal(actual[0],true);assert.equal(actual[1],'voice');assert.equal(actual[2],400);
});
test('誤認識修正は同じ回答を変更し二重カウントしない',async()=>{
  const g=game();g.phase='feedback';g.pendingIndex=0;g.session.answers=[{grade:'MISS',elapsed:1000,limit:4500,recognitionCorrected:false}];
  g.updateFeedback=()=>{g.session.summary=summarize(g.session.answers);};let writes=0;g.persistPending=async()=>{writes++;return true;};
  await g.correct();await g.correct();assert.equal(g.session.answers.length,1);assert.equal(g.session.answers[0].grade,'PERFECT');assert.equal(g.session.answers[0].recognitionCorrected,true);assert.equal(writes,1);assert.equal(g.session.summary.score,100);
});
