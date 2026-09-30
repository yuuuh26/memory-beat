import { DB_NAME, DB_VERSION } from './config.js';
export const STORES = ['settings', 'decks', 'questions', 'stats', 'sessions', 'audio', 'meta'];
let connection;
export async function openDB() {
  if (connection) return connection;
  connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // 非破壊migration。将来の追加はoldVersionに応じてこの中で実行。
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = null; }; resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別のタブを閉じてから再読み込みしてください'));
  });
  return connection;
}
export async function all(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
// 複数storeの変更を1 transactionへ。失敗時は全変更がロールバックされる。
export async function write(operations) {
  if (!operations.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...new Set(operations.map(o => o.store))], 'readwrite');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存が中断されました'));
    try {
      for (const op of operations) {
        const store = tx.objectStore(op.store);
        if (op.type === 'delete') store.delete(op.id);
        else if (op.type === 'clear') store.clear();
        else store.put(op.value);
      }
    } catch (e) { tx.abort(); reject(e); }
  });
}
export const put = (store, value) => write([{ store, value }]);
export async function loadData() {
  const entries = await Promise.all(STORES.filter(s => s !== 'audio').map(async s => [s, await all(s)]));
  return Object.fromEntries(entries);
}
export async function storageState() {
  try { return { persistent: await navigator.storage?.persisted?.() || false, estimate: await navigator.storage?.estimate?.() }; }
  catch { return { persistent: false }; }
}
export async function requestPersistence() { try { return await navigator.storage?.persist?.() || false; } catch { return false; } }
// 設定画面の明示的な二段階確認からのみ呼ぶ。DBそのものは削除しない。
export const clearUserData = () => write(STORES.map(store => ({ store, type: 'clear' })));
