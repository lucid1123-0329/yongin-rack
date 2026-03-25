/**
 * auth.js — PIN 인증 모듈
 * SHA-256 해시 기반 클라이언트 인증
 */

const Auth = (() => {
  const SESSION_KEY = 'yr_authenticated';
  const PIN_HASH_KEY = 'yr_pin_hash';
  const ONBOARDING_KEY = 'yr_onboarding_done';

  async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function isAuthenticated() {
    return sessionStorage.getItem(SESSION_KEY) === 'true';
  }

  function isOnboardingDone() {
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
  }

  function hasPinSet() {
    return !!localStorage.getItem(PIN_HASH_KEY);
  }

  async function setPin(pin) {
    const hash = await sha256(pin);
    localStorage.setItem(PIN_HASH_KEY, hash);
  }

  async function verifyPin(pin) {
    const hash = await sha256(pin);
    const stored = localStorage.getItem(PIN_HASH_KEY);
    if (hash === stored) {
      sessionStorage.setItem(SESSION_KEY, 'true');
      return true;
    }
    return false;
  }

  function completeOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, 'true');
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  /**
   * 페이지 진입 시 호출 — 인증 상태에 따라 리다이렉트
   * @param {boolean} requireAuth - true면 미인증 시 PIN 화면으로
   */
  function guard(requireAuth = true) {
    if (!requireAuth) return true;
    if (!hasPinSet() || !isOnboardingDone()) {
      window.location.href = 'settings.html?setup=1';
      return false;
    }
    if (!isAuthenticated()) {
      showPinModal();
      return false;
    }
    return true;
  }

  function showPinModal() {
    if (document.getElementById('pin-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'pin-modal';
    modal.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 mx-4 w-full max-w-sm text-center">
        <div class="text-4xl mb-4">🔒</div>
        <h2 class="text-lg font-bold text-gray-800 mb-1">비밀번호를 입력하세요</h2>
        <p class="text-sm text-gray-500 mb-6">PIN 4자리 입력</p>
        <div class="flex justify-center gap-3 mb-6" id="pin-dots">
          <div class="w-12 h-12 border-2 border-gray-300 rounded-xl flex items-center justify-center text-2xl pin-dot"></div>
          <div class="w-12 h-12 border-2 border-gray-300 rounded-xl flex items-center justify-center text-2xl pin-dot"></div>
          <div class="w-12 h-12 border-2 border-gray-300 rounded-xl flex items-center justify-center text-2xl pin-dot"></div>
          <div class="w-12 h-12 border-2 border-gray-300 rounded-xl flex items-center justify-center text-2xl pin-dot"></div>
        </div>
        <p class="text-sm text-red-500 hidden mb-4" id="pin-error">비밀번호가 틀렸습니다</p>
        <div class="grid grid-cols-3 gap-3" id="pin-pad">
          ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(n =>
            n === '' ? '<div></div>' :
            `<button class="h-14 rounded-xl text-xl font-bold ${n === '⌫' ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-800 active:bg-[#1e3a5f] active:text-white'} transition-colors" data-key="${n}">${n}</button>`
          ).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let pin = '';
    const dots = modal.querySelectorAll('.pin-dot');
    const error = modal.querySelector('#pin-error');

    modal.querySelector('#pin-pad').addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const key = btn.dataset.key;

      error.classList.add('hidden');

      if (key === '⌫') {
        pin = pin.slice(0, -1);
      } else if (pin.length < 4) {
        pin += key;
      }

      dots.forEach((dot, i) => {
        if (i < pin.length) {
          dot.textContent = '●';
          dot.classList.add('border-[#1e3a5f]', 'bg-blue-50');
        } else {
          dot.textContent = '';
          dot.classList.remove('border-[#1e3a5f]', 'bg-blue-50');
        }
      });

      if (pin.length === 4) {
        const ok = await verifyPin(pin);
        if (ok) {
          modal.remove();
          window.dispatchEvent(new Event('yr-authenticated'));
        } else {
          pin = '';
          dots.forEach(d => {
            d.textContent = '';
            d.classList.remove('border-[#1e3a5f]', 'bg-blue-50');
          });
          error.classList.remove('hidden');
          modal.querySelector('.bg-white').classList.add('animate-shake');
          setTimeout(() => modal.querySelector('.bg-white').classList.remove('animate-shake'), 500);
        }
      }
    });
  }

  return {
    isAuthenticated, isOnboardingDone, hasPinSet,
    setPin, verifyPin, completeOnboarding, logout,
    guard, showPinModal,
  };
})();
