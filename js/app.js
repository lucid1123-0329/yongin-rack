/**
 * app.js — 견적 계산 핵심 로직
 * 복수 품목 카트 방식 + 자유 항목(운송비, 설치비, 마진, D/C)
 * VAT: 공급가액 × 10% = 세액, 총액 = 공급가액 + 세액
 */

const App = (() => {
  let priceData = [];
  let items = [];           // 추가된 품목 배열 (rack + custom)
  let currentSelection = null;
  let currentQuantity = 1;

  const DRAFT_KEY = 'yr_draft_estimate';
  let draftTimer = null;

  // --- 단가 데이터 로드 ---
  async function loadPrices() {
    const cached = localStorage.getItem('yr_prices_cache');
    if (cached) {
      try {
        priceData = JSON.parse(cached);
        renderRackSelector();
      } catch {}
    }

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
    return [...new Set(priceData.map(p => p.type))];
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
      <div class="mb-3">
        <label class="block text-sm font-semibold text-gray-600 mb-2">랙 종류</label>
        <select id="sel-type" class="w-full h-12 px-3 border-2 border-gray-200 rounded-lg text-base bg-white focus:border-[#1e3a5f] focus:outline-none">
          <option value="">선택하세요</option>
          ${categories.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="mb-3 hidden" id="spec-group">
        <label class="block text-sm font-semibold text-gray-600 mb-2">규격</label>
        <select id="sel-spec" class="w-full h-12 px-3 border-2 border-gray-200 rounded-lg text-base bg-white focus:border-[#1e3a5f] focus:outline-none">
          <option value="">선택하세요</option>
        </select>
      </div>
      <div class="mb-3 hidden" id="tier-group">
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
    const addSection = document.getElementById('add-section');

    if (!type) {
      specGroup.classList.add('hidden');
      tierGroup.classList.add('hidden');
      if (addSection) addSection.classList.add('hidden');
      currentSelection = null;
      return;
    }

    const specs = getSpecsForType(type);
    const selSpec = document.getElementById('sel-spec');
    selSpec.innerHTML = `<option value="">선택하세요</option>` +
      specs.map(s => `<option value="${s}">${s}</option>`).join('');
    specGroup.classList.remove('hidden');
    tierGroup.classList.add('hidden');
    if (addSection) addSection.classList.add('hidden');
    currentSelection = null;

    selSpec.onchange = (ev) => {
      const spec = ev.target.value;
      if (!spec) {
        tierGroup.classList.add('hidden');
        if (addSection) addSection.classList.add('hidden');
        currentSelection = null;
        return;
      }
      const tiers = getTiersForSpec(type, spec);
      const selTier = document.getElementById('sel-tier');
      selTier.innerHTML = `<option value="">선택하세요</option>` +
        tiers.map(t => `<option value="${t.tier}">${t.tier}단</option>`).join('');
      tierGroup.classList.remove('hidden');

      selTier.onchange = (ev2) => {
        const tier = ev2.target.value;
        if (!tier) {
          if (addSection) addSection.classList.add('hidden');
          currentSelection = null;
          return;
        }
        currentSelection = tiers.find(t => String(t.tier) === String(tier)) || null;
        if (currentSelection && addSection) {
          addSection.classList.remove('hidden');
        }
      };
    };
  }

  // --- 수량 ---
  function setQuantity(q) {
    currentQuantity = Math.max(1, Math.min(9999, parseInt(q) || 1));
    const input = document.getElementById('qty-input');
    if (input) input.value = currentQuantity;
  }

  function changeQuantity(delta) {
    setQuantity(currentQuantity + delta);
  }

  // --- 랙 품목 추가 ---
  function addItem() {
    if (!currentSelection) {
      UI.toast('랙을 선택하세요', 'warning');
      return;
    }

    items.push({
      type: currentSelection.type,
      spec: currentSelection.spec,
      tier: currentSelection.tier,
      unitPrice: Number(currentSelection.unitPrice) || 0,
      installFee: Number(currentSelection.installFee) || 0,
      vat: currentSelection.vat || '별도',
      quantity: currentQuantity,
    });

    currentSelection = null;
    currentQuantity = 1;
    const selType = document.getElementById('sel-type');
    if (selType) selType.value = '';
    const specGroup = document.getElementById('spec-group');
    const tierGroup = document.getElementById('tier-group');
    const addSection = document.getElementById('add-section');
    if (specGroup) specGroup.classList.add('hidden');
    if (tierGroup) tierGroup.classList.add('hidden');
    if (addSection) addSection.classList.add('hidden');
    const qtyInput = document.getElementById('qty-input');
    if (qtyInput) qtyInput.value = 1;

    renderItems();
    updateTotal();
    saveDraft();
    UI.toast('품목이 추가되었습니다', 'success');
  }

  // --- 자유 항목 추가 ---
  function addCustomItem() {
    const nameEl = document.getElementById('custom-name');
    const priceEl = document.getElementById('custom-price');
    const qtyEl = document.getElementById('custom-qty');
    const name = (nameEl?.value || '').trim();
    const price = Number(priceEl?.value) || 0;
    const qty = Number(qtyEl?.value) || 1;

    if (!name) { UI.toast('항목명을 입력하세요', 'warning'); return; }
    if (price === 0) { UI.toast('금액을 입력하세요', 'warning'); return; }

    items.push({
      itemType: 'custom',
      name: name,
      unitPrice: price,
      installFee: 0,
      quantity: qty,
    });

    if (nameEl) nameEl.value = '';
    if (priceEl) priceEl.value = '';
    if (qtyEl) qtyEl.value = '1';

    renderItems();
    updateTotal();
    saveDraft();
    UI.toast(`'${name}' 추가됨`, 'success');
  }

  function hideAllPresetAreas() {
    const marginArea = document.getElementById('margin-area');
    const dcArea = document.getElementById('dc-area');
    if (marginArea) marginArea.classList.add('hidden');
    if (dcArea) dcArea.classList.add('hidden');
  }

  function addPresetItem(presetName) {
    const nameEl = document.getElementById('custom-name');
    const priceEl = document.getElementById('custom-price');
    const qtyEl = document.getElementById('custom-qty');

    // 먼저 모든 토글 영역 닫기
    hideAllPresetAreas();

    if (presetName === '마진') {
      const marginArea = document.getElementById('margin-area');
      const marginPctEl = document.getElementById('margin-pct');
      if (marginArea) {
        marginArea.classList.remove('hidden');
        if (marginPctEl) { marginPctEl.value = '25'; marginPctEl.focus(); }
        calcMarginFromPct();
      }
      return;
    } else if (presetName === 'D/C') {
      const dcArea = document.getElementById('dc-area');
      const dcAmountEl = document.getElementById('dc-amount');
      if (dcArea) {
        dcArea.classList.remove('hidden');
        if (dcAmountEl) { dcAmountEl.value = ''; dcAmountEl.focus(); }
      }
      return;
    } else {
      if (nameEl) nameEl.value = presetName;
      if (priceEl) { priceEl.value = ''; priceEl.focus(); }
      if (qtyEl) qtyEl.value = '1';
      return;
    }
  }

  function calcMarginFromPct() {
    const pctEl = document.getElementById('margin-pct');
    const amountEl = document.getElementById('margin-amount');
    if (!pctEl || !amountEl) return;
    const pct = Number(pctEl.value) || 0;
    const rackSubtotal = items
      .filter(i => i.itemType !== 'custom')
      .reduce((sum, i) => sum + ((Number(i.unitPrice) || 0) + (Number(i.installFee) || 0)) * (Number(i.quantity) || 0), 0);
    const amount = Math.round(rackSubtotal * (pct / 100));
    amountEl.textContent = UI.formatCurrency(amount);
    amountEl.dataset.amount = amount;
  }

  function addDiscount() {
    const amountEl = document.getElementById('dc-amount');
    const amount = Math.abs(Number(amountEl?.value) || 0);
    if (amount <= 0) { UI.toast('할인 금액을 입력하세요', 'warning'); return; }

    items.push({
      itemType: 'custom',
      name: 'D/C(할인)',
      unitPrice: -amount,  // 항상 음수로 저장
      installFee: 0,
      quantity: 1,
    });

    const dcArea = document.getElementById('dc-area');
    if (dcArea) dcArea.classList.add('hidden');

    renderItems();
    updateTotal();
    saveDraft();
    UI.toast(`D/C -${UI.formatCurrency(amount)} 적용됨`, 'success');
  }

  function addMargin() {
    const pctEl = document.getElementById('margin-pct');
    const amountEl = document.getElementById('margin-amount');
    const pct = Number(pctEl?.value) || 0;
    const amount = Number(amountEl?.dataset?.amount) || 0;
    if (amount <= 0) { UI.toast('랙 품목을 먼저 추가하세요', 'warning'); return; }

    items.push({
      itemType: 'custom',
      name: `마진(${pct}%)`,
      unitPrice: amount,
      installFee: 0,
      quantity: 1,
    });

    const marginArea = document.getElementById('margin-area');
    if (marginArea) marginArea.classList.add('hidden');

    renderItems();
    updateTotal();
    saveDraft();
    UI.toast(`마진(${pct}%) ${UI.formatCurrency(amount)} 추가됨`, 'success');
  }

  function removeItem(index) {
    items.splice(index, 1);
    renderItems();
    updateTotal();
    saveDraft();
  }

  function renderItems() {
    const container = document.getElementById('items-area');
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <h3 class="text-sm font-bold text-gray-700 px-4 pt-4 pb-2">추가된 품목 (${items.length}건)</h3>
        ${items.map((item, i) => {
          const isCustom = item.itemType === 'custom';
          const itemTotal = isCustom
            ? (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1)
            : ((Number(item.unitPrice) || 0) + (Number(item.installFee) || 0)) * (Number(item.quantity) || 0);
          const isNegative = itemTotal < 0;

          if (isCustom) {
            return `
              <div class="px-4 py-3 border-t border-gray-100 flex items-center gap-3 ${isNegative ? 'bg-red-50/50' : ''}">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-bold ${isNegative ? 'text-red-600' : 'text-gray-800'}">${item.name}</p>
                  <p class="text-xs text-gray-500">${item.quantity > 1 ? `@${UI.formatNumber(item.unitPrice)} × ${item.quantity}` : ''}</p>
                  <p class="text-sm font-bold ${isNegative ? 'text-red-600' : 'text-[#1e3a5f]'} mt-0.5">${UI.formatCurrency(itemTotal)}</p>
                </div>
                <button onclick="App.removeItem(${i})"
                  class="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 active:bg-red-50 text-lg flex-shrink-0">✕</button>
              </div>
            `;
          }
          return `
            <div class="px-4 py-3 border-t border-gray-100 flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-gray-800 truncate">${item.type} ${item.spec} ${item.tier}단</p>
                <p class="text-xs text-gray-500">@${UI.formatNumber(item.unitPrice)} × ${item.quantity}대 + 시공비 ${UI.formatCurrency((Number(item.installFee) || 0) * item.quantity)}</p>
                <p class="text-sm font-bold text-[#1e3a5f] mt-0.5">${UI.formatCurrency(itemTotal)}</p>
              </div>
              <button onclick="App.removeItem(${i})"
                class="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 active:bg-red-50 text-lg flex-shrink-0">✕</button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // --- 계산 (공급가액 + 세액) ---
  function calculate() {
    if (items.length === 0) return { supplyTotal: 0, vat: 0, total: 0, items: null };

    let supplyTotal = 0;
    const itemDetails = items.map(item => {
      const isCustom = item.itemType === 'custom';
      if (isCustom) {
        const amount = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);
        supplyTotal += amount;
        return { ...item, itemTotal: amount };
      } else {
        const subtotal = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0);
        const installTotal = (Number(item.installFee) || 0) * (Number(item.quantity) || 0);
        const itemTotal = subtotal + installTotal;
        supplyTotal += itemTotal;
        return { ...item, subtotal, installTotal, itemTotal };
      }
    });

    const vat = Math.round(supplyTotal * 0.1);
    const total = supplyTotal + vat;
    return { supplyTotal, vat, total, items: itemDetails };
  }

  // --- 금액 표시 업데이트 ---
  function updateTotal() {
    const { supplyTotal, vat, total, items: calcItems } = calculate();
    const totalEl = document.getElementById('total-amount');
    const detailEl = document.getElementById('total-detail');
    const supplyEl = document.getElementById('supply-amount');
    const vatEl = document.getElementById('vat-amount');
    const saveBtn = document.getElementById('btn-save');

    if (totalEl) totalEl.textContent = UI.formatCurrency(total);
    if (supplyEl) supplyEl.textContent = UI.formatCurrency(supplyTotal);
    if (vatEl) vatEl.textContent = UI.formatCurrency(vat);

    if (detailEl) {
      if (calcItems && calcItems.length > 0) {
        const rackItems = calcItems.filter(i => i.itemType !== 'custom');
        const totalQty = rackItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
        const customCount = calcItems.length - rackItems.length;
        let text = rackItems.length > 0 ? `${rackItems.length}종 ${totalQty}대` : '';
        if (customCount > 0) text += (text ? ' + ' : '') + `추가 ${customCount}건`;
        detailEl.textContent = text || '항목을 추가하세요';
      } else {
        detailEl.textContent = '항목을 추가하세요';
      }
    }
    if (saveBtn) {
      saveBtn.disabled = !calcItems || calcItems.length === 0;
    }
  }

  // --- 폼 상태 localStorage 임시 저장 ---
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const draft = {
        items,
        customer: getCustomerInfo(),
        timestamp: Date.now(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 1000);
  }

  function loadDraft() {
    try {
      const data = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (data && Date.now() - data.timestamp < 86400000) {
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
    const { supplyTotal, vat, total, items: calcItems } = calculate();
    if (!calcItems || calcItems.length === 0) {
      UI.toast('품목을 추가하세요', 'warning');
      return null;
    }

    const customer = getCustomerInfo();
    const clientId = 'est-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    const data = {
      items: calcItems,
      supplyTotal,
      vat,
      total,
      ...customer,
      clientId,
    };

    const result = await API.saveEstimate(data);
    if (result && result.estimateId) {
      sessionStorage.setItem('yr-estimate-' + result.estimateId, JSON.stringify({
        ...data,
        estimateId: result.estimateId,
      }));
      clearDraft();
      items = [];
    }
    return result;
  }

  return {
    loadPrices, setQuantity, changeQuantity,
    addItem, addCustomItem, addPresetItem,
    calcMarginFromPct, addMargin, addDiscount,
    removeItem, renderItems,
    calculate, updateTotal, saveEstimate,
    loadDraft, clearDraft, getCustomerInfo,
    get priceData() { return priceData; },
    get items() { return items; },
    set items(v) { items = v; },
  };
})();
