/**
 * auth.js — PIN 인증 모듈
 * SHA-256 해시 기반 인증, PIN은 구글시트 설정에 저장
 * 새 기기에서 접속 시 서버에서 PIN 해시를 가져와 인증
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

  function hasPinSet() {
    return !!localStorage.getItem(PIN_HASH_KEY);
  }

  // PIN 설정 — localStorage + 서버(구글시트) 동시 저장
  async function setPin(pin) {
    const hash = await sha256(pin);
    localStorage.setItem(PIN_HASH_KEY, hash);
    localStorage.setItem(ONBOARDING_KEY, 'true');
    try {
      await API.saveSettings({ pinHash: hash });
    } catch {}
  }

  // PIN 검증 — localStorage의 해시와 비교
  async function verifyPin(pin) {
    const hash = await sha256(pin);
    const stored = localStorage.getItem(PIN_HASH_KEY);
    if (hash === stored) {
      sessionStorage.setItem(SESSION_KEY, 'true');
      return true;
    }
    return false;
  }

  // 서버에서 PIN 해시를 가져와 localStorage에 동기화
  async function fetchServerPin() {
    try {
      const data = await API.getSettings();
      if (data.settings) {
        // PIN 동기화
        if (data.settings.pinHash) {
          localStorage.setItem(PIN_HASH_KEY, data.settings.pinHash);
          localStorage.setItem(ONBOARDING_KEY, 'true');
        }
        // 브랜딩 정보도 동기화
        syncBrandingFromSettings(data.settings);
        return !!data.settings.pinHash;
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
        if (data.settings.pinHash) {
          localStorage.setItem(PIN_HASH_KEY, data.settings.pinHash);
        }
      }
    } catch {}
  }

  function completeOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, 'true');
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  /**
   * 페이지 진입 시 호출 — 인증 상태에 따라 리다이렉트
   * 로컬에 PIN이 없으면 서버에서 확인 후 처리
   */
  function guard(requireAuth = true) {
    if (!requireAuth) return true;

    if (isAuthenticated()) return true;

    if (hasPinSet()) {
      // 로컬에 PIN 있음 → PIN 입력 모달
      showPinModal();
      return false;
    }

    // 로컬에 PIN 없음 → 서버에서 확인
    fetchServerPin().then(found => {
      if (found) {
        // 서버에 PIN 있음 → PIN 입력 모달
        showPinModal();
      } else {
        // 서버에도 PIN 없음 → 최초 설정(온보딩)
        window.location.href = 'settings.html?setup=1';
      }
    });
    return false;
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
          syncSettings(); // 인증 후 서버 설정 동기화
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
    isAuthenticated, hasPinSet,
    setPin, verifyPin, completeOnboarding, logout,
    guard, showPinModal, fetchServerPin, syncSettings,
  };
})();
