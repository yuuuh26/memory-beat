// キャッシュだけを更新する。IndexedDB・他アプリのキャッシュには触れない。
export async function activateUpdate(registration) {
  await registration.update();
  const worker = registration.installing;
  if (worker && worker.state !== 'installed') {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('更新の準備に時間がかかっています。少し待ってもう一度試してね')); }, 20000);
      const cleanup = () => { clearTimeout(timeout); worker.removeEventListener('statechange', changed); };
      const changed = () => {
        if (worker.state === 'installed') { cleanup(); resolve(); }
        else if (worker.state === 'redundant') { cleanup(); reject(new Error('更新ファイルを取得できませんでした。オンラインで再試行してね')); }
      };
      worker.addEventListener('statechange', changed); changed();
    });
  }
  if (!registration.waiting) return false;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('更新を反映できませんでした。アプリのタブを閉じて再度開いてね')); }, 10000);
    const changed = () => { clearTimeout(timeout); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  return true;
}
