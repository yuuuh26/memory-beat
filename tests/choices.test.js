import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { choicesFor, normalize } from '../js/core.js';
import { packRecords, ensureStarterPacks } from '../js/packs.js';
import { sanitizeSettings, validateBackup, fullBackup } from '../js/backup.js';
import { activateUpdate } from '../js/pwa.js';
const pack = JSON.parse(fs.readFileSync(new URL('../data/toeic.json', import.meta.url), 'utf8'));
test('TOEIC BEATの500語・5レベル各100語を保持し全問4択を生成',()=>{
  assert.equal(pack.questions.length,500);assert.equal(new Set(pack.questions.map(q=>q.id)).size,500);
  for(let level=1;level<=5;level++)assert.equal(pack.questions.filter(q=>q.tags.includes(`Level ${level}`)).length,100);
  for(const q of pack.questions){
    const choices=choicesFor(q,pack.questions,()=>.41);assert.equal(choices.length,4,q.prompt);assert.equal(choices.filter(a=>a===q.answer).length,1);assert.equal(new Set(choices.map(a=>normalize(a))).size,4);
    for(const a of choices.filter(a=>a!==q.answer))assert(!(q.excludeChoices||[]).map(a=>normalize(a)).includes(normalize(a)),q.prompt);
    assert.equal(q.promptLang,'en-US');assert(q.note.includes('Level'));
  }
});
test('明示選択肢優先、正解は一度だけ、別解・句読点違いの誤答を除外',()=>{
  const q={id:'q1',answer:'スター',acceptedAnswers:['すたー'],choices:['スター','スター！','すたー','ムーン','リーフ','サン']};
  const choices=choicesFor(q,[{id:'other',answer:'使わない'}],()=>.4);assert.equal(choices.length,4);assert(choices.includes('スター'));assert(!choices.includes('スター！'));assert(!choices.includes('すたー'));assert(!choices.includes('使わない'));
});
test('汎用ゲームと逆方向の選択肢、問題不足時は偽の答えを作らない',()=>{
  const qs=[{id:'q1',prompt:'青',answer:'スター'},{id:'q2',prompt:'赤',answer:'ムーン'},{id:'q3',prompt:'緑',answer:'リーフ'},{id:'q4',prompt:'黄',answer:'サン'}];
  assert.equal(choicesFor(qs[0],qs).length,4);assert.deepEqual(choicesFor(qs[0],[qs[0]]),['スター']);
  const reverse=qs.map(q=>({...q,prompt:q.answer,answer:q.prompt}));assert.equal(choicesFor(reverse[0],reverse).length,4);
});
test('教材導入は既存データを消さず一度だけ。削除後に再追加しない',async()=>{
  const markers=[];let operations=[],fetches=0;
  const state={decks:[{id:'existing'}],settings:sanitizeSettings({selectedDeckId:'existing'})};
  const io={all:async()=>markers,fetch:async()=>{fetches++;return{ok:true,json:async()=>pack};},write:async ops=>{operations=ops;markers.push(...ops.filter(o=>o.store==='meta').map(o=>o.value));}};
  assert.equal(await ensureStarterPacks(state,io),1);assert.equal(operations.filter(o=>o.store==='questions').length,500);assert(operations.every(o=>!o.type));assert.equal(operations.find(o=>o.store==='settings').value.answerMode,'choices');
  assert.equal(await ensureStarterPacks(state,io),0);assert.equal(fetches,1);
});
test('復元済み教材は上書きせず導入印だけ保存、壊れた教材は無変更',async()=>{
  let ops;const state={decks:[{id:'pack-toeic-v1'}],settings:sanitizeSettings()};
  await ensureStarterPacks(state,{all:async()=>[],fetch:async()=>({ok:true,json:async()=>pack}),write:async o=>ops=o});assert.equal(ops.length,1);assert.equal(ops[0].store,'meta');
  let written=false;await assert.rejects(()=>ensureStarterPacks(state,{all:async()=>[],fetch:async()=>({ok:true,json:async()=>({id:'wrong'})}),write:async()=>written=true}));assert.equal(written,false);
});
test('旧設定は選択式へ互換補完、バックアップに新項目と500問を保持',()=>{
  assert.equal(sanitizeSettings({}).answerMode,'choices');assert.equal(sanitizeSettings({answerMode:'recall',recognitionMode:'off'}).answerMode,'recall');
  const records=packRecords(pack);const backup=fullBackup({decks:[records.deck],questions:records.questions,settings:sanitizeSettings(),stats:{},sessions:[]});assert.equal(validateBackup(backup).questions.length,500);
  const broken=structuredClone(backup);broken.questions[0].choices=[{}];assert.throws(()=>validateBackup(broken));
});
test('PWA識別子と起動URLはMEMORY BEAT専用の範囲',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8')),origin='https://yuuuh26.github.io';
  const id=new URL(manifest.id,origin+'/');assert.equal(id.pathname,'/memory-beat/');assert.notEqual(id.pathname,'/');
  const start=new URL(manifest.start_url,origin+'/memory-beat/manifest.webmanifest');assert(start.pathname.startsWith('/memory-beat/'));assert.equal(new URL(manifest.scope,origin+'/').pathname,'/memory-beat/');
});
test('更新ボタンは新SWのinstall完了を待ち、反映後だけ終了する',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),bus=new EventTarget(),worker=new EventTarget();worker.state='installing';let activated=false;
  Object.defineProperty(globalThis,'navigator',{value:{serviceWorker:bus},configurable:true});
  const registration={installing:worker,waiting:null,update:async()=>setTimeout(()=>{worker.state='installed';registration.waiting={postMessage(message){assert.equal(message.type,'SKIP_WAITING');activated=true;queueMicrotask(()=>bus.dispatchEvent(new Event('controllerchange')));}};worker.dispatchEvent(new Event('statechange'));},0)};
  try{assert.equal(await activateUpdate(registration),true);assert(activated);}finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
test('更新なしは再起動せず、インストール失敗を明示する',async()=>{
  assert.equal(await activateUpdate({update:async()=>{},waiting:null}),false);
  const worker=new EventTarget();worker.state='installing';const registration={installing:worker,update:async()=>setTimeout(()=>{worker.state='redundant';worker.dispatchEvent(new Event('statechange'));},0)};
  await assert.rejects(()=>activateUpdate(registration),/更新ファイル/);
});
