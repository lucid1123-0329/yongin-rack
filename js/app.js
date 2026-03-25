/**
 * app.js — 견적 계산 핵심 로직
 * 랙 선택 → 수량 → 옵션 → 실시간 금액 계산
 */

const App = (() => {
  let priceData = [];
  let selectedRack = null;
  let quantity = 1;
  let options = { delivery: false, assembly: false, demolition: false };

  const DRAFT_KEY = 'yr_draft_estimate';
  let draftTimer = null;

  // --- 단가 데이터 로드 ---
  async function loadPrices() {
    // 캐시에서 먼저 로드
    const cached = localStorage.getItem('yr_prices_cache');
    if (cached) {
      try {
        priceData = JSON.parse(cached);
        renderRackSelector();
      } catch {}
    }

    // 네트워크에서 최신 데이터 fetch
    try {
      const data = await API.getPrices();
      if (data && data.prices) {
        priceData = data.prices;
        localStorage.setItem('yr_prices_cache', JSON.stringify(priceData));
        renderRackSelector();
      }
    } catch (err) {
      if (!cached) {
        document.getElementById('price-area').innerHTML = UI.empty(
          '📡', '단가를 불러올 수 없습니다',
          '네트워크를 확인하고 다시 시도하세요.',
          '새로고침', 'javascript:location.reload()'
        );
      }
    }
  }

  // --- 랙 카테고리 추출 ---
  function getCategories() {
    const cats = [...new Set(priceData.map(p => p.type))];
    return cats;
  }

  function getSpecsForType(type) {
    return [...new Set(priceData.filter(p => p.type === type).map(p => p.spec))];
  }

  function getTiersForSpec(type, spec) {
    return priceData.filter(p => p.type === type && p.spec === spec);
  }

  // --- 렌더링 ---
  function renderRackSelector() {
    const container = document.getElementById('rack-selector');
    if (!container) return;

    const categories = getCategories();
    if (categories.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">등록된 랙이 없습니다</p>';
      return;
    }

    container.innerHTML = `
      <div class="mb-4">
        <label class="block text-sm font-semibold text-gray-600 mb-2">랙 종류</label>
        <select id="sel-type" class="w-full h-12 px-3 border-2 border-gray-200 rounded-lg text-base bg-white focus:border-[#1e3a5f] focus:outline-none">
          <option value="">선택하세요</option>
          ${categories.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="mb-4 hidden" id="spec-group">
        <label class="block text-sm font-semibold text-gray-600 mb-2">규격</label>
        <select id="sel-spec" class="w-full h-12 px-3 border-2 border-gray-200 rounded-lg text-base bg-white focus:border-[#1e3a5f] focus:outline-none">
          <option value="">선택하세요</option>
        </select>
      </div>
      <div class="mb-4 hidden" id="tier-group">
        <label class="block text-sm font-semibold text-gray-600 mb-2">단수</label>
        <select id="sel-tier" class="w-full h-12 px-3 border-2 border-gray-200 rounded-lg text-base bg-white focus:border-[#1e3a5f] focus:outline-none">
          <option value="">선택하세요</option>
        </select>
      </div>
    `;

    document.getElementById('sel-type').addEventListener('change', onTypeChange);
  }

  function onTypeChange(e) {
    const type = e.target.value;
    const specGroup = document.getElementById('spec-group');
    const tierGroup = document.getElementById('tier-group');

    if (!type) {
      specGroup.classList.add('hidden');
      tierGroup.classList.add('hidden');
      selectedRack = null;
      updateTotal();
      return;
    }

    const specs = getSpecsForType(type);
    const selSpec = document.getElementById('sel-spec');
    selSpec.innerHTML = `<option value="">선택하세요</option>` +
      specs.map(s => `<option value="${s}">${s}</option>`).join('');
    specGroup.classList.remove('hidden');
    tierGroup.classList.add('hidden');
    selectedRack = null;
    updateTotal();

    selSpec.onchange = (ev) => {
      const spec = ev.target.value;
      if (!spec) {
        tierGroup.classList.add('hidden');
        selectedRack = null;
        updateTotal();
        return;
      }
      const tiers = getTiersForSpec(type, spec);
      const selTier = document.getElementById('sel-tier');
      selTier.innerHTML = `<option value="">선택하세요</option>` +
        tiers.map(t => `<option value="${t.tier}">${t.tier}</option>`).join('');
      tierGroup.classList.remove('hidden');

      selTier.onchange = (ev2) => {
        const tier = ev2.target.value;
        selectedRack = tiers.find(t => t.tier === tier) || null;
        updateTotal();
        saveDraft();
      };
    };
  }

  // --- 수량 ---
  function setQuantity(q) {
    quantity = Math.max(1, Math.min(9999, parseInt(q) || 1));
    const input = document.getElementById('qty-input');
    if (input) input.value = quantity;
    updateTotal();
    saveDraft();
  }

  function changeQuantity(delta) {
    setQuantity(quantity + delta);
  }

  // --- 옵션 토글 ---
  function toggleOption(key) {
    options[key] = !options[key];
    updateTotal();
    saveDraft();
  }

  // --- 계산 ---
  function calculate() {
    if (!selectedRack) return { total: 0, breakdown: null };

    const unitPrice = Number(selectedRack.price) || 0;
    const installFee = Number(selectedRack.installFee) || 0;
    const subtotal = unitPrice * quantity;
    const totalInstall = installFee * quantity;

    // 옵션비 (단가표의 옵션 데이터 또는 고정값)
    let optionTotal = 0;
    // TODO: 옵션 단가를 단가표에서 관리

    const total = subtotal + totalInstall + optionTotal;

    return {
      total,
      breakdown: {
        rackType: selectedRack.type,
        spec: selectedRack.spec,
        tier: selectedRack.tier,
        unitPrice,
        quantity,
        subtotal,
        installFee,
        totalInstall,
        optionTotal,
        options: { ...options },
      }
    };
  }

  // --- 금액 표시 업데이트 ---
  function updateTotal() {
    const { total, breakdown } = calculate();
    const totalEl = document.getElementById('total-amount');
    const detailEl = document.getElementById('total-detail');
    const saveBtn = document.getElementById('btn-save');

    if (totalEl) {
      animateNumber(totalEl, total);
    }
    if (detailEl && breakdown) {
      detailEl.textContent = `${breakdown.rackType} ${breakdown.quantity}대 × ${UI.formatNumber(breakdown.unitPrice)}원 + 시공비 ${UI.formatNumber(breakdown.totalInstall)}원`;
    } else if (detailEl) {
      detailEl.textContent = '랙을 선택하세요';
    }
    if (saveBtn) {
      saveBtn.disabled = !breakdown;
    }
  }

  function animateNumber(el, target) {
    const current = parseInt(el.textContent.replace(/[^0-9]/g, '')) || 0;
    if (current === target) {
      el.textContent = UI.formatCurrency(target);
      return;
    }
    const duration = 300;
    const start = performance.now();
    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out
      const value = Math.round(current + (target - current) * eased);
      el.textContent = UI.formatCurrency(value);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // --- 폼 상태 localStorage 임시 저장 ---
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const draft = {
        selectedRack,
        quantity,
        options,
        customer: getCustomerInfo(),
        timestamp: Date.now(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 1000);
  }

  function loadDraft() {
    try {
      const data = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (data && Date.now() - data.timestamp < 86400000) { // 24시간 이내
        return data;
      }
    } catch {}
    return null;
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
  }

  // --- 고객 정보 ---
  function getCustomerInfo() {
    return {
      name: document.getElementById('cust-name')?.value || '',
      company: document.getElementById('cust-company')?.value || '',
      phone: document.getElementById('cust-phone')?.value || '',
      address: document.getElementById('cust-address')?.value || '',
    };
  }

  // --- 견적 저장 ---
  async function saveEstimate() {
    const { total, breakdown } = calculate();
    if (!breakdown) {
      UI.toast('랙을 선택하세요', 'warning');
      return null;
    }

    const customer = getCustomerInfo();
    const data = {
      ...breakdown,
      ...customer,
      total,
      date: new Date().toISOString(),
    };

    const result = await API.saveEstimate(data);
    clearDraft();
    return result;
  }

  return {
    loadPrices, setQuantity, changeQuantity, toggleOption,
    calculate, updateTotal, saveEstimate,
    loadDraft, clearDraft, getCustomerInfo,
    get priceData() { return priceData; },
    get selectedRack() { return selectedRack; },
    get quantity() { return quantity; },
    get options() { return options; },
  };
})();
