/**
 * version-check.js — 앱 업데이트 매니저
 *
 * 업데이트 감지 시 토스트 알림을 표시하고, 사용자가 탭하면
 * SW 캐시 정리 후 1회 깔끔하게 새로고침.
 * 자동 새로고침은 하지 않음 (무한 루프 방지 + UX 개선).
 */
(function () {
  'use strict';

  var VERSION_KEY   = 'yr_app_version';
  var VERSION_URL   = '/version.json';
  var TOAST_ID      = 'yr-update-toast';

  // ── 업데이트 토스트 UI ─────────────────────────────
  function showUpdateToast() {
    if (document.getElementById(TOAST_ID)) return; // 이미 표시 중

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

    // 슬라이드업 애니메이션
    if (!document.getElementById('yr-toast-style')) {
      var style = document.createElement('style');
      style.id = 'yr-toast-style';
      style.textContent = '@keyframes yrSlideUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    document.getElementById('yr-update-btn').onclick = applyUpdate;
    document.getElementById('yr-update-close').onclick = function () {
      toast.remove();
    };
  }

  // ── 업데이트 적용 ─────────────────────────────────
  async function applyUpdate() {
    var btn = document.getElementById('yr-update-btn');
    if (btn) {
      btn.textContent = '적용 중…';
      btn.disabled = true;
    }

    // 1) SW 캐시 정리 (이전 버전 캐시 제거)
    if ('caches' in window) {
      try {
        var keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      } catch (e) { /* ignore */ }
    }

    // 2) 대기 중인 SW가 있으면 활성화 → controllerchange → reload
    if ('serviceWorker' in navigator) {
      try {
        var reg = await navigator.serviceWorker.ready;
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          // controllerchange 리스너가 reload 처리 — 2초 fallback
          setTimeout(function () { location.reload(); }, 2000);
          return;
        }
      } catch (e) { /* ignore */ }
    }

    // 3) 대기 중인 SW가 없으면 직접 reload
    location.reload();
  }

  // ── 버전 체크 (version.json 기반) ──────────────────
  async function checkVersion() {
    try {
      var resp = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) return;

      var data = await resp.json();
      var remoteVersion = data.version;
      var localVersion = localStorage.getItem(VERSION_KEY);

      // 최초 방문 — 버전만 저장
      if (!localVersion) {
        localStorage.setItem(VERSION_KEY, remoteVersion);
        return;
      }

      // 같으면 패스
      if (localVersion === remoteVersion) return;

      // 원격 버전이 로컬보다 낮으면 무시 (CDN 캐시 지연)
      if (Number(remoteVersion) < Number(localVersion)) return;

      console.log('[Update] ' + localVersion + ' → ' + remoteVersion + ' 감지');
      localStorage.setItem(VERSION_KEY, remoteVersion);
      showUpdateToast();
    } catch (e) {
      // 오프라인이면 무시
    }
  }

  // ── SW 업데이트 감지 ────────────────────────────────
  function watchServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.ready.then(function (reg) {
      // 이미 대기 중인 SW가 있으면 토스트 표시
      if (reg.waiting) {
        showUpdateToast();
        return;
      }

      // 새 SW 설치 감지
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

  // ── 초기화 ──────────────────────────────────────────
  function init() {
    checkVersion();
    watchServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
