/**
 * ui.js — 공통 UI 컴포넌트
 * 토스트, 스켈레톤, 탭바, 모달, 로딩
 */

const UI = (() => {
  // --- 토스트 ---
  const TOAST_ENTER_CLS = ['is-entering'];
  const TOAST_COLORS = {
    info: 'toast-info',
    success: 'toast-success',
    error: 'toast-error',
    warning: 'toast-warning',
  };

  function toast(message, type = 'info', duration = 3000) {
    const existing = document.querySelector('.yr-toast');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = `yr-toast fixed ${TOAST_COLORS[type] || TOAST_COLORS.info} px-4 py-3 rounded-full text-sm font-medium z-[60] transition-all duration-300 ${TOAST_ENTER_CLS.join(' ')}`;
    el.textContent = message;
    document.body.appendChild(el);

    requestAnimationFrame(() => {
      el.classList.remove(...TOAST_ENTER_CLS);
    });

    setTimeout(() => {
      el.classList.add(...TOAST_ENTER_CLS);
      setTimeout(() => el.remove(), 200);
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
      `<div class="v2-list-skeleton animate-pulse bg-white rounded-2xl p-4 mb-3">
        <div class="skeleton-block h-4 bg-gray-200 rounded-lg w-3/4 mb-3"></div>
        <div class="skeleton-block h-3 bg-gray-200 rounded-lg w-1/2 mb-2"></div>
        <div class="skeleton-block h-3 bg-gray-200 rounded-lg w-1/3"></div>
      </div>`
    ).join('');
  }

  // --- 빈 상태 ---
  function empty(icon, title, description, actionText, actionHref, actionHandler = '') {
    const action = actionText
      ? actionHandler
        ? `<button type="button" onclick="${actionHandler}" class="v2-state-action v2-state-action--fill">${actionText}</button>`
        : `<a href="${actionHref}" class="v2-state-action btn-like">${actionText}</a>`
      : '';
    return `
      <div class="v2-state-card text-center min-h-[200px] py-12 px-6 flex flex-col items-center justify-center">
        <div class="v2-empty-marker text-[0px]">${icon}</div>
        <h3 class="text-lg font-bold text-gray-700 mb-2">${title}</h3>
        <p class="text-sm text-gray-500 mb-6">${description}</p>
        ${action}
      </div>
    `;
  }

  // --- 확인 모달 ---
  function confirm(title, message, onConfirm) {
    // Deduplication: remove any existing confirm modal before creating a new one
    const existingModal = document.querySelector('.yr-confirm-modal');
    if (existingModal) existingModal.remove();

    const isDanger = /삭제/.test(title);
    const modal = document.createElement('div');
    modal.className = 'yr-confirm-modal fixed inset-0 bg-black/50 z-50 flex items-end justify-center';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="yr-confirm-sheet ${isDanger ? 'is-danger' : ''} bg-white w-full max-w-lg">
        <div class="yr-sheet-handle" aria-hidden="true"></div>
        <h3 class="text-lg font-bold text-gray-800 mb-2">${title}</h3>
        <p class="text-sm text-gray-600 mb-6">${message}</p>
        <div class="yr-confirm-actions flex gap-2">
          <button class="flex-1 rounded-xl border-0 bg-gray-100 font-bold text-gray-600" id="modal-cancel">취소</button>
          <button class="flex-1 rounded-xl bg-primary text-white font-bold" id="modal-confirm">확인</button>
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

  // --- HTML 이스케이프 (XSS 방지) ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
      { id: 'estimate', label: '견적', href: 'index.html',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>' },
      { id: 'dashboard', label: '대시보드', href: 'dashboard.html',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>' },
      { id: 'requests', label: '요청', href: 'requests.html',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>' },
      { id: 'portfolio', label: '사진', href: 'portfolio.html', hidden: true,
        svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>' },
      { id: 'cases', label: '시공 사례', href: 'cases.html',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 3h7l5 5v13H7z"/><path stroke-linecap="round" stroke-linejoin="round" d="M14 3v5h5M10 14l2 2 4-4"/></svg>' },
      { id: 'more', label: '더보기', href: 'more.html',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>' },
    ];

    const bar = document.createElement('nav');
    bar.className = 'fixed bottom-0 left-0 right-0 h-20 bg-white border-t-[1.5px] border-[#2F6BFF] flex z-40';
    bar.style.paddingBottom = 'env(safe-area-inset-bottom)';
    bar.innerHTML = tabs.filter(t => !t.hidden).map(t => `
      <a href="${t.href}" class="flex-1 py-2 flex flex-col items-center justify-center gap-1 ${t.id === active ? 'tab-active text-[#2F6BFF] font-bold' : 'text-gray-500'}">
        <span class="tab-icon-wrap relative">
          ${t.svg}
          ${t.id === 'requests' ? '<span id="req-badge" class="hidden absolute -top-2 -right-3 min-w-[20px] h-5 px-1 bg-[#FF6B00] text-white text-xs font-bold rounded-xl flex items-center justify-center"></span>' : ''}
        </span>
        <span class="text-xs ${t.id === active ? 'font-bold' : 'font-medium'}">${t.label}</span>
      </a>
    `).join('');
    document.body.appendChild(bar);

    // 미처리 요청 배지 자동 조회 (요청 페이지에서는 loadRequests가 직접 갱신)
    if (active !== 'requests') _fetchRequestBadge();
  }

  // 배지 숫자 DOM 업데이트
  function updateRequestBadge(count) {
    const badge = document.getElementById('req-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // 요청 페이지 진입 시 호출 — 현재 요청 수를 "확인한 수"로 저장
  function markRequestsSeen(totalCount) {
    localStorage.setItem('yr_req_seen', JSON.stringify({ total: totalCount, ts: Date.now() }));
    updateRequestBadge(0);
  }

  // 내부: 배지 조회 — "마지막 확인 이후 새로 들어온 요청 수" 표시
  function _fetchRequestBadge() {
    try {
      // 60초 내 재조회 방지
      var lastFetch = null;
      try { lastFetch = localStorage.getItem('yr_req_fetch_ts'); } catch(e) {}
      if (lastFetch && Date.now() - Number(lastFetch) < 60000) {
        // 캐시된 배지 값 표시
        try {
          var cachedBadge = localStorage.getItem('yr_req_badge_count');
          if (cachedBadge !== null) updateRequestBadge(Number(cachedBadge));
        } catch(e) {}
        return;
      }
      if (typeof API === 'undefined') return;
      API.getRequests({ silent: true }).then(function(data) {
        if (!data || !data.requests) return;
        var totalCount = data.requests.length;
        // 마지막 확인 시점의 요청 수
        var seenTotal = 0;
        try {
          var seen = localStorage.getItem('yr_req_seen');
          if (seen) seenTotal = JSON.parse(seen).total || 0;
        } catch(e) {}
        // 새 요청 수 = 현재 총 수 - 마지막 확인 시 총 수
        var newCount = Math.max(0, totalCount - seenTotal);
        updateRequestBadge(newCount);
        try {
          localStorage.setItem('yr_req_badge_count', String(newCount));
          localStorage.setItem('yr_req_fetch_ts', String(Date.now()));
        } catch(e) {}
      }).catch(function(err) {
        console.warn('Badge fetch failed:', err && err.message);
      });
    } catch(e) {
      console.warn('_fetchRequestBadge error:', e && e.message);
    }
  }

  // --- 헤더 렌더 ---
  function renderHeader(title, showBack = false) {
    return `
      <header class="yr-page-header bg-white text-[#2F6BFF] px-4 py-2 flex items-center gap-2">
        ${showBack ? '<a href="javascript:history.back()" class="w-14 h-14 text-xl flex items-center justify-center">←</a>' : ''}
        <h1 class="text-[22px] font-bold flex-1">${title}</h1>
      </header>
    `;
  }

  // --- 상태 배지 ---
  function statusBadge(status) {
    const map = {
      '상담완료': 'status-tone-ink',
      '계약': 'status-tone-accent',
      '시공중': 'status-tone-accent',
      '시공완료': 'status-tone-ok',
    };
    const cls = map[status] || 'status-tone-ink';
    return `<span class="status-badge inline-flex items-center px-2 py-1 rounded-xl border-0 border-[#2F6BFF] bg-white text-xs font-bold ${cls}">${status}</span>`;
  }

  // --- 숫자를 한글로 변환 ---
  function numberToKorean(n) {
    if (n === 0) return '영';
    const units = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
    const positions = ['', '십', '백', '천'];
    const bigUnits = ['', '만', '억', '조'];
    const num = Math.abs(Math.floor(n));
    const str = String(num);
    const len = str.length;
    let result = '';
    let bigIdx = 0;

    for (let i = len; i > 0; i -= 4) {
      const start = Math.max(0, i - 4);
      const chunk = str.substring(start, i);
      let chunkStr = '';
      for (let j = 0; j < chunk.length; j++) {
        const digit = Number(chunk[j]);
        const pos = chunk.length - 1 - j;
        if (digit === 0) continue;
        if (digit === 1 && pos > 0) {
          chunkStr += positions[pos];
        } else {
          chunkStr += units[digit] + positions[pos];
        }
      }
      if (chunkStr) result = chunkStr + bigUnits[bigIdx] + result;
      bigIdx++;
    }
    return (n < 0 ? '마이너스 ' : '') + result;
  }


  // 화살표를 칩 바깥에 배치해 터치 영역이 겹치지 않도록 한다.
  function enhanceScrollRow(el) {
    if (!el || el.dataset.scrollRow === '1') return;
    el.dataset.scrollRow = '1';
    var wrap = document.createElement('div');
    wrap.className = 'v2-scroll-row';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    var mk = function (dir) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'v2-scroll-row__btn is-hidden v2-scroll-row__btn--' + dir;
      b.disabled = true;
      b.setAttribute('aria-label', dir === 'left' ? '왼쪽으로 이동' : '오른쪽으로 이동');
      b.innerHTML = dir === 'left'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
      b.addEventListener('click', function (e) {
        e.preventDefault();
        el.scrollBy({ left: (dir === 'left' ? -1 : 1) * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
      });
      wrap.appendChild(b);
      return b;
    };
    var left = mk('left'), right = mk('right');
    var update = function () {
      var max = el.scrollWidth - el.clientWidth;
      var canL = el.scrollLeft > 4, canR = el.scrollLeft < max - 4;
      left.classList.toggle('is-hidden', !canL);
      right.classList.toggle('is-hidden', !canR);
      left.disabled = !canL;
      right.disabled = !canR;
      wrap.classList.toggle('can-left', canL);
      wrap.classList.toggle('can-right', canR);
      wrap.classList.toggle('is-scrollable', max > 4);
    };
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    if (window.MutationObserver) new MutationObserver(update).observe(el, { childList: true, subtree: true });
    if (window.ResizeObserver) new ResizeObserver(update).observe(el);
    setTimeout(update, 0);
    setTimeout(update, 400);
  }

  return {
    enhanceScrollRow,
    toast, setLoading, skeleton, empty, confirm,
    escapeHtml, formatNumber, formatCurrency, formatDate,
    renderTabBar, renderHeader, statusBadge, numberToKorean, updateRequestBadge, markRequestsSeen,
  };
})();
