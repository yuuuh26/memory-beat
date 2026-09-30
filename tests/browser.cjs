const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const BASE = process.env.MEMORY_BEAT_TEST_URL || 'http://127.0.0.1:8765/memory-beat/';
(async () => {
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  const context = await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true,timezoneId:'Asia/Tokyo',acceptDownloads:true});
  const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  const go = async screen => page.locator(`[data-page="${screen}"]`).click();
  const getData = () => page.evaluate(async()=>{ const {loadData}=await import('./js/db.js'); return loadData(); });
  const putSettings = async extra => page.evaluate(async values=>{const {all,put}=await import('./js/db.js');const current=(await all('settings')).find(s=>s.id==='main')||{};await put('settings',{...current,...values,id:'main'});},extra);
  await page.goto(BASE); await page.locator('#sample-create').click(); await page.locator('#start-game').waitFor();
  await putSettings({speechEnabled:false,recognitionMode:'off',bgmVolume:0,seVolume:0}); await page.reload(); await page.locator('#start-game').waitFor();
  await page.screenshot({path:'/workspace/scratch/aff112d372ee/memory-beat-home.png',fullPage:true});
  assert.equal((await getData()).questions.length,6); console.log('PASS sample creation and reload');
  const map = Object.fromEntries((await getData()).questions.map(q=>[q.prompt,q.answer]));
  await page.locator('#start-game').click();
  for(let n=1;n<=6;n++) {
    await page.locator('#question-index').filter({hasText:`${n}問目`}).waitFor(); await page.waitForFunction(()=>document.querySelector('#recognized')?.textContent.includes('口頭'));
    if(n===1){await page.locator('#game-pause').click();const before=await page.locator('#time-fill').getAttribute('style');await page.waitForTimeout(650);assert.equal(await page.locator('#time-fill').getAttribute('style'),before);await page.locator('#game-resume').click();}
    if(n===2) await page.waitForTimeout(1800);
    if(n===3) await page.waitForTimeout(3500);
    if(n===5) await page.waitForTimeout(4700);
    else if(n===6){await page.locator('#reveal-answer').click();await page.locator('#manual-correct').click();}
    else {const prompt=await page.locator('#game-prompt').textContent();await page.locator('#typed-text').fill(n===4?'誤った回答':map[prompt]);await page.locator('#typed-submit').click();}
    await page.locator('#save-status').filter({hasText:'保存済み'}).waitFor();
    if(n===1) await page.screenshot({path:'/workspace/scratch/aff112d372ee/memory-beat-game.png',fullPage:true});
    await page.locator('#next-question').click();
  }
  await page.locator('#result-home').waitFor();
  let data=await getData();let s=data.sessions[0];assert.equal(s.answers.length,6); assert.equal(s.summary.PERFECT,2); assert.equal(s.summary.GREAT,1);assert.equal(s.summary.GOOD,1);assert.equal(s.summary.MISS,2);assert.equal(s.status,'completed');console.log('PASS grading, manual answer, timeout, pause, combo, session persistence');
  await page.locator('#result-home').click();await go('stats'); await page.screenshot({path:'/workspace/scratch/aff112d372ee/memory-beat-stats.png',fullPage:true});
  assert((await page.locator('#main').textContent()).includes('66.7')||(await page.locator('#main').textContent()).includes('67%')); await go('history'); await page.locator('[data-session]').first().click(); assert.equal(await page.locator('.answer-item').count(),6); await page.locator('#dialog-close').click();console.log('PASS daily stats and session snapshots');
  await page.locator('#new-deck').click();await page.locator('#deck-form [name="name"]').fill('検証デッキA');await page.locator('#deck-form button[type="submit"]').click();await go('editor');
  await page.locator('#add-question').click(); await page.locator('[name="prompt"]').fill('架空の合言葉');await page.locator('[name="answer"]').fill('コメット');await page.locator('#question-form summary').click();await page.locator('[name="acceptedAnswers"]').fill('こめっと|彗星');await page.locator('#question-form button[type="submit"]').click();
  await page.locator('#bulk-add').click();await page.locator('#bulk-text').fill('架空の色\tむらさき\t紫|パープル\t色のメモ\n架空の数字\t七\t7|なな\t数字のメモ');await page.locator('#bulk-preview').click();await page.locator('#bulk-save').click();
  data=await getData();const da=data.decks.find(d=>d.name==='検証デッキA');assert.equal(data.questions.filter(q=>q.deckId===da.id).length,3);console.log('PASS deck creation, question CRUD, TSV preview/import');
  await go('home');await page.locator('#start-game').click();await page.locator('#reveal-answer').waitFor();await page.locator('#reveal-answer').click();await page.locator('#manual-correct').click();await page.locator('#save-status').filter({hasText:'保存済み'}).waitFor();await page.locator('#game-end').click();await page.locator('#result-home').click();await go('editor');
  data=await getData();const originalSession=data.sessions.find(s=>s.deckId===da.id&&s.answers.length);const resultSnapshot=originalSession.answers[0];const answeredQuestion=data.questions.find(q=>q.id===resultSnapshot.questionId);
  await page.locator(`[data-edit="${answeredQuestion.id}"]`).click();await page.locator('[name="answer"]').fill('新しい架空の答え');await page.locator('#question-form button[type="submit"]').click();await page.locator('#reset-mastery').click();
  data=await getData();assert.equal(data.questions.find(q=>q.id===answeredQuestion.id).statVersion,2);assert.equal(data.sessions.find(s=>s.id===originalSession.id).answers[0].answerSnapshot,resultSnapshot.answerSnapshot);console.log('PASS answer revision and historical snapshot preservation');
  await page.locator('#new-deck').click();await page.locator('#deck-form [name="name"]').fill('検証デッキB');await page.locator('#deck-form button[type="submit"]').click();
  data=await getData();const db=data.decks.find(d=>d.name==='検証デッキB');await page.locator(`[data-deck="${da.id}"]`).click();await page.locator('#select-all').check();await page.locator('[data-bulk="copy"]').click();await page.locator('#target-deck').selectOption(db.id);await page.locator('#bulk-apply').click();
  data=await getData();assert.equal(data.questions.filter(q=>q.deckId===db.id).length,3);
  await page.locator('#select-all').check();await page.locator('[data-bulk="move"]').click();await page.locator('#target-deck').selectOption(db.id);await page.locator('#bulk-apply').click();data=await getData();assert.equal(data.questions.filter(q=>q.deckId===da.id).length,0);assert.equal(data.questions.filter(q=>q.deckId===db.id).length,6);console.log('PASS multiple selection, copy, move, deck separation');
  await page.locator(`[data-deck="${db.id}"]`).click();await page.locator('[data-select]').first().check();await page.locator('[data-bulk="disable"]').click();data=await getData();assert.equal(data.questions.filter(q=>q.enabled===false).length,1);
  await page.locator('[data-edit]').first().click();await page.locator('#delete-question').click();await page.locator('#confirm-question-delete').click();data=await getData();assert.equal(data.questions.filter(q=>q.deckId===db.id).length,5);console.log('PASS disable and confirmed deletion');
  await go('settings'); const savedBefore=await getData();
  const download=await Promise.all([page.waitForEvent('download'),page.locator('#export-backup').click()]);const backupPath='/workspace/scratch/aff112d372ee/qa-backup.json';await download[0].saveAs(backupPath); const backup=JSON.parse(fs.readFileSync(backupPath));assert.equal(backup.questions.length,11); assert(!('audio' in backup));
  await page.locator('#restore-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await page.waitForTimeout(300);assert.equal((await getData()).questions.length,savedBefore.questions.length);
  await page.locator('#restore-file').setInputFiles(backupPath);await page.locator('#restore-confirm').click();await page.waitForTimeout(300);assert.equal((await getData()).questions.length,savedBefore.questions.length);console.log('PASS backup round trip and invalid JSON data preservation');
  await page.locator('#recognition-mode').selectOption('remote');await page.locator('#consent-cancel').click();assert.notEqual((await getData()).settings[0].recognitionMode,'remote');await page.locator('#recognition-mode').selectOption('remote');await page.locator('#consent-remote').click();assert.equal((await getData()).settings[0].remoteConsent,true);await page.locator('#recognition-mode').selectOption('off');console.log('PASS explicit cloud-recognition consent');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();await page.locator('[data-page="settings"]').click();await context.setOffline(true);await page.reload();await page.locator('[data-page="home"]').click();await page.locator('#start-game').waitFor();assert.equal((await getData()).questions.length,11);await context.setOffline(false);console.log('PASS PWA offline restart and IndexedDB preservation');
  for (const size of [{width:360,height:740},{width:393,height:851},{width:1280,height:900}]) {await page.setViewportSize(size);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${size.width}`);}
  assert.deepEqual(errors,[]);console.log('PASS mobile/desktop layout and no browser exceptions');
  await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
