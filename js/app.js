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
    return priceData.filter(p => p.type === type && (p.form || '') === (form || '') && !p.isAccessory);
  }

  // --- 가격 모델 판별 ---
  function _getPricingModel(type) {
    if (!type) return 'A';
    var t = type.trim();
    if (['고급경량랙','MD경량랙','경량랙','아연랙','MD중량랙','KD중량랙','중량랙','파렛트랙'].indexOf(t) >= 0) return 'A';
    if (t === '하이퍼 진열대' || t.indexOf('하이퍼') >= 0) return 'B';
    if (t === '곤도라 진열대' || t.indexOf('곤도라') >= 0) return 'D';
    if (t === '무볼트앵글' || t.indexOf('앵글') >= 0) return 'C';
    return 'A';
  }

  // --- 부속품 필터 ---
  function getAccessoriesForType(type) {
    return priceData.filter(p => p.type === type && p.isAccessory);
  }

  // --- 세트 필터 (모델 D) ---
  function getSetsForType(type) {
    return priceData.filter(p => p.type === type && p.setName && !p.isAccessory);
  }

  function getPartsForType(type) {
    return priceData.filter(p => p.type === type && p.partCategory && !p.setName && !p.isAccessory);
  }

  // --- 최근 사용 관리 ---
  function getRecentItems() {
    try {
      return JSON.parse(_lsGet(RECENT_KEY) || '[]').slice(0, 5);
    } catch { return []; }
  }

  function addRecentItem(item) {
    const recents = getRecentItems();
    const key = `${item.type}|${item.form || ''}|${item.spec}|${item.tier}`;
    const filtered = recents.filter(r => `${r.type}|${r.form || ''}|${r.spec}|${r.tier}` !== key);
    filtered.unshift({ type: item.type, form: item.form || '', spec: item.spec, tier: item.tier, unitPrice: item.unitPrice, installFee: item.installFee, vat: item.vat });
    _lsSet(RECENT_KEY, JSON.stringify(filtered.slice(0, 5)));
  }

  // --- 빈도 기반 추천 ---
  var FREQ_KEY = 'yr_item_freq';

  function addItemFrequency(item) {
    try {
      var freq = JSON.parse(_lsGet(FREQ_KEY) || '{}');
      var key = item.type + '|' + (item.form || '') + '|' + item.spec + '|' + item.tier;
      freq[key] = (freq[key] || 0) + 1;
      _lsSet(FREQ_KEY, JSON.stringify(freq));
    } catch {}
  }

  function getTopItems(n) {
    try {
      var freq = JSON.parse(_lsGet(FREQ_KEY) || '{}');
      var entries = Object.entries(freq).sort(function(a, b) { return b[1] - a[1]; });
      var tops = [];
      for (var i = 0; i < Math.min(entries.length, n || 3); i++) {
        var parts = entries[i][0].split('|');
        var match = priceData.find(function(p) {
          return p.type === parts[0] && (p.form || '') === parts[1] && String(p.spec) === parts[2] && String(p.tier) === parts[3];
        });
        if (match) {
          tops.push({ type: match.type, form: match.form, spec: match.spec, tier: match.tier,
            unitPrice: match.unitPrice, installFee: match.installFee, vat: match.vat, _count: entries[i][1] });
        }
      }
      return tops;
    } catch { return []; }
  }

  // --- 고객 패턴 추천 ---
  var _customerPatternItems = [];

  function setCustomerPatternItems(estimates) {
    _customerPatternItems = [];
    if (!estimates || !estimates.length) return;
    var seen = {};
    estimates.forEach(function(est) {
      var estItems = est.items || [];
      if (typeof estItems === 'string') { try { estItems = JSON.parse(estItems); } catch { estItems = []; } }
      estItems.forEach(function(item) {
        if (item.itemType === 'custom') return;
        var key = item.type + '|' + (item.form || '') + '|' + String(item.spec) + '|' + String(item.tier);
        if (!seen[key]) {
          seen[key] = true;
          var match = priceData.find(function(p) {
            return p.type === item.type && (p.form || '') === (item.form || '') && String(p.spec) === String(item.spec) && String(p.tier) === String(item.tier);
          });
          if (match) {
            _customerPatternItems.push({ type: match.type, form: match.form, spec: match.spec, tier: match.tier,
              unitPrice: match.unitPrice, installFee: match.installFee, vat: match.vat });
          }
        }
      });
    });
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

    // 자주 사용하는 품목 (빈도 기반 TOP3, 없으면 최근 사용)
    var topItems = getTopItems(3);
    var quickItems = topItems.length > 0 ? topItems : getRecentItems();
    var quickLabel = topItems.length > 0 ? '자주 사용하는 품목' : '최근 사용';
    if (quickItems.length > 0) {
      html += `<div class="mb-4">
        <label class="block text-xs font-semibold text-gray-500 mb-2">${quickLabel}</label>
        <div class="flex flex-wrap gap-2">
          ${quickItems.map((r, i) => {
            const specShort = String(r.spec || '');
            const tierStr = r.tier ? '*' + r.tier + 's' : '';
            const label = r.type + (r.form ? '(' + r.form + ')' : '') + ' ' + specShort + tierStr;
            const countBadge = r._count ? ' (' + r._count + '회)' : '';
            return `<button type="button" onclick="App.addRecentQuick(${i})"
              class="px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs font-semibold text-blue-700 active:bg-blue-100 text-left">
              <span class="block">${label}${countBadge}</span>
              <span class="block text-blue-500 text-[10px]">${UI.formatCurrency(r.unitPrice || 0)}</span>
            </button>`;
          }).join('')}
        </div>
      </div>`;
    }

    // 이 고객 패턴
    if (_customerPatternItems.length > 0) {
      html += `<div class="mb-4">
        <label class="block text-xs font-semibold text-gray-500 mb-2">이 고객이 사용한 품목</label>
        <div class="flex flex-wrap gap-2">
          ${_customerPatternItems.slice(0, 5).map((r, i) => {
            const specShort = String(r.spec || '');
            const label = r.type + (r.form ? '(' + r.form + ')' : '') + ' ' + specShort;
            return `<button type="button" onclick="App._addPatternItem(${i})"
              class="px-3 py-2 bg-green-50 border border-green-200 rounded-xl text-xs font-semibold text-green-700 active:bg-green-100 text-left">
              <span class="block">${label}</span>
              <span class="block text-green-500 text-[10px]">${UI.formatCurrency(r.unitPrice || 0)}</span>
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

    // 형태 영역 (hidden) — 모델 A/B 공통
    html += `<div id="sel-form-group" class="mb-3 hidden">
      <label class="block text-xs font-semibold text-gray-500 mb-2">형태</label>
      <div id="chips-form" class="flex flex-wrap gap-2"></div>
    </div>`;

    // 모델 B 배치유형 칩 (hidden)
    html += `<div id="sel-layout-group" class="mb-3 hidden">
      <label class="block text-xs font-semibold text-gray-500 mb-2">배치유형</label>
      <div id="chips-layout" class="flex flex-wrap gap-2"></div>
    </div>`;

    // 규격 카드 영역 (hidden) — 모델 A/B 공통
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

    // 선반 추가 옵션 (모델 A — hidden)
    html += `<div id="sel-shelf-addon" class="mb-3 hidden">
      <div class="bg-blue-50 rounded-lg p-3">
        <label class="flex items-center gap-2 text-xs font-semibold text-gray-700">
          <input type="checkbox" id="chk-shelf-addon" onchange="App.onShelfAddonToggle()">
          선반 추가 (받침 포함)
        </label>
        <div id="shelf-addon-detail" class="hidden mt-2">
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500">추가 수량:</span>
            <input type="number" id="shelf-addon-qty" value="1" min="1" max="20"
              class="w-16 h-8 px-2 border border-gray-300 rounded-lg text-sm text-center" onchange="App.updateShelfAddonPreview()">
            <span class="text-xs text-gray-500">단</span>
            <span class="ml-auto text-xs font-bold text-blue-600" id="shelf-addon-price-label"></span>
          </div>
        </div>
      </div>
    </div>`;

    // 모델 C: 부품 조합 영역 (hidden)
    html += `<div id="sel-parts-group" class="mb-3 hidden">
      <label class="block text-xs font-semibold text-gray-500 mb-2">부품 종류</label>
      <div id="chips-part-cat" class="flex flex-wrap gap-2 mb-3"></div>
      <div id="parts-thickness-area" class="hidden mb-3">
        <label class="block text-xs font-semibold text-gray-500 mb-2">두께</label>
        <div id="chips-part-thickness" class="flex flex-wrap gap-2"></div>
      </div>
      <div id="parts-list" class="hidden">
        <label class="block text-xs font-semibold text-gray-500 mb-2">길이별 단가</label>
        <div id="cards-parts" class="flex flex-col gap-1 max-h-[280px] overflow-y-auto overscroll-contain rounded-lg border border-gray-200"></div>
      </div>
    </div>`;

    // 모델 D: 세트/부품 선택 영역 (hidden)
    html += `<div id="sel-sets-group" class="mb-3 hidden">
      <div class="flex gap-2 mb-3">
        <button type="button" onclick="App.onDModeSwitch('set')" id="d-mode-set"
          class="chip selected">세트 선택</button>
        <button type="button" onclick="App.onDModeSwitch('part')" id="d-mode-part"
          class="chip">부품 개별</button>
      </div>
      <div id="d-set-cards" class="flex flex-col gap-1 max-h-[300px] overflow-y-auto overscroll-contain rounded-lg border border-gray-200"></div>
      <div id="d-part-area" class="hidden">
        <label class="block text-xs font-semibold text-gray-500 mb-2">부품 종류</label>
        <div id="d-chips-part-cat" class="flex flex-wrap gap-2 mb-3"></div>
        <div id="d-parts-list" class="flex flex-col gap-1 max-h-[280px] overflow-y-auto overscroll-contain rounded-lg border border-gray-200"></div>
      </div>
    </div>`;

    // 부속품 추가 영역 (모든 모델 공통 — hidden)
    html += `<div id="sel-accessories" class="mb-3 hidden">
      <label class="block text-xs font-semibold text-gray-500 mb-2">부속품 추가</label>
      <div id="cards-accessories" class="flex flex-col gap-1 max-h-[200px] overflow-y-auto overscroll-contain rounded-lg border border-gray-200"></div>
    </div>`;

    container.innerHTML = html;
  }

  // 모든 하위 선택 영역 숨기기
  function _hideAllSubGroups() {
    ['sel-form-group','sel-layout-group','sel-spec-group','sel-shelf-addon',
     'sel-parts-group','sel-sets-group','sel-accessories'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.add('hidden');
  }

  let _selLayout = ''; // 모델 B: 배치유형
  let _selPartCat = ''; // 모델 C: 부품 카테고리
  let _selPartThickness = ''; // 모델 C: 두께
  let _dMode = 'set'; // 모델 D: set / part

  function onTypeChip(type) {
    _selType = type;
    _selForm = '';
    _selLayout = '';
    _selPartCat = '';
    _selPartThickness = '';
    currentSelection = null;
    _hideAllSubGroups();

    // 타입 칩 활성 상태
    document.querySelectorAll('#chips-type .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === type);
    });

    const model = _getPricingModel(type);

    switch (model) {
      case 'B': _renderModelB(type); break;
      case 'C': _renderModelC(type); break;
      case 'D': _renderModelD(type); break;
      default:  _renderModelA(type); break;
    }

    // 부속품 표시
    _renderAccessories(type);
  }

  // ======== 모델 A: 기존 흐름 + 선반추가 ========
  function _renderModelA(type) {
    const formGroup = document.getElementById('sel-form-group');
    const dataForms = getFormsForType(type);
    const presetForms = RACK_FORMS[type] || [];
    const allForms = [...new Set([...presetForms, ...dataForms])];

    if (allForms.length === 0) {
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

  // ======== 모델 B: 배치 → 형태 → 규격 ========
  function _renderModelB(type) {
    // 배치유형 칩 (벽면/앤드/중앙)
    const layoutGroup = document.getElementById('sel-layout-group');
    const layoutChips = document.getElementById('chips-layout');
    const layouts = [...new Set(priceData.filter(p => p.type === type && p.layoutType).map(p => p.layoutType))];
    if (layouts.length === 0) {
      // layoutType이 없으면 기존 form 기반으로 fallback
      _renderModelA(type);
      return;
    }
    layoutChips.innerHTML = layouts.map(l =>
      `<span class="chip" onclick="App.onLayoutChip('${l}')">${l}</span>`
    ).join('');
    layoutGroup.classList.remove('hidden');

    // 형태 칩도 표시 (독립/연결)
    const formGroup = document.getElementById('sel-form-group');
    const forms = [...new Set(priceData.filter(p => p.type === type).map(p => p.form).filter(Boolean))];
    const chipsContainer = document.getElementById('chips-form');
    chipsContainer.innerHTML = forms.map(f =>
      `<span class="chip chip-form" onclick="App.onFormChip('${f}')">${f}</span>`
    ).join('');
    formGroup.classList.remove('hidden');
  }

  function onLayoutChip(layout) {
    _selLayout = layout;
    document.querySelectorAll('#chips-layout .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === layout);
    });
    if (_selForm) _renderModelBSpecs();
  }

  // ======== 모델 C: 부품 카테고리 → 두께 → 길이별 카드 ========
  function _renderModelC(type) {
    const partsGroup = document.getElementById('sel-parts-group');
    const catChips = document.getElementById('chips-part-cat');
    const parts = getPartsForType(type);
    const categories = [...new Set(parts.map(p => p.partCategory).filter(Boolean))];

    catChips.innerHTML = categories.map(c =>
      `<span class="chip" onclick="App.onPartCatChip('${c}')">${c}</span>`
    ).join('');
    partsGroup.classList.remove('hidden');
  }

  function onPartCatChip(cat) {
    _selPartCat = cat;
    _selPartThickness = '';
    document.querySelectorAll('#chips-part-cat .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === cat);
    });

    // 두께 옵션
    const parts = getPartsForType(_selType).filter(p => p.partCategory === cat);
    const thicknesses = [...new Set(parts.map(p => p.partThickness).filter(Boolean))];

    const thicknessArea = document.getElementById('parts-thickness-area');
    if (thicknesses.length > 1) {
      const thicknessChips = document.getElementById('chips-part-thickness');
      thicknessChips.innerHTML = thicknesses.map(t =>
        `<span class="chip" onclick="App.onPartThicknessChip('${t}')">${t}</span>`
      ).join('');
      thicknessArea.classList.remove('hidden');
    } else {
      thicknessArea.classList.add('hidden');
      _selPartThickness = thicknesses[0] || '';
      _renderPartCards();
    }
  }

  function onPartThicknessChip(thickness) {
    _selPartThickness = thickness;
    document.querySelectorAll('#chips-part-thickness .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === thickness);
    });
    _renderPartCards();
  }

  function _renderPartCards() {
    const listArea = document.getElementById('parts-list');
    const cardsContainer = document.getElementById('cards-parts');
    let parts = getPartsForType(_selType).filter(p => p.partCategory === _selPartCat);
    if (_selPartThickness) parts = parts.filter(p => p.partThickness === _selPartThickness);

    parts.sort((a, b) => (a.partLength || 0) - (b.partLength || 0));

    cardsContainer.innerHTML = parts.map((p, i) => {
      const label = p.spec || (p.partLength ? p.partLength + 'mm' : '');
      return `<button type="button" onclick="App.onPartCard('${_selPartCat}','${_selPartThickness}',${i})" data-idx="${i}"
        class="part-card flex items-center justify-between px-3 py-2.5 bg-white border-b border-gray-100 text-left active:bg-purple-50 transition-colors">
        <span class="text-sm font-bold text-gray-800">${label}</span>
        <span class="text-sm font-extrabold text-purple-600">${UI.formatCurrency(p.unitPrice)}</span>
      </button>`;
    }).join('') || '<p class="text-gray-400 text-xs text-center py-3">등록된 부품이 없습니다</p>';
    listArea.classList.remove('hidden');
  }

  function onPartCard(cat, thickness, index) {
    let parts = getPartsForType(_selType).filter(p => p.partCategory === cat);
    if (thickness) parts = parts.filter(p => p.partThickness === thickness);
    parts.sort((a, b) => (a.partLength || 0) - (b.partLength || 0));
    currentSelection = parts[index] || null;
    if (!currentSelection) return;

    document.querySelectorAll('.part-card').forEach(el => {
      const isSelected = parseInt(el.dataset.idx) === index;
      el.classList.toggle('bg-purple-50', isSelected);
      el.classList.toggle('bg-white', !isSelected);
      el.classList.toggle('border-l-[3px]', isSelected);
      el.classList.toggle('border-l-purple-600', isSelected);
    });

    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.remove('hidden');
  }

  // ======== 모델 D: 세트 선택 / 부품 개별 ========
  function _renderModelD(type) {
    const setsGroup = document.getElementById('sel-sets-group');
    setsGroup.classList.remove('hidden');
    _dMode = 'set';
    _renderDSetCards(type);
  }

  function onDModeSwitch(mode) {
    _dMode = mode;
    document.getElementById('d-mode-set').classList.toggle('selected', mode === 'set');
    document.getElementById('d-mode-part').classList.toggle('selected', mode === 'part');

    if (mode === 'set') {
      document.getElementById('d-set-cards').classList.remove('hidden');
      document.getElementById('d-part-area').classList.add('hidden');
      _renderDSetCards(_selType);
    } else {
      document.getElementById('d-set-cards').classList.add('hidden');
      document.getElementById('d-part-area').classList.remove('hidden');
      _renderDPartCats(_selType);
    }
  }

  function _renderDSetCards(type) {
    const container = document.getElementById('d-set-cards');
    const sets = getSetsForType(type);

    if (sets.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-xs text-center py-3">등록된 세트가 없습니다</p>';
      return;
    }

    container.innerHTML = sets.map((s, i) => {
      const layoutBadge = s.layoutType ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">${s.layoutType}</span>` : '';
      const formBadge = s.form ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700">${s.form}</span>` : '';
      return `<button type="button" onclick="App.onDSetCard(${i})" data-idx="${i}"
        class="d-set-card flex items-center justify-between px-3 py-3 bg-white border-b border-gray-100 text-left active:bg-amber-50 transition-colors">
        <div>
          <div class="flex items-center gap-1 mb-0.5">${layoutBadge}${formBadge}</div>
          <span class="text-sm font-bold text-gray-800">${s.setName || s.spec || '세트'}</span>
          <span class="text-[10px] text-gray-400 ml-1">${s.spec || ''}</span>
        </div>
        <span class="text-sm font-extrabold text-amber-600">${UI.formatCurrency(s.unitPrice)}</span>
      </button>`;
    }).join('');
  }

  function onDSetCard(index) {
    const sets = getSetsForType(_selType);
    currentSelection = sets[index] || null;
    if (!currentSelection) return;

    document.querySelectorAll('.d-set-card').forEach(el => {
      const isSelected = parseInt(el.dataset.idx) === index;
      el.classList.toggle('bg-amber-50', isSelected);
      el.classList.toggle('bg-white', !isSelected);
      el.classList.toggle('border-l-[3px]', isSelected);
      el.classList.toggle('border-l-amber-500', isSelected);
    });

    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.remove('hidden');
  }

  function _renderDPartCats(type) {
    const catChips = document.getElementById('d-chips-part-cat');
    const parts = getPartsForType(type);
    const categories = [...new Set(parts.map(p => p.partCategory).filter(Boolean))];

    catChips.innerHTML = categories.map(c =>
      `<span class="chip" onclick="App.onDPartCatChip('${c}')">${c}</span>`
    ).join('');
  }

  function onDPartCatChip(cat) {
    _selPartCat = cat;
    document.querySelectorAll('#d-chips-part-cat .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === cat);
    });

    const container = document.getElementById('d-parts-list');
    let parts = getPartsForType(_selType).filter(p => p.partCategory === cat);
    parts.sort((a, b) => (a.partLength || a.unitPrice || 0) - (b.partLength || b.unitPrice || 0));

    container.innerHTML = parts.map((p, i) => {
      const label = p.spec || (p.partLength ? p.partLength + 'mm' : p.partCategory);
      return `<button type="button" onclick="App.onDPartCard('${cat}',${i})" data-idx="${i}"
        class="d-part-card flex items-center justify-between px-3 py-2.5 bg-white border-b border-gray-100 text-left active:bg-amber-50 transition-colors">
        <span class="text-sm font-bold text-gray-800">${label}</span>
        <span class="text-sm font-extrabold text-amber-600">${UI.formatCurrency(p.unitPrice)}</span>
      </button>`;
    }).join('') || '<p class="text-gray-400 text-xs text-center py-3">등록된 부품이 없습니다</p>';
    container.classList.remove('hidden');
  }

  function onDPartCard(cat, index) {
    let parts = getPartsForType(_selType).filter(p => p.partCategory === cat);
    parts.sort((a, b) => (a.partLength || a.unitPrice || 0) - (b.partLength || b.unitPrice || 0));
    currentSelection = parts[index] || null;
    if (!currentSelection) return;

    document.querySelectorAll('.d-part-card').forEach(el => {
      const isSelected = parseInt(el.dataset.idx) === index;
      el.classList.toggle('bg-amber-50', isSelected);
      el.classList.toggle('bg-white', !isSelected);
    });

    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.remove('hidden');
  }

  // ======== 부속품 공통 ========
  function _renderAccessories(type) {
    const accGroup = document.getElementById('sel-accessories');
    const accCards = document.getElementById('cards-accessories');
    const accessories = getAccessoriesForType(type);
    if (accessories.length === 0) {
      accGroup.classList.add('hidden');
      return;
    }
    accCards.innerHTML = accessories.map((a, i) => {
      const cat = a.accessoryCategory || a.partCategory || '';
      const label = cat + (a.spec ? ' ' + a.spec : '') + (a.partLength ? ' ' + a.partLength + 'mm' : '');
      return `<button type="button" onclick="App.onAccessoryCard(${i})" data-idx="${i}"
        class="acc-card flex items-center justify-between px-3 py-2 bg-white border-b border-gray-100 text-left active:bg-green-50 transition-colors">
        <span class="text-xs font-bold text-gray-700">${label || '부속품'}</span>
        <span class="text-xs font-extrabold text-green-600">${UI.formatCurrency(a.unitPrice)}</span>
      </button>`;
    }).join('');
    accGroup.classList.remove('hidden');
  }

  function onAccessoryCard(index) {
    const accessories = getAccessoriesForType(_selType);
    const acc = accessories[index];
    if (!acc) return;

    items.push({
      type: acc.type,
      itemType: 'accessory',
      name: (acc.accessoryCategory || acc.partCategory || '부속품') + (acc.spec ? ' ' + acc.spec : ''),
      spec: acc.spec || '',
      unitPrice: Number(acc.unitPrice) || 0,
      installFee: 0,
      quantity: 1,
    });

    renderItems();
    updateTotal();
    saveDraft();
    UI.toast('부속품이 추가되었습니다', 'success');
  }

  // ======== 선반 추가 옵션 (모델 A) ========
  function onShelfAddonToggle() {
    const checked = document.getElementById('chk-shelf-addon')?.checked;
    const detail = document.getElementById('shelf-addon-detail');
    if (detail) detail.classList.toggle('hidden', !checked);
    if (checked) updateShelfAddonPreview();
  }

  function updateShelfAddonPreview() {
    if (!currentSelection || !currentSelection.shelfAddonPrice) return;
    const qty = Number(document.getElementById('shelf-addon-qty')?.value) || 1;
    const label = document.getElementById('shelf-addon-price-label');
    if (label) label.textContent = `@${UI.formatCurrency(currentSelection.shelfAddonPrice)} × ${qty} = ${UI.formatCurrency(currentSelection.shelfAddonPrice * qty)}`;
  }

  function onFormChip(form) {
    _selForm = form;
    currentSelection = null;
    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.add('hidden');
    const shelfAddon = document.getElementById('sel-shelf-addon');
    if (shelfAddon) shelfAddon.classList.add('hidden');

    // 형태 칩 활성 상태
    document.querySelectorAll('#chips-form .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === form);
    });

    const model = _getPricingModel(_selType);
    if (model === 'B') {
      _renderModelBSpecs();
    } else {
      renderSpecCards(_selType, form);
    }
  }

  // 모델 B 규격 카드: 배치 + 형태 조합으로 필터
  function _renderModelBSpecs() {
    if (!_selLayout || !_selForm) return;
    const specGroup = document.getElementById('sel-spec-group');
    const cardsContainer = document.getElementById('cards-spec');

    const specs = priceData.filter(p =>
      p.type === _selType &&
      (p.form || '') === _selForm &&
      (p.layoutType || '') === _selLayout &&
      !p.isAccessory
    );

    if (specs.length === 0) {
      specGroup.classList.remove('hidden');
      cardsContainer.innerHTML = '<p class="text-gray-400 text-xs text-center py-3">해당 조합의 규격이 없습니다</p>';
      return;
    }

    const sorted = [...specs].sort((a, b) => {
      if (_specSortMode === 'price') return (a.unitPrice || 0) - (b.unitPrice || 0);
      return (a.tier || 0) - (b.tier || 0);
    });

    specGroup.classList.remove('hidden');
    cardsContainer.innerHTML = sorted.map((p, i) => {
      const heightStr = p.spec || '';
      const tierStr = p.tier ? `${p.tier}단` : '';
      const panelStr = p.panelType ? `<span class="text-[10px] text-gray-400">${p.panelType}</span>` : '';
      return `<button type="button" onclick="App.onModelBSpecCard(${i})" data-idx="${i}"
        class="spec-card flex items-center justify-between px-3 py-2.5 bg-white border-b border-gray-100 text-left active:bg-green-50 transition-colors">
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold text-gray-800">${heightStr}</span>
          <span class="text-[10px] text-gray-400">${tierStr}</span>
          ${panelStr}
        </div>
        <span class="text-sm font-extrabold text-green-600">${UI.formatCurrency(p.unitPrice)}</span>
      </button>`;
    }).join('');
  }

  function onModelBSpecCard(index) {
    const specs = priceData.filter(p =>
      p.type === _selType &&
      (p.form || '') === _selForm &&
      (p.layoutType || '') === _selLayout &&
      !p.isAccessory
    );
    const sorted = [...specs].sort((a, b) => {
      if (_specSortMode === 'price') return (a.unitPrice || 0) - (b.unitPrice || 0);
      return (a.tier || 0) - (b.tier || 0);
    });
    currentSelection = sorted[index] || null;
    if (!currentSelection) return;

    document.querySelectorAll('.spec-card').forEach(el => {
      const isSelected = parseInt(el.dataset.idx) === index;
      el.classList.toggle('bg-green-50', isSelected);
      el.classList.toggle('bg-white', !isSelected);
    });

    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.remove('hidden');
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
    const parts = String(spec).split('*').map(s => parseInt(s, 10) || 9999);
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

    // 모델 A: 선반 추가 옵션 표시
    const shelfAddon = document.getElementById('sel-shelf-addon');
    if (shelfAddon) {
      if (currentSelection.shelfAddonPrice > 0) {
        shelfAddon.classList.remove('hidden');
        const chk = document.getElementById('chk-shelf-addon');
        if (chk) chk.checked = false;
        const detail = document.getElementById('shelf-addon-detail');
        if (detail) detail.classList.add('hidden');
        const qtyInput = document.getElementById('shelf-addon-qty');
        if (qtyInput) qtyInput.value = 1;
        updateShelfAddonPreview();
      } else {
        shelfAddon.classList.add('hidden');
      }
    }

    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.remove('hidden');
  }

  function addRecentQuick(index) {
    // topItems(빈도 기반) 또는 recentItems에서 선택
    var topItems = getTopItems(3);
    var quickItems = topItems.length > 0 ? topItems : getRecentItems();
    const r = quickItems[index];
    if (!r) return;
    _addQuickItem(r);
  }

  function _addPatternItem(index) {
    var r = _customerPatternItems[index];
    if (!r) return;
    _addQuickItem(r);
  }

  function _addQuickItem(r) {
    items.push({
      type: r.type,
      form: r.form || '',
      spec: String(r.spec),
      tier: r.tier,
      unitPrice: Number(r.unitPrice) || 0,
      installFee: Number(r.installFee) || 0,
      vat: r.vat || '별도',
      quantity: 1,
      pricingModel: r.pricingModel || _getPricingModel(r.type),
      layoutType: r.layoutType || '',
      setName: r.setName || '',
      partCategory: r.partCategory || '',
    });
    addItemFrequency(r);
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

    const sel = currentSelection;
    const newItem = {
      type: sel.type,
      form: sel.form || '',
      spec: sel.spec,
      tier: sel.tier,
      unitPrice: Number(sel.unitPrice) || 0,
      installFee: Number(sel.installFee) || 0,
      vat: sel.vat || '별도',
      quantity: currentQuantity,
      // 확장 필드 (모델별)
      pricingModel: sel.pricingModel || _getPricingModel(sel.type),
      layoutType: sel.layoutType || '',
      setName: sel.setName || '',
      partCategory: sel.partCategory || '',
    };
    items.push(newItem);
    addRecentItem(newItem);
    addItemFrequency(newItem);

    // 모델 A: 선반 추가 처리
    const chkShelf = document.getElementById('chk-shelf-addon');
    if (chkShelf && chkShelf.checked && sel.shelfAddonPrice > 0) {
      const shelfQty = Number(document.getElementById('shelf-addon-qty')?.value) || 1;
      items.push({
        type: sel.type,
        itemType: 'custom',
        name: `선반 추가 (${sel.spec || ''})`,
        unitPrice: Number(sel.shelfAddonPrice),
        installFee: 0,
        quantity: shelfQty,
      });
    }

    currentSelection = null;
    currentQuantity = 1;

    // 선택 UI 초기화
    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.add('hidden');
    const qtyInput = document.getElementById('qty-input');
    if (qtyInput) qtyInput.value = 1;

    // 칩/카드 전체 초기화
    _selType = '';
    _selForm = '';
    _selLayout = '';
    _selPartCat = '';
    document.querySelectorAll('#chips-type .chip').forEach(el => el.classList.remove('selected'));
    _hideAllSubGroups();

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

          if (isCustom || item.itemType === 'accessory') {
            const label = item.name || item.type || '항목';
            return `
              <div class="px-4 py-3 border-t border-gray-100 flex items-center gap-3 ${isNegative ? 'bg-red-50/50' : ''}">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-bold ${isNegative ? 'text-red-600' : 'text-gray-800'}">${label}</p>
                  <p class="text-xs text-gray-500">${item.quantity > 1 ? `@${UI.formatNumber(item.unitPrice)} × ${item.quantity}` : ''}</p>
                  <p class="text-sm font-bold ${isNegative ? 'text-red-600' : 'text-[#1e3a5f]'} mt-0.5">${UI.formatCurrency(itemTotal)}</p>
                </div>
                <button onclick="App.removeItem(${i})"
                  class="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 active:bg-red-50 text-lg flex-shrink-0">✕</button>
              </div>
            `;
          }
          // 랙 품목 (모델 A/B/C/D)
          const model = item.pricingModel || _getPricingModel(item.type);
          let itemLabel = `${item.type}${item.form ? '(' + item.form + ')' : ''} ${item.spec || ''}${item.tier ? '*' + item.tier + 's' : ''}`;
          if (model === 'D' && item.setName) itemLabel = `${item.type} ${item.setName} ${item.spec || ''}`;
          if (model === 'C' && item.partCategory) itemLabel = `${item.type} ${item.partCategory} ${item.spec || ''}`;
          if (item.layoutType) itemLabel += ` [${item.layoutType}]`;
          const feeStr = (Number(item.installFee) || 0) > 0 ? ` + 시공비 ${UI.formatCurrency((Number(item.installFee) || 0) * item.quantity)}` : '';
          const unitLabel = (model === 'C') ? '개' : '대';
          return `
            <div class="px-4 py-3 border-t border-gray-100 flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-gray-800 truncate">${itemLabel}</p>
                <p class="text-xs text-gray-500">@${UI.formatNumber(item.unitPrice)} × ${item.quantity}${unitLabel}${feeStr}</p>
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
    if (items.length === 0) return { supplyTotal: 0, vat: 0, total: 0, dcTotal: 0, items: [] };
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
    onTypeChip, onFormChip, onFormChipCustom, onSpecCard, addRecentQuick, sortSpecs, _addPatternItem, setCustomerPatternItems, renderRackSelector,
    // 모델 B
    onLayoutChip, onModelBSpecCard,
    // 모델 C
    onPartCatChip, onPartThicknessChip, onPartCard,
    // 모델 D
    onDModeSwitch, onDSetCard, onDPartCatChip, onDPartCard,
    // 부속품 + 선반
    onAccessoryCard, onShelfAddonToggle, updateShelfAddonPreview,
    get priceData() { return priceData; },
    get items() { return items; },
    set items(v) { items = v; },
  };
})();
