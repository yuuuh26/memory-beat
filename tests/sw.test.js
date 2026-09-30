import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function harness(offline=false) {
  const handlers={},removed=[],assets=[]; const index={marker:'cached-index'};
  const self={location:{origin:'https://example.test'},registration:{scope:'https://example.test/memory-beat/'},clients:{claim:async()=>{}},addEventListener:(type,handler)=>handlers[type]=handler,skipWaiting:()=>{}};
  const caches={open:async()=>({addAll:async list=>assets.push(...list),match:async url=>url==='index.html'?index:undefined}),keys:async()=>['yuu-memory-beat-app-old','yuu-toeic-beat-app-old'],delete:async key=>removed.push(key),match:async request=>request.url.endsWith('styles.css')?{marker:'cached-css'}:undefined};
  vm.runInNewContext(source,{self,caches,URL,fetch:async()=>{if(offline)throw Error('offline');return {marker:'network'};}});
  const wait=async type=>{let promise;handlers[type]({waitUntil:p=>promise=p});await promise;};
  const request=async(url,mode='navigate')=>{let promise;handlers.fetch({request:{url,mode,method:'GET'},respondWith:p=>promise=p});return promise;};
  return {handlers,assets,removed,index,wait,request};
}
test('PWA installはHTML・全モジュール・アイコンをキャッシュ',async()=>{
 const h=harness();await h.wait('install');for(const p of ['index.html','styles.css','manifest.webmanifest','js/game.js','js/db.js','js/backup.js','icons/icon-512.png'])assert(h.assets.includes(p));
 for(const p of h.assets.filter(p=>p!=='.'))assert(fs.existsSync(new URL('../'+p,import.meta.url)),`missing ${p}`);
});
test('PWA更新は他アプリのキャッシュを保持',async()=>{const h=harness();await h.wait('activate');assert.deepEqual(h.removed,['yuu-memory-beat-app-old']);});
test('オフライン時のCSS再取得・ナビゲーションfallback',async()=>{const h=harness(true);assert.equal((await h.request('https://example.test/memory-beat/styles.css','style')).marker,'cached-css');assert.equal((await h.request('https://example.test/memory-beat/')).marker,'cached-index');});
test('別アプリ・外部リクエストをこのSWが扱わない',async()=>{const h=harness();assert.equal(await h.request('https://example.test/toeic-beat/'),undefined);assert.equal(await h.request('https://other.test/data'),undefined);});
