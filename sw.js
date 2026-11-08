// オフラインでも開けるようにする（画面のファイルだけ保存。天気はネットから）
// 更新したら VERSION を変えると、次に開いたときに新しいファイルへ入れ替わります
const VERSION = 'deban-v14';
const FILES = ['./', 'index.html', 'logic.js', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 同じサイトのファイル：ネットを先に試し、つながらなければ保存しておいたものを使う
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // このアプリのファイルだけ扱う（同じリポジトリの nokin/ などには手を出さない）
  const base = new URL('./', location.href).pathname;
  const rel = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : null;
  if (rel === null || (rel !== '' && !FILES.includes(rel))) return;
  e.respondWith(
    // ブラウザに残っている古いファイルを使わず、必ずサーバーに新しい版があるか確認する
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
