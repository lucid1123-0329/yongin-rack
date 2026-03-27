/**
 * sw-register.js — Service Worker 등록
 * controllerchange 자동 reload 제거 — 업데이트는 version-check.js가 직접 처리
 */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function () {});
}
