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
  const RECENT_KEY = 'yr_recent_items';
  const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let draftTimer = null;

  // 랙 종류별 형태 매핑
  const RACK_TYPES = ['무볼트앵글', '경량랙', '고급경량랙', '아연랙', '중량랙', '파렛트랙', '곤도라 진열대', '하이퍼 진열대'];
  const RACK_FORMS = {
    '무볼트앵글': ['독립', '연결', '벽부착', '이동'],
    '경량랙': ['독립', '연결', '벽면'],
    '고급경량랙': ['독립', '연결', '벽면'],
    '아연랙': ['독립', '연결', '벽면'],
    '중량랙': ['독립', '연결', '이동'],
    '파렛트랙': ['독립', '연결'],
    '곤도라 진열대': ['중앙독립', '중앙연결', '벽대독립', '벽대연결', '엔드독립', '엔드연결'],
    '하이퍼 진열대': ['중앙독립', '중앙연결', '벽대독립', '벽대연결', '엔드독립', '엔드연결'],
  };

  // --- safe localStorage helpers ---
  function _lsGet(key) {
    try { return localStorage.getItem(key); } catch(e) { return null; }
  }
  function _lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch(e) {}
  }
  function _lsRemove(key) {
    try { localStorage.removeItem(key); } catch(e) {}
  }

  // --- 단가 데이터 로드 ---
  async function loadPrices() {
    const cached = _lsGet('yr_prices_cache');
    const cacheTs = Number(_lsGet('yr_prices_cache_ts')) || 0;
    const cacheIsFresh = cached && (Date.now() - cacheTs < PRICE_CACHE_TTL);

    if (cached) {
      try {
        priceData = JSON.parse(cached);
        renderRackSelector();
      } catch {}
    }

    // Skip network fetch if cache is fresh
    if (cacheIsFresh) return;

    try {
      const data = await API.getPrices();
      if (data && data.prices) {
        priceData = data.prices;
        _lsSet('yr_prices_cache', JSON.stringify(priceData));
        _lsSet('yr_prices_cache_ts', String(Date.now()));
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

  function getFormsForType(type) {
    return [...new Set(priceData.filter(p => p.type === type).map(p => p.form || '').filter(Boolean))];
  }

  function getSpecsForTypeAndForm(type, form) {
    return priceData.filter(p => p.type === type && (p.form || '') === (form || ''));
  }

  // --- 최근 사용 관리 ---
  function getRecentItems() {
    try {
      return JSON.parse(_lsGet(RECENT_KEY) || '[]').slice(0, 5);
    } catch { return []; }
  }

  function addRecentItem(item) {
    const recents = getRecentItems();
    // 중복 제거 (type+form+spec+tier 기준)
    const key = `${item.type}|${item.form || ''}|${item.spec}|${item.tier}`;
    const filtered = recents.filter(r => `${r.type}|${r.form || ''}|${r.spec}|${r.tier}` !== key);
    filtered.unshift({ type: item.type, form: item.form || '', spec: item.spec, tier: item.tier, unitPrice: item.unitPrice, installFee: item.installFee, vat: item.vat });
    _lsSet(RECENT_KEY, JSON.stringify(filtered.slice(0, 5)));
  }

  // --- 칩/카드 기반 렌더링 ---
  let _selType = '';
  let _selForm = '';

  function renderRackSelector() {
    const container = document.getElementById('rack-selector');
    if (!container) return;

    if (priceData.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">등록된 랙이 없습니다. 더보기 > 단가 관리에서 추가하세요.</p>';
      return;
    }

    _selType = '';
    _selForm = '';
    currentSelection = null;

    let html = '';

    // 최근 사용
    const recents = getRecentItems();
    if (recents.length > 0) {
      html += `<div class="mb-4">
        <label class="block text-xs font-semibold text-gray-500 mb-2">최근 사용</label>
        <div class="flex flex-wrap gap-2">
          ${recents.map((r, i) => {
            const specShort = r.spec || '';
            const tierStr = r.tier ? `*${r.tier}s` : '';
            const label = `${r.type}${r.form ? '(' + r.form + ')' : ''} ${specShort}${tierStr}`;
            return `<button type="button" onclick="App.addRecentQuick(${i})"
              class="px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs font-semibold text-blue-700 active:bg-blue-100 text-left">
              <span class="block">${label}</span>
              <span class="block text-blue-500 text-[10px]">${UI.formatCurrency(r.unitPrice || 0)}</span>
            </button>`;
          }).join('')}
        </div>
      </div>`;
    }

    // 종류 칩
    const categories = getCategories();
    const allTypes = [...new Set([...RACK_TYPES, ...categories])];
    html += `<div class="mb-3">
      <label class="block text-xs font-semibold text-gray-500 mb-2">랙 종류</label>
      <div id="chips-type" class="flex flex-wrap gap-2">
        ${allTypes.map(t => `<span class="chip" onclick="App.onTypeChip('${t}')">${t}</span>`).join('')}
      </div>
    </div>`;

    // 형태 영역 (hidden)
    html += `<div id="sel-form-group" class="mb-3 hidden">
      <label class="block text-xs font-semibold text-gray-500 mb-2">형태</label>
      <div id="chips-form" class="flex flex-wrap gap-2"></div>
    </div>`;

    // 규격 카드 영역 (hidden)
    html += `<div id="sel-spec-group" class="mb-3 hidden">
      <div class="flex items-center justify-between mb-2">
        <label class="block text-xs font-semibold text-gray-500">규격 선택</label>
        <div class="flex gap-1">
          <button type="button" onclick="App.sortSpecs('spec')" id="sort-spec-btn"
            class="text-[10px] px-2 py-0.5 rounded-full bg-[#1e3a5f] text-white">규격순</button>
          <button type="button" onclick="App.sortSpecs('price')" id="sort-price-btn"
            class="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">가격순</button>
        </div>
      </div>
      <div id="cards-spec" class="flex flex-col gap-1 max-h-[280px] overflow-y-auto overscroll-contain rounded-lg border border-gray-200"></div>
    </div>`;

    container.innerHTML = html;
  }

  function onTypeChip(type) {
    _selType = type;
    _selForm = '';
    currentSelection = null;
    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.add('hidden');

    // 타입 칩 활성 상태
    document.querySelectorAll('#chips-type .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === type);
    });

    // 형태 칩 렌더
    const formGroup = document.getElementById('sel-form-group');
    const specGroup = document.getElementById('sel-spec-group');
    specGroup.classList.add('hidden');

    const dataForms = getFormsForType(type);
    const presetForms = RACK_FORMS[type] || [];
    const allForms = [...new Set([...presetForms, ...dataForms])];

    if (allForms.length === 0) {
      // 형태 없이 바로 규격 표시
      formGroup.classList.add('hidden');
      _selForm = '';
      renderSpecCards(type, '');
      return;
    }

    const chipsContainer = document.getElementById('chips-form');
    chipsContainer.innerHTML = allForms.map(f =>
      `<span class="chip chip-form" onclick="App.onFormChip('${f}')">${f}</span>`
    ).join('');
    formGroup.classList.remove('hidden');
  }

  function onFormChip(form) {
    _selForm = form;
    currentSelection = null;
    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.add('hidden');

    // 형태 칩 활성 상태
    document.querySelectorAll('#chips-form .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === form);
    });

    renderSpecCards(_selType, form);
  }

  function onFormChipCustom() {
    const form = prompt('형태를 입력하세요:');
    if (!form || !form.trim()) return;
    _selForm = form.trim();
    currentSelection = null;

    document.querySelectorAll('#chips-form .chip').forEach(el => {
      el.classList.remove('selected');
      if (el.textContent === '기타 ✏️') el.classList.add('selected');
    });

    renderSpecCards(_selType, _selForm);
  }

  let _specSortMode = 'spec'; // 'spec' or 'price'

  function sortSpecs(mode) {
    _specSortMode = mode;
    // 정렬 버튼 활성 상태 토글
    const specBtn = document.getElementById('sort-spec-btn');
    const priceBtn = document.getElementById('sort-price-btn');
    if (specBtn && priceBtn) {
      specBtn.className = mode === 'spec'
        ? 'text-[10px] px-2 py-0.5 rounded-full bg-[#1e3a5f] text-white'
        : 'text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600';
      priceBtn.className = mode === 'price'
        ? 'text-[10px] px-2 py-0.5 rounded-full bg-[#1e3a5f] text-white'
        : 'text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600';
    }
    renderSpecCards(_selType, _selForm);
  }

  function _parseSpecDims(spec) {
    if (!spec) return [9999, 9999, 9999];
    const parts = spec.split('*').map(s => parseInt(s, 10) || 9999);
    return [parts[0] || 9999, parts[1] || 9999, parts[2] || 9999]; // 가로, 세로, 높이
  }

  function renderSpecCards(type, form) {
    const specGroup = document.getElementById('sel-spec-group');
    const cardsContainer = document.getElementById('cards-spec');
    const items = getSpecsForTypeAndForm(type, form);

    if (items.length === 0) {
      specGroup.classList.remove('hidden');
      cardsContainer.innerHTML = '<p class="text-gray-400 text-xs text-center py-3">등록된 규격이 없습니다</p>';
      return;
    }

    // 정렬
    const sorted = [...items].sort((a, b) => {
      if (_specSortMode === 'price') return (a.unitPrice || 0) - (b.unitPrice || 0);
      const da = _parseSpecDims(a.spec), db = _parseSpecDims(b.spec);
      return (da[0] - db[0]) || (da[1] - db[1]) || (da[2] - db[2]);
    });
    // 원본 인덱스 매핑
    const idxMap = sorted.map(s => items.indexOf(s));

    specGroup.classList.remove('hidden');
    cardsContainer.innerHTML = sorted.map((p, si) => {
      const tierStr = p.tier ? `${p.tier}단` : '';
      const feeStr = p.installFee ? `<span class="text-gray-400 text-[10px]">(+${UI.formatCurrency(p.installFee)})</span>` : '';
      return `<button type="button" onclick="App.onSpecCard(${idxMap[si]})" data-idx="${idxMap[si]}"
        class="spec-card flex items-center justify-between px-3 py-2.5 bg-white border-b border-gray-100 text-left active:bg-blue-50 transition-colors"
        ><div class="flex items-center gap-2 min-w-0">
          <span class="text-sm font-bold text-gray-800 truncate">${p.spec || '규격 없음'}</span>
          ${tierStr ? `<span class="text-[10px] text-gray-400 shrink-0">${tierStr}</span>` : ''}
        </div>
        <div class="flex items-center gap-1 shrink-0 ml-2">
          <span class="text-sm font-extrabold text-[#1e3a5f]">${UI.formatCurrency(p.unitPrice || 0)}</span>
          ${feeStr}
        </div>
      </button>`;
    }).join('');
  }

  function onSpecCard(index) {
    const items = getSpecsForTypeAndForm(_selType, _selForm);
    currentSelection = items[index] || null;
    if (!currentSelection) return;

    // 행 활성 상태
    document.querySelectorAll('.spec-card').forEach(el => {
      const isSelected = parseInt(el.dataset.idx) === index;
      el.classList.toggle('bg-blue-50', isSelected);
      el.classList.toggle('bg-white', !isSelected);
      el.classList.toggle('border-l-[3px]', isSelected);
      el.classList.toggle('border-l-[#1e3a5f]', isSelected);
    });

    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.remove('hidden');
  }

  function addRecentQuick(index) {
    const recents = getRecentItems();
    const r = recents[index];
    if (!r) return;

    items.push({
      type: r.type,
      form: r.form || '',
      spec: r.spec,
      tier: r.tier,
      unitPrice: Number(r.unitPrice) || 0,
      installFee: Number(r.installFee) || 0,
      vat: r.vat || '별도',
      quantity: 1,
    });

    renderItems();
    updateTotal();
    saveDraft();
    UI.toast('품목이 추가되었습니다', 'success');
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

    const newItem = {
      type: currentSelection.type,
      form: currentSelection.form || '',
      spec: currentSelection.spec,
      tier: currentSelection.tier,
      unitPrice: Number(currentSelection.unitPrice) || 0,
      installFee: Number(currentSelection.installFee) || 0,
      vat: currentSelection.vat || '별도',
      quantity: currentQuantity,
    };
    items.push(newItem);
    addRecentItem(newItem);

    currentSelection = null;
    currentQuantity = 1;
    _selType = '';
    _selForm = '';

    // 선택 UI 초기화
    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.add('hidden');
    const qtyInput = document.getElementById('qty-input');
    if (qtyInput) qtyInput.value = 1;

    // 칩/카드 초기화
    document.querySelectorAll('#chips-type .chip').forEach(el => el.classList.remove('selected'));
    const formGroup = document.getElementById('sel-form-group');
    const specGroup = document.getElementById('sel-spec-group');
    if (formGroup) formGroup.classList.add('hidden');
    if (specGroup) specGroup.classList.add('hidden');

    renderItems();
    updateTotal();
    saveDraft();
    // 최근 사용 다시 렌더
    renderRackSelector();
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

  // Hide all preset toggle areas, optionally show one by id
  function setActivePreset(showId) {
    const ids = ['margin-area', 'dc-area'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id === showId) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
  }

  // Legacy alias
  function hideAllPresetAreas() { setActivePreset(null); }

  function addPresetItem(presetName) {
    const nameEl = document.getElementById('custom-name');
    const priceEl = document.getElementById('custom-price');
    const qtyEl = document.getElementById('custom-qty');

    // 먼저 모든 토글 영역 닫기
    setActivePreset(null);

    if (presetName === '마진') {
      setActivePreset('margin-area');
      const marginPctEl = document.getElementById('margin-pct');
      if (marginPctEl) { marginPctEl.value = '25'; marginPctEl.focus(); }
      calcMarginFromPct();
      return;
    } else if (presetName === 'D/C') {
      setActivePreset('dc-area');
      const dcAmountEl = document.getElementById('dc-amount');
      if (dcAmountEl) { dcAmountEl.value = ''; dcAmountEl.focus(); }
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

    // 품목 있으면 초기화 버튼 표시 (수정 모드 아닌 경우에도)
    const btnReset = document.getElementById('btn-reset');
    if (btnReset) {
      if (items.length > 0) btnReset.classList.remove('hidden');
      else if (!sessionStorage.getItem('yr_edit_id')) btnReset.classList.add('hidden');
    }

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
                <p class="text-sm font-bold text-gray-800 truncate">${item.type}${item.form ? '(' + item.form + ')' : ''} ${item.spec}${item.tier ? '*' + item.tier + 's' : ''}</p>
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
  // D/C는 총액(공급가액+세액) 기준으로 차감
  function calculate() {
    if (items.length === 0) return { supplyTotal: 0, vat: 0, total: 0, items: null };
    return Calc.calcTotals(items);
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
      _lsSet(DRAFT_KEY, JSON.stringify(draft));
    }, 1000);
  }

  function loadDraft() {
    try {
      const raw = _lsGet(DRAFT_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && Date.now() - data.timestamp < 86400000) {
        return data;
      }
    } catch {}
    return null;
  }

  function clearDraft() {
    _lsRemove(DRAFT_KEY);
  }

  // --- 고객 정보 ---
  function _sanitizeField(val, maxLen) {
    return String(val || '').trim().slice(0, maxLen || 100);
  }

  function getCustomerInfo() {
    return {
      name: _sanitizeField(document.getElementById('cust-name')?.value, 50),
      company: _sanitizeField(document.getElementById('cust-company')?.value, 50),
      phone: _sanitizeField(document.getElementById('cust-phone')?.value, 20),
      address: _sanitizeField(document.getElementById('cust-address')?.value, 200),
      bizNumber: _sanitizeField(document.getElementById('cust-biz-number')?.value, 20),
      bizType: _sanitizeField(document.getElementById('cust-biz-type')?.value, 30),
      bizItem: _sanitizeField(document.getElementById('cust-biz-item')?.value, 30),
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
    const randomPart = (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(36)).join('').substr(0, 6)
      : Math.random().toString(36).substr(2, 6);
    const clientId = 'est-' + Date.now() + '-' + randomPart;
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
      try {
        sessionStorage.setItem('yr-estimate-' + result.estimateId, JSON.stringify({
          ...data,
          estimateId: result.estimateId,
        }));
      } catch(e) {}
      clearDraft();
      items = [];
    }
    return result;
  }

  function resetEstimate() {
    if (items.length > 0 && !confirm('현재 작성 중인 견적을 초기화하시겠습니까?')) return;
    items = [];
    renderItems();
    updateTotal();
    clearDraft();
    sessionStorage.removeItem('yr_edit_id');
    sessionStorage.removeItem('yr_request_row');
    // 고객 정보 초기화
    ['cust-name','cust-company','cust-phone','cust-address','cust-biz-number','cust-biz-type','cust-biz-item'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    // UI 초기화
    const banner = document.getElementById('edit-banner');
    if (banner) banner.classList.add('hidden');
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) pageTitle.textContent = '새 견적 작성';
    const btnSave = document.getElementById('btn-save');
    if (btnSave) btnSave.textContent = '견적 저장';
    const btnReset = document.getElementById('btn-reset');
    if (btnReset) btnReset.classList.add('hidden');
    const customerForm = document.getElementById('customer-form');
    if (customerForm) customerForm.classList.add('hidden');
    UI.toast('초기화되었습니다', 'info');
  }

  return {
    loadPrices, setQuantity, changeQuantity,
    addItem, addCustomItem, addPresetItem, setActivePreset,
    calcMarginFromPct, addMargin, addDiscount,
    removeItem, renderItems,
    calculate, updateTotal, saveEstimate, resetEstimate,
    loadDraft, clearDraft, getCustomerInfo,
    onTypeChip, onFormChip, onFormChipCustom, onSpecCard, addRecentQuick, sortSpecs,
    get priceData() { return priceData; },
    get items() { return items; },
    set items(v) { items = v; },
  };
})();
