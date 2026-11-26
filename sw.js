/* Re: SeaRch Service Worker（build_pwa.py が自動生成） */
const VERSION = '141d25ac8c3b';
const CACHE = 're-search-' + VERSION;
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./features.js",
  "./app.js",
  "./data/data.json",
  "./data/img-1999.json",
  "./data/img-2001.json",
  "./data/img-2002.json",
  "./data/img-2003.json",
  "./data/img-2004.json",
  "./data/img-2005.json",
  "./data/img-2006.json",
  "./data/img-2007.json",
  "./data/img-2008.json",
  "./data/img-2009.json",
  "./data/img-2010.json",
  "./data/img-2011.json",
  "./data/img-2012.json",
  "./data/img-2013.json",
  "./data/img-2014.json",
  "./data/img-2015.json",
  "./data/img-2016.json",
  "./data/img-2017.json",
  "./data/img-2018.json",
  "./data/img-2019.json",
  "./data/img-2020.json",
  "./data/img-2021.json",
  "./data/img-2022.json",
  "./data/img-2023.json",
  "./data/img-2024.json",
  "./data/img-2025.json",
  "./data/polar.txt",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./manifest.webmanifest"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('re-search-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // 画面を開くときは、どのURLで開かれても index.html を返す
    if (req.mode === 'navigate') {
      const hit = await cache.match('./index.html');
      if (hit) return hit;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
