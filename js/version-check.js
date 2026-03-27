/**
 * version-check.js — 앱 업데이트 매니저
 *
 * 업데이트 감지 시 토스트 알림 표시 → 사용자 클릭 시 1회 새로고침.
 * controllerchange 리스너 없이 직접 reload하여 무한 루프 원천 차단.
 */
(function () {
  'use strict';

  var VERSION_KEY = 'yr_app_version';
  var VERSION_URL = '/version.json';
  var TOAST_ID    = 'yr-update-toast';
  var UPDATED_KEY = 'yr_just_updated'; // sessionStorage: reload 직후 토스트 억제

  // ── 토스트 표시 ────────────────────────────────────
  function showUpdateToast() {
    // 이미 표시 중이면 무시
    if (document.getElementById(TOAST_ID)) return;

    // 방금 업데이트 적용 직후면 표시 안 함
    if (sessionStorage.getItem(UPDATED_KEY)) return;

    var toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      'background:#1e3a5f', 'color:#fff', 'padding:12px 20px',
      'border-radius:12px', 'box-shadow:0 4px 20px rgba(0,0,0,.25)',
      'display:flex', 'align-items:center', 'gap:12px',
      'font-size:14px', 'z-index:99999', 'max-width:calc(100vw - 32px)',
      'animation:yrSlideUp .3s ease-out'
    ].join(';');

    toast.innerHTML =
      '<span style="flex:1">새 버전이 있습니다</span>' +
      '<button id="yr-update-btn" style="' +
        'background:#fff;color:#1e3a5f;border:none;padding:6px 16px;' +
        'border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap' +
      '">업데이트</button>' +
      '<button id="yr-update-close" style="' +
        'background:none;border:none;color:rgba(255,255,255,.6);font-size:18px;' +
        'cursor:pointer;padding:0 0 0 4px;line-height:1' +
      '">&times;</button>';

    if (!document.getElementById('yr-toast-style')) {
      var s = document.createElement('style');
      s.id = 'yr-toast-style';
      s.textContent = '@keyframes yrSlideUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
      document.head.appendChild(s);
    }

    document.body.appendChild(toast);
    document.getElementById('yr-update-btn').onclick = applyUpdate;
    document.getElementById('yr-update-close').onclick = function () { toast.remove(); };
  }

  // ── 업데이트 적용 ─────────────────────────────────
  async function applyUpdate() {
    // 토스트 즉시 제거 + 버튼 비활성화
    var toast = document.getElementById(TOAST_ID);
    if (toast) toast.remove();

    // reload 후 토스트 재표시 방지 플래그 (이 세션 동안 유지)
    sessionStorage.setItem(UPDATED_KEY, '1');

    // 대기 중인 SW 활성화
    try {
      var reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch (e) { /* ignore */ }

    // 1초 후 직접 reload (controllerchange에 의존하지 않음)
    setTimeout(function () { location.reload(); }, 1000);
  }

  // ── 버전 체크 ─────────────────────────────────────
  async function checkVersion() {
    try {
      var resp = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) return;
      var data = await resp.json();
      var remote = data.version;
      var local = localStorage.getItem(VERSION_KEY);

      if (!local) { localStorage.setItem(VERSION_KEY, remote); return; }
      if (local === remote) return;
      if (Number(remote) < Number(local)) return;

      console.log('[Update] ' + local + ' → ' + remote);
      localStorage.setItem(VERSION_KEY, remote);
      showUpdateToast();
    } catch (e) { /* offline */ }
  }

  // ── SW 대기 감지 ──────────────────────────────────
  function watchServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return;

      if (reg.waiting) { showUpdateToast(); return; }

      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });
    });
  }

  // ── 초기화 ────────────────────────────────────────
  function init() {
    // 업데이트 직후 세션이면 플래그 정리만 하고 토스트 억제
    if (sessionStorage.getItem(UPDATED_KEY)) {
      // 5초 후 플래그 제거 (다음 번 진짜 업데이트 감지 가능하도록)
      setTimeout(function () { sessionStorage.removeItem(UPDATED_KEY); }, 5000);
    }
    checkVersion();
    watchServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
