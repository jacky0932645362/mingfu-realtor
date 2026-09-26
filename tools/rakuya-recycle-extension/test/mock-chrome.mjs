/**
 * 最小可用的 chrome.storage.local 假實作，給 Node 測 lib/store.js 用——外掛實際跑在
 * 瀏覽器裡才有真的 chrome.* 全域物件，node 測試環境裡本來就沒有，用這個記憶體版頂著。
 */
export function installMockChrome() {
  const data = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key == null ? { ...data } : { [key]: data[key] }),
        set: async (obj) => Object.assign(data, obj),
      },
    },
  };
  return { data, reset: () => { for (const k of Object.keys(data)) delete data[k]; } };
}
