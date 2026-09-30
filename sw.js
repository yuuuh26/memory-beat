// 公開したアプリ本体を変更したら必ずVERSIONを増やす。
const VERSION = '1.1.0';
const PREFIX = 'yuu-memory-beat-app-';
const CACHE = PREFIX + VERSION;
const ASSETS = ['.', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'js/app.js', 'js/config.js', 'js/core.js', 'js/db.js', 'js/utils.js', 'js/game.js', 'js/speech.js', 'js/audio.js', 'js/effects.js', 'js/stats.js', 'js/charts.js', 'js/editor.js', 'js/backup.js', 'js/packs.js', 'data/toeic.json', 'js/pwa.js', 'update.html'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  // 同じGitHub Pagesオリジンの他アプリのキャッシュは消さない。
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // 未登録のユーザーデータ・バックアップ等をキャッシュに追加しない。
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { cacheName: CACHE, ignoreSearch: false });
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (error) { if (event.request.mode === 'navigate') return (await caches.open(CACHE)).match('index.html'); throw error; }
  })());
});
