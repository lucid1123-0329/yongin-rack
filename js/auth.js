/**
 * auth.js — PIN 인증 모듈
 * 서버에서 PIN 확인 후 최대 6시간 유효한 세션 토큰 사용.
 * PIN과 PIN 해시는 브라우저에 저장하지 않는다.
 */

const Auth = (() => {
  const SESSION_KEY = 'yr_authenticated';
  const PIN_HASH_KEY = 'yr_pin_hash';
  const PIN_SALT_KEY = 'yr_pin_salt';
  const ONBOARDING_KEY = 'yr_onboarding_done';
  const ATTEMPT_KEY = 'yr_pin_attempts';
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 900000; // 서버와 동일하게 15분 잠금

  function isAuthenticated() {
    return !!sessionStorage.getItem('yr_auth_token') && Number(sessionStorage.getItem('yr_auth_expires')) > Date.now();
  }

  function hasPinSet() {
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
  }

  // 시도 횟수 확인 — 잠금 상태면 남은 초 반환, 아니면 0
  function getLockoutRemaining() {
    try {
      const data = JSON.parse(localStorage.getItem(ATTEMPT_KEY) || '{}');
      if (data.count >= MAX_ATTEMPTS && data.ts) {
        const remaining = LOCKOUT_MS - (Date.now() - data.ts);
        if (remaining > 0) return Math.ceil(remaining / 1000);
        // 잠금 해제
        localStorage.removeItem(ATTEMPT_KEY);
      }
    } catch {}
    return 0;
  }

  function recordFailedAttempt() {
    try {
      const data = JSON.parse(localStorage.getItem(ATTEMPT_KEY) || '{}');
      const count = (data.count || 0) + 1;
      localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ count, ts: Date.now() }));
    } catch {}
  }

  function resetAttempts() {
    localStorage.removeItem(ATTEMPT_KEY);
  }

  // 서버 확인이 끝난 뒤에만 새 세션으로 변경.
  async function setPin(pin) {
    const result = await API.request('POST', { action: 'changePin', pin });
    acceptSession(result);
  }

  function acceptSession(result) {
    if (!result?.token || !result.expiresAt) throw new Error('로그인 응답을 확인할 수 없습니다. 서버 배포 버전을 확인하세요.');
    sessionStorage.setItem('yr_auth_token', result.token);
    sessionStorage.setItem('yr_auth_expires', String(result.expiresAt));
    localStorage.setItem(ONBOARDING_KEY, 'true');
    localStorage.removeItem(PIN_HASH_KEY);
    localStorage.removeItem(PIN_SALT_KEY);
    resetAttempts();
  }
  // 이전 버전이 저장했던 재사용 가능한 인증 정보를 즉시 제거한다.
  localStorage.removeItem(PIN_HASH_KEY);
  localStorage.removeItem(PIN_SALT_KEY);
  sessionStorage.removeItem(SESSION_KEY);

  // PIN 검증 — 솔트 + 해시 비교 + 시도 횟수 제한
  async function verifyPin(pin) {
    // 잠금 확인
    const lockout = getLockoutRemaining();
    if (lockout > 0) return false;

    try {
      const result = await API.request('POST', { action: 'authenticate', pin }, { admin: false });
      acceptSession(result);
      return true;
    } catch (err) {
      if (err.code !== 'INVALID_PIN') throw err;
      recordFailedAttempt();
      return false;
    }
  }

  // 공개 가능한 브랜딩 및 초기 설정 여부만 확인.
  async function fetchServerPin() {
    try {
      const data = await API.request('GET', { action: 'getPublicSettings' }, { admin: false });
      if (data.settings) {
        // PIN + 솔트 동기화
        if (data.pinConfigured) {
          localStorage.setItem(ONBOARDING_KEY, 'true');
        }
        // 브랜딩 정보도 동기화
        syncBrandingFromSettings(data.settings);
        return !!data.pinConfigured;
      }
    } catch {}
    return false;
  }

  // 서버 설정에서 브랜딩 정보를 localStorage에 동기화
  function syncBrandingFromSettings(settings) {
    const branding = {
      company: settings.company || '',
      phone: settings.phone || '',
      bizNumber: settings.bizNumber || '',
      tagline: settings.tagline || '',
      adminEmail: settings.adminEmail || '',
      address: settings.address || '',
      representative: settings.representative || '',
      bizType: settings.bizType || '',
      bankAccount: settings.bankAccount || '',
    };
    // 값이 하나라도 있으면 저장
    if (branding.company || branding.phone) {
      localStorage.setItem('yr_branding', JSON.stringify(branding));
    }
  }

  // 인증 후 서버 설정 동기화 (브랜딩 + PIN)
  async function syncSettings() {
    try {
      const data = await API.getSettings();
      if (data.settings) {
        syncBrandingFromSettings(data.settings);
      }
    } catch {}
  }

  function completeOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, 'true');
  }

  function logout() {
    API.request('POST', { action: 'logout' }).catch(() => {});
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('yr_auth_token');
    sessionStorage.removeItem('yr_auth_expires');
  }

  /**
   * 페이지 진입 시 호출 — 인증 상태에 따라 리다이렉트
   * 로컬에 PIN이 없으면 서버에서 확인 후 처리
   */
  function guard(requireAuth = true) {
    if (!requireAuth) return true;

    if (isAuthenticated()) return true;

    showPinModal();
    return false;
  }

  function showPinModal() {
    if (document.getElementById('pin-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'pin-modal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 mx-4 w-full max-w-sm text-center">
        <div class="hidden"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>
        <h2 class="text-lg font-bold text-gray-800 mb-1">비밀번호를 입력하세요</h2>
        <p class="text-sm text-gray-500 mb-6">PIN 4자리 입력</p>
        <div class="flex justify-center gap-2 mb-6" id="pin-dots">
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
        </div>
        <p class="text-sm text-red-500 hidden mb-4" id="pin-error">비밀번호가 틀렸습니다</p>
        <div class="grid grid-cols-3 gap-2" id="pin-pad">
          ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(n =>
            n === '' ? '<div></div>' :
            `<button class="pin-key${n === '⌫' ? ' pin-key--del' : ''}" data-key="${n}" aria-label="${n === '⌫' ? '지우기' : n}">${n}</button>`
          ).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 인증 오버레이가 있으면 제거 (PIN 모달이 대체)
    var authOverlay = document.getElementById('auth-overlay');
    if (authOverlay) authOverlay.remove();

    let pin = '';
    let checking = false;
    const dots = modal.querySelectorAll('.pin-dot');
    const error = modal.querySelector('#pin-error');

    modal.querySelector('#pin-pad').addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn || checking) return;
      const key = btn.dataset.key;

      error.classList.add('hidden');

      if (key === '⌫') {
        pin = pin.slice(0, -1);
      } else if (pin.length < 4) {
        pin += key;
      }

      dots.forEach((dot, i) => {
        dot.classList.toggle('is-on', i < pin.length);
      });

      if (pin.length === 4) {
        // 잠금 확인
        const lockout = getLockoutRemaining();
        if (lockout > 0) {
          pin = '';
          dots.forEach(d => d.classList.remove('is-on'));
          error.textContent = `${lockout}초 후 다시 시도하세요`;
          error.classList.remove('hidden');
          return;
        }
        checking = true;
        let ok;
        try { ok = await verifyPin(pin); } catch (err) {
          error.textContent = err.message || '서버에 연결하지 못했습니다. 다시 시도하세요.';
          error.classList.remove('hidden');
          pin = '';
          dots.forEach(d => d.classList.remove('is-on'));
          return;
        } finally { checking = false; }
        if (ok) {
          modal.remove();
          await syncSettings(); // 브랜딩 동기화 후 화면을 연다.
          window.dispatchEvent(new Event('yr-authenticated'));
        } else {
          pin = '';
          dots.forEach(d => d.classList.remove('is-on'));
          const remaining = MAX_ATTEMPTS - (JSON.parse(localStorage.getItem(ATTEMPT_KEY) || '{}').count || 0);
          error.textContent = remaining > 0 ? `비밀번호가 틀렸습니다 (${remaining}회 남음)` : '15분간 잠금됩니다';
          error.classList.remove('hidden');
          modal.querySelector('.bg-white').classList.add('animate-shake');
          setTimeout(() => modal.querySelector('.bg-white').classList.remove('animate-shake'), 500);
        }
      }
    });
  }

  return {
    isAuthenticated, hasPinSet,
    setPin, verifyPin, completeOnboarding, logout,
    guard, showPinModal, fetchServerPin, syncSettings,
  };
})();
