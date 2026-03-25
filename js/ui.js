/**
 * ui.js — 공통 UI 컴포넌트
 * 토스트, 스켈레톤, 탭바, 모달, 로딩
 */

const UI = (() => {
  // --- 토스트 ---
  function toast(message, type = 'info', duration = 3000) {
    const existing = document.querySelector('.yr-toast');
    if (existing) existing.remove();

    const colors = {
      info: 'bg-gray-800',
      success: 'bg-green-600',
      error: 'bg-red-500',
      warning: 'bg-amber-500',
    };

    const el = document.createElement('div');
    el.className = `yr-toast fixed bottom-20 left-4 right-4 ${colors[type]} text-white px-4 py-3 rounded-lg text-sm font-medium z-50 text-center transition-all duration-300 translate-y-4 opacity-0`;
    el.textContent = message;
    document.body.appendChild(el);

    requestAnimationFrame(() => {
      el.classList.remove('translate-y-4', 'opacity-0');
    });

    setTimeout(() => {
      el.classList.add('translate-y-4', 'opacity-0');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  // --- 로딩 버튼 ---
  function setLoading(btn, loading) {
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.innerHTML = `<svg class="animate-spin h-5 w-5 mx-auto" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>`;
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '';
    }
  }

  // --- 스켈레톤 ---
  function skeleton(count = 3) {
    return Array.from({ length: count }, () =>
      `<div class="animate-pulse bg-white rounded-xl border border-gray-100 p-4 mb-3">
        <div class="h-4 bg-gray-200 rounded w-3/4 mb-3"></div>
        <div class="h-3 bg-gray-200 rounded w-1/2 mb-2"></div>
        <div class="h-3 bg-gray-200 rounded w-1/3"></div>
      </div>`
    ).join('');
  }

  // --- 빈 상태 ---
  function empty(icon, title, description, actionText, actionHref) {
    return `
      <div class="text-center py-12 px-6">
        <div class="text-5xl mb-4">${icon}</div>
        <h3 class="text-lg font-bold text-gray-700 mb-2">${title}</h3>
        <p class="text-sm text-gray-500 mb-6">${description}</p>
        ${actionText ? `<a href="${actionHref}" class="inline-block bg-[#1e3a5f] text-white px-6 py-3 rounded-xl font-bold text-sm">${actionText}</a>` : ''}
      </div>
    `;
  }

  // --- 확인 모달 ---
  function confirm(title, message, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl p-6 mx-4 w-full max-w-sm">
        <h3 class="text-lg font-bold text-gray-800 mb-2">${title}</h3>
        <p class="text-sm text-gray-600 mb-6">${message}</p>
        <div class="flex gap-3">
          <button class="flex-1 h-12 rounded-xl border border-gray-300 font-bold text-gray-600" id="modal-cancel">취소</button>
          <button class="flex-1 h-12 rounded-xl bg-[#1e3a5f] text-white font-bold" id="modal-confirm">확인</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#modal-cancel').onclick = () => modal.remove();
    modal.querySelector('#modal-confirm').onclick = () => {
      modal.remove();
      onConfirm();
    };
  }

  // --- 숫자 포맷 ---
  function formatNumber(n) {
    return Number(n).toLocaleString('ko-KR');
  }

  function formatCurrency(n) {
    return formatNumber(n) + '원';
  }

  // --- 날짜 포맷 ---
  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  // --- 하단 탭바 렌더 ---
  function renderTabBar(active) {
    const tabs = [
      { id: 'estimate', icon: '📝', label: '새 견적', href: 'index.html' },
      { id: 'history', icon: '📋', label: '이력', href: 'history.html' },
      { id: 'dashboard', icon: '📊', label: '대시보드', href: 'dashboard.html' },
      { id: 'more', icon: '⚙️', label: '더보기', href: 'more.html' },
    ];

    const bar = document.createElement('nav');
    bar.className = 'fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-40';
    bar.style.paddingBottom = 'env(safe-area-inset-bottom)';
    bar.innerHTML = tabs.map(t => `
      <a href="${t.href}" class="flex-1 py-2 flex flex-col items-center gap-0.5 ${t.id === active ? 'text-[#1e3a5f] font-bold' : 'text-gray-400'}">
        <span class="text-xl">${t.icon}</span>
        <span class="text-[11px]">${t.label}</span>
      </a>
    `).join('');
    document.body.appendChild(bar);
  }

  // --- 헤더 렌더 ---
  function renderHeader(title, showBack = false) {
    return `
      <header class="bg-[#1e3a5f] text-white px-4 py-4 flex items-center gap-3">
        ${showBack ? '<a href="javascript:history.back()" class="text-xl">←</a>' : ''}
        <h1 class="text-lg font-bold flex-1">${title}</h1>
      </header>
    `;
  }

  // --- 상태 배지 ---
  function statusBadge(status) {
    const map = {
      '상담완료': 'bg-blue-100 text-blue-700',
      '계약': 'bg-orange-100 text-orange-700',
      '시공중': 'bg-amber-100 text-amber-700',
      '시공완료': 'bg-green-100 text-green-700',
    };
    const cls = map[status] || 'bg-gray-100 text-gray-600';
    return `<span class="px-2 py-0.5 rounded-full text-xs font-bold ${cls}">${status}</span>`;
  }

  return {
    toast, setLoading, skeleton, empty, confirm,
    formatNumber, formatCurrency, formatDate,
    renderTabBar, renderHeader, statusBadge,
  };
})();
