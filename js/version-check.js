/**
 * version-check.js — 앱 버전 자동 감지 + 강제 새로고침
 *
 * 매 페이지 로드 시 version.json을 캐시 우회로 fetch하여
 * 로컬 저장 버전과 비교. 다르면 SW 캐시 삭제 후 강제 새로고침.
 * 견적 작성 중(items 존재)이면 새로고침 스킵.
 */
(function () {
  const VERSION_KEY = 'yr_app_version';
  const VERSION_URL = '/version.json';

  async function checkVersion() {
    try {
      const resp = await fetch(VERSION_URL + '?t=' + Date.now(), {
        cache: 'no-store',
      });
      if (!resp.ok) return;

      const data = await resp.json();
      const remoteVersion = data.version;
      const localVersion = localStorage.getItem(VERSION_KEY);

      // 최초 방문 — 버전만 저장
      if (!localVersion) {
        localStorage.setItem(VERSION_KEY, remoteVersion);
        return;
      }

      // 같으면 패스
      if (localVersion === remoteVersion) return;

      // 견적 작성 중이면 스킵 (index.html에서 카트에 아이템이 있을 때)
      const cartData = localStorage.getItem('yr_cart_items');
      if (cartData) {
        try {
          const cart = JSON.parse(cartData);
          if (Array.isArray(cart) && cart.length > 0) {
            console.log('[VersionCheck] 업데이트 감지했으나 견적 작성 중이라 스킵');
            return;
          }
        } catch {}
      }

      console.log(`[VersionCheck] ${localVersion} → ${remoteVersion} 업데이트 감지`);

      // 버전 저장 (새로고침 후 다시 트리거되지 않도록)
      localStorage.setItem(VERSION_KEY, remoteVersion);

      // SW 캐시 전체 삭제
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        console.log('[VersionCheck] SW 캐시 삭제 완료');
      }

      // SW 등록 해제 후 재등록 유도
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
        console.log('[VersionCheck] SW 등록 해제 완료');
      }

      // 강제 새로고침
      location.reload(true);
    } catch (e) {
      // 오프라인 등 실패 시 조용히 무시
      console.log('[VersionCheck] 체크 실패 (오프라인?)', e.message);
    }
  }

  // DOM 로드 후 실행 (렌더링 차단 방지)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkVersion);
  } else {
    checkVersion();
  }
})();
