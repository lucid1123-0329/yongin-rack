/**
 * sw-register.js — Service Worker 등록 + controllerchange 핸들러
 * 모든 HTML 페이지에서 공유. 업데이트 감지·토스트는 version-check.js에서 처리.
 */
if ('serviceWorker' in navigator) {
  var _yrHadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(function () {});
  var _yrRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    // 최초 설치(이전 컨트롤러 없음)나 이미 리프레시 중이면 무시
    if (!_yrHadController || _yrRefreshing) return;
    _yrRefreshing = true;
    location.reload();
  });
}
