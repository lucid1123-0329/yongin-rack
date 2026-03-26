/**
 * sw.js — Service Worker
 * 정적 자산 캐시 + 단가표 Stale-While-Revalidate + OneSignal 푸시
 */
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const CACHE_NAME = 'yr-v51';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/history.html',
  '/dashboard.html',
  '/more.html',
  '/admin.html',
  '/admin-push.html',
  '/settings.html',
  '/estimate-preview.html',
  '/view.html',
  '/request.html',
  '/requests.html',
  '/portfolio.html',
  '/portfolio-public.html',
  '/js/api.js',
  '/js/auth.js',
  '/js/ui.js',
  '/js/app.js',
  '/js/estimate.js',
  '/js/onesignal-init.js',
  '/OneSignalSDKWorker.js',
  '/manifest.json',
];

// Install — 정적 자산 프리캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // 일부 실패해도 설치 진행
      });
    })
  );
  self.skipWaiting();
});

// 클라이언트에서 SKIP_WAITING 메시지 수신 시 즉시 활성화
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate — 이전 캐시 제거 (with logging)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const oldKeys = keys.filter(k => k !== CACHE_NAME);
      if (oldKeys.length > 0) {
        console.log(`[SW] Cleaning up ${oldKeys.length} old cache(s):`, oldKeys.join(', '));
      } else {
        console.log(`[SW] Activated ${CACHE_NAME}, no old caches to remove.`);
      }
      return Promise.all(oldKeys.map(k => caches.delete(k)));
    })
  );
  self.clients.claim();
});

// Fetch — 전략 분기
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // POST 요청은 네트워크만 사용 (GAS 쓰기)
  if (event.request.method !== 'GET') return;

  // GAS 요청 (script.google.com)은 passthrough — redirect 체인 문제
  if (url.hostname.includes('google') || url.hostname.includes('googleapis')) return;

  // 외부 CDN (tailwind, pretendard, html2canvas) — cache-first
  if (url.hostname !== location.hostname) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // 내부 정적 자산 — stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
