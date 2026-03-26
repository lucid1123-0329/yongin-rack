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

  // __yr_reloadGuard는 각 HTML의 인라인 스크립트에서 정의됨
  var guard = window.__yr_reloadGuard;

  async function checkVersion() {
    try {
      // 새로고침 루프 방지: 30초 내 이미 새로고침 했으면 스킵
      if (guard && !guard.canReload()) {
        console.log('[VersionCheck] 쿨다운 중, 스킵');
        return;
      }

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

      // 원격 버전이 로컬보다 낮으면 무시 (CDN 캐시 지연)
      if (Number(remoteVersion) < Number(localVersion)) {
        console.log('[VersionCheck] 원격 버전이 낮음 (CDN 지연), 스킵');
        return;
      }

      // 견적 작성 중이면 스킵
      const cartData = localStorage.getItem('yr_draft_estimate');
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

      // 버전 저장 + 새로고침 타임스탬프 기록
      localStorage.setItem(VERSION_KEY, remoteVersion);
      guard && guard.markReload();

      // SW 캐시 전체 삭제 (SW 등록은 해제하지 않음 — 해제 시 재등록 루프 위험)
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        console.log('[VersionCheck] SW 캐시 삭제 완료');
      }

      // 강제 새로고침 (SW 업데이트는 reload 후 자동으로 진행됨)
      // 주의: reg.update() + location.reload() 동시 호출 시
      // controllerchange와 경쟁하여 무한 루프 발생 가능하므로 reload만 수행
      location.reload(true);
    } catch (e) {
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
