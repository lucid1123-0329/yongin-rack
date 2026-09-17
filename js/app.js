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
  let draftClientId = null;
  let savePromise = null;

  function _wizardCall(method, value) {
    if (typeof window === 'undefined' || !window.EstimateWizard) return;
    const handler = window.EstimateWizard[method];
    if (typeof handler === 'function') handler(value);
  }

  function notifyItemAdded(item) {
    _wizardCall('onCartItemAdded', item);
  }

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
  async function loadPrices(force = false) {
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
    if (cacheIsFresh && !force) return;

    try {
      const data = await API.getPrices();
      if (data && data.prices) {
        priceData = data.prices;
        _lsSet('yr_prices_cache', JSON.stringify(priceData));
        _lsSet('yr_prices_cache_ts', String(Date.now()));
        renderRackSelector();
      }
    } catch (err) {
      if (force) throw err;
      if (!cached) {
        document.getElementById('price-area').innerHTML = UI.empty(
          '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.5a10 10 0 0 1 14 0M8 16a6 6 0 0 1 8 0m-4 4h.01"/></svg>', '단가를 불러올 수 없습니다',
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
    if (['고급경량랙','MD경량랙','경량랙','아연랙','MD중량랙','KD중량랙','중량랙'].indexOf(t) >= 0) return 'A';
    if (t === '하이퍼 진열대' || t.indexOf('하이퍼') >= 0) return 'B';
    if (t === '곤도라 진열대' || t.indexOf('곤도라') >= 0) return 'D';
    if (t === '파렛트랙' || t.indexOf('파렛트') >= 0 || t === '무볼트앵글' || t.indexOf('앵글') >= 0) return 'C';
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
  var FREQ_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  var FREQ_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;
  var FREQ_MIN_USES = 3;

  function _itemFrequencyKey(item) {
    return item.type + '|' + (item.form || '') + '|' + item.spec + '|' + item.tier;
  }

  function _readItemFrequency(now) {
    var currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    var cutoff = currentTime - FREQ_RETENTION_MS;
    var raw = {};
    try {
      raw = JSON.parse(_lsGet(FREQ_KEY) || '{}');
    } catch {
      raw = {};
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};

    var cleaned = {};
    var changed = false;
    Object.entries(raw).forEach(function(entry) {
      var key = entry[0];
      var value = entry[1];
      if (Array.isArray(value)) {
        var timestamps = value.map(Number).filter(function(timestamp) {
          return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= currentTime;
        });
        if (timestamps.length > 0) cleaned[key] = timestamps;
        if (JSON.stringify(timestamps) !== JSON.stringify(value)) changed = true;
      } else if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        // Legacy counts become one current use so old totals cannot qualify by themselves.
        cleaned[key] = [currentTime];
        changed = true;
      } else {
        changed = true;
      }
    });

    if (changed) _lsSet(FREQ_KEY, JSON.stringify(cleaned));
    return cleaned;
  }

  function addItemFrequency(item, now) {
    var currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    var freq = _readItemFrequency(currentTime);
    var key = _itemFrequencyKey(item);
    if (!Array.isArray(freq[key])) freq[key] = [];
    freq[key].push(currentTime);
    _lsSet(FREQ_KEY, JSON.stringify(freq));
  }

  function getTopItems(n, now) {
    try {
      var currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
      var windowStart = currentTime - FREQ_WINDOW_MS;
      var limit = Math.min(6, Math.max(1, Number(n) || 6));
      var freq = _readItemFrequency(currentTime);
      var entries = Object.entries(freq).map(function(entry) {
        var recentUses = entry[1].filter(function(timestamp) {
          return timestamp >= windowStart && timestamp <= currentTime;
        });
        return { key: entry[0], count: recentUses.length, lastUsed: recentUses.length ? Math.max.apply(null, recentUses) : 0 };
      }).filter(function(entry) {
        return entry.count >= FREQ_MIN_USES;
      }).sort(function(a, b) {
        return b.count - a.count || b.lastUsed - a.lastUsed || a.key.localeCompare(b.key);
      });
      var tops = [];
      for (var i = 0; i < entries.length && tops.length < limit; i++) {
        var parts = entries[i].key.split('|');
        var match = priceData.find(function(p) {
          return p.type === parts[0] && (p.form || '') === parts[1] && String(p.spec) === parts[2] && String(p.tier) === parts[3];
        });
        if (match) {
          tops.push({ type: match.type, form: match.form, spec: match.spec, tier: match.tier,
            unitPrice: match.unitPrice, installFee: match.installFee, vat: match.vat, _count: entries[i].count });
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
  let _recentItemsExpanded = false;

  function _quickItemTier(tier) {
    var value = String(tier || '').trim();
    if (!value) return '';
    var tierInParens = value.match(/\((\d+)\s*단\)/);
    if (tierInParens) return tierInParens[1] + '단';
    return /단$/.test(value) ? value : value + '단';
  }

  function _quickItemCard(item, index, handler, count) {
    var firstLine = item.type + (item.form ? ' · ' + item.form : '');
    var secondLine = String(item.spec || '').replace(/\*/g, '×');
    var tier = _quickItemTier(item.tier);
    if (tier) secondLine += ' · ' + tier;
    var priceLabel = UI.formatCurrency(item.unitPrice || 0);
    var thirdLine = priceLabel;
    if (count) thirdLine += ' · ' + count + '회';
    var countLabel = count ? ' (' + count + '회)' : '';
    return `<button type="button" onclick="App.${handler}(${index})" class="quick-item-card" aria-label="${firstLine} ${secondLine} ${priceLabel}${countLabel}">
      <span class="quick-item-card-title">${firstLine}</span>
      <span class="quick-item-card-spec">${secondLine}</span>
      <span class="quick-item-card-price">${thirdLine}</span>
    </button>`;
  }

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

    let html = '<div data-wizard-step="1" class="wizard-step-panel wizard-inactive">';

    var topItems = getTopItems(6);
    var recentItems = getRecentItems();
    html += '<div class="quick-item-sections">';

    if (topItems.length > 0) {
      html += `<div id="quick-frequent-section" class="quick-item-section">
        <label class="quick-item-heading">자주 사용</label>
        <div class="quick-item-row">
          ${topItems.map((item, index) => _quickItemCard(item, index, 'addFrequentlyUsedQuick', item._count)).join('')}
        </div>
      </div>`;
    }

    if (recentItems.length > 0) {
      if (topItems.length > 0) {
        html += `<button id="recent-items-toggle" type="button" class="recent-items-toggle" onclick="App.toggleRecentItems()" aria-expanded="${_recentItemsExpanded}">${_recentItemsExpanded ? '최근 사용 접기' : '최근 사용 보기'}</button>`;
      }
      html += `<div id="quick-recent-section" class="quick-item-section${topItems.length > 0 && !_recentItemsExpanded ? ' hidden' : ''}">
        <label class="quick-item-heading">최근 사용</label>
        <div class="quick-item-row">
          ${recentItems.map((item, index) => _quickItemCard(item, index, 'addRecentQuick')).join('')}
        </div>
      </div>`;
    }

    // 이 고객 패턴
    if (_customerPatternItems.length > 0) {
      html += `<div id="quick-customer-section" class="quick-item-section">
        <label class="quick-item-heading">이 고객 품목</label>
        <div class="quick-item-row">
          ${_customerPatternItems.slice(0, 5).map((item, index) => _quickItemCard(item, index, '_addPatternItem')).join('')}
        </div>
      </div>`;
    }
    html += '</div>';

    // 종류 칩
    const categories = getCategories();
    const allTypes = [...new Set([...RACK_TYPES, ...categories])];
    html += `<div class="mb-3">
      <label class="block text-xs font-semibold text-gray-500 mb-2">랙 종류</label>
      <div id="chips-type" class="wizard-type-grid">
        ${allTypes.map(t => `<span class="chip" onclick="App.onTypeChip('${t}')">${t}</span>`).join('')}
      </div>
    </div></div>`;

    // 형태 영역 (hidden) — 모델 A/B 공통
    html += `<div id="sel-form-group" data-wizard-step="2" class="wizard-step-panel wizard-inactive mb-3 hidden">
      <label class="block text-xs font-semibold text-gray-500 mb-2">형태</label>
      <div id="chips-form" class="flex flex-wrap gap-2"></div>
    </div>`;

    // 모델 B 배치유형 칩 (hidden)
    html += `<div id="sel-layout-group" data-wizard-step="2" class="wizard-step-panel wizard-inactive mb-3 hidden">
      <label class="block text-xs font-semibold text-gray-500 mb-2">배치유형</label>
      <div id="chips-layout" class="flex flex-wrap gap-2"></div>
    </div>`;

    // 규격 카드 영역 (hidden) — 모델 A/B 공통
    html += `<div id="sel-spec-group" data-wizard-step="2" class="wizard-step-panel wizard-inactive mb-3 hidden">
      <div id="spec-dim-filters" class="hidden mb-2 space-y-2" aria-label="치수 단계 선택"></div>
      <div class="flex items-center justify-between mb-2">
        <label class="block text-xs font-semibold text-gray-500">규격 선택</label>
        <div class="flex gap-1">
          <button type="button" onclick="App.sortSpecs('spec')" id="sort-spec-btn"
            class="text-[10px] px-2 py-0.5 rounded-full bg-primary text-white">규격순</button>
          <button type="button" onclick="App.sortSpecs('price')" id="sort-price-btn"
            class="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">가격순</button>
        </div>
      </div>
      <div id="cards-spec" class="flex flex-col gap-px max-h-[280px] overflow-y-auto overscroll-contain rounded-xl border-0 border-[#2F6BFF] bg-[#2F6BFF]"></div>
      <button type="button" id="toggle-unpriced-spec" onclick="App.toggleUnpriced()" class="unpriced-toggle hidden"></button>
    </div>`;

    // 선반 추가 옵션 (모델 A — hidden)
    html += `<div id="sel-shelf-addon" data-wizard-step="3" class="wizard-step-panel wizard-inactive mb-3 hidden">
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
    html += `<div id="sel-parts-group" data-wizard-step="2" class="wizard-step-panel wizard-inactive mb-3 hidden">
      <label class="block text-xs font-semibold text-gray-500 mb-2">부품 종류</label>
      <div id="chips-part-cat" class="flex flex-wrap gap-2 mb-3"></div>
      <div id="parts-thickness-area" class="hidden mb-3">
        <label class="block text-xs font-semibold text-gray-500 mb-2">두께</label>
        <div id="chips-part-thickness" class="flex flex-wrap gap-2"></div>
      </div>
      <div id="parts-list" class="hidden">
        <label class="block text-xs font-semibold text-gray-500 mb-2">길이별 단가</label>
      <div id="cards-parts" class="flex flex-col gap-px max-h-[280px] overflow-y-auto overscroll-contain rounded-xl border-0 border-[#2F6BFF] bg-[#2F6BFF]"></div>
      <button type="button" id="toggle-unpriced-parts" onclick="App.toggleUnpriced()" class="unpriced-toggle hidden"></button>
      </div>
    </div>`;

    // 모델 D: 세트/부품 선택 영역 (hidden)
    html += `<div id="sel-sets-group" data-wizard-step="2" class="wizard-step-panel wizard-inactive mb-3 hidden">
      <div class="flex gap-2 mb-3">
        <button type="button" onclick="App.onDModeSwitch('set')" id="d-mode-set"
          class="chip selected">세트 선택</button>
        <button type="button" onclick="App.onDModeSwitch('part')" id="d-mode-part"
          class="chip">부품 개별</button>
      </div>
      <div id="d-set-dim-filters" class="hidden mb-2 space-y-2" aria-label="세트 치수 단계 선택"></div>
      <div id="d-set-cards" class="flex flex-col gap-px max-h-[300px] overflow-y-auto overscroll-contain rounded-xl border-0 border-[#2F6BFF] bg-[#2F6BFF]"></div>
      <button type="button" id="toggle-unpriced-sets" onclick="App.toggleUnpriced()" class="unpriced-toggle hidden"></button>
      <div id="d-part-area" class="hidden">
        <label class="block text-xs font-semibold text-gray-500 mb-2">부품 종류</label>
        <div id="d-chips-part-cat" class="flex flex-wrap gap-2 mb-3"></div>
        <div id="d-parts-list" class="flex flex-col gap-px max-h-[280px] overflow-y-auto overscroll-contain rounded-xl border-0 border-[#2F6BFF] bg-[#2F6BFF]"></div>
        <button type="button" id="toggle-unpriced-d-parts" onclick="App.toggleUnpriced()" class="unpriced-toggle hidden"></button>
      </div>
    </div>`;

    // 부속품 추가 영역 (모든 모델 공통 — hidden)
    html += `<div id="sel-accessories" data-wizard-step="2" class="wizard-step-panel wizard-inactive mb-3 hidden">
      <label class="block text-xs font-semibold text-gray-500 mb-2">부속품 추가</label>
      <div id="cards-accessories" class="flex flex-col gap-px max-h-[200px] overflow-y-auto overscroll-contain rounded-xl border-0 border-[#2F6BFF] bg-[#2F6BFF]"></div>
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
  let _specWidthFilter = ''; // 이전 U4 공개 핸들러 호환용
  let _showUnpriced = false;
  let _dimSelection = { W: '', D: '', H: '' };

  function _isPriced(item) {
    return Number.isFinite(Number(item && item.unitPrice)) && Number(item && item.unitPrice) > 0;
  }

  function _priceVisible(items) {
    return (items || []).filter(item => _showUnpriced || _isPriced(item));
  }

  function _dimensionNumbers(value) {
    const matches = String(value || '').match(/\d[\d,]*/g) || [];
    return matches.map(value => Number(value.replace(/,/g, ''))).filter(Number.isFinite);
  }

  function _parseSpecDimensions(item) {
    if (!item) return null;
    const type = String(item.type || '').trim();
    const spec = String(item.spec || '').trim();
    const specNums = _dimensionNumbers(spec);
    const tierNums = _dimensionNumbers(item.tier);
    let W = 0, D = 0, H = 0;

    if (type.indexOf('하이퍼') >= 0) {
      W = specNums[0] || 0;
      if (spec.indexOf('*') >= 0 && specNums.length >= 2) {
        D = specNums[1];
      } else {
        const depthMatch = spec.match(/깊이\s*(\d[\d,]*)/);
        const oneSideDepth = depthMatch ? Number(depthMatch[1].replace(/,/g, '')) : 500;
        D = String(item.layoutType || '').indexOf('중앙') >= 0 ? oneSideDepth * 2 : oneSideDepth;
      }
      H = tierNums[0] || specNums[2] || 0;
    } else if (['고급경량랙', 'MD경량랙', 'MD중량랙', 'KD중량랙'].indexOf(type) >= 0) {
      D = specNums[0] || 0;
      W = specNums[1] || 0;
      H = specNums[2] || tierNums[0] || 0;
    } else if (specNums.length >= 3) {
      W = specNums[0];
      D = specNums[1];
      H = specNums[2];
    } else if (specNums.length >= 2 && tierNums.length) {
      D = specNums[0];
      W = specNums[1];
      H = tierNums[0];
    }

    return W > 0 && D > 0 && H > 0
      ? { W: String(W), D: String(D), H: String(H) }
      : null;
  }

  function _parseDSetDimensions(item) {
    if (!item) return null;
    const text = String(item.setName || item.spec || '').trim();
    const match = text.match(/^([^()]+)\(([^)]+)\)/);
    if (!match) return null;
    const nums = _dimensionNumbers(match[2]);
    if (nums.length < 3) return null;
    return {
      layout: String(item.layoutType || match[1]).trim(),
      W: String(nums[0]),
      D: String(nums[1]),
      H: String(nums[2])
    };
  }

  function _restoreDimSelection(type) {
    _dimSelection = { W: '', D: '', H: '' };
    try {
      const remembered = JSON.parse(_lsGet('yr_last_dims_' + type) || '{}');
      ['W', 'D', 'H'].forEach(axis => {
        _dimSelection[axis] = remembered[axis] ? String(remembered[axis]) : '';
      });
    } catch {}
  }

  function _saveDimSelection() {
    if (_selType) _lsSet('yr_last_dims_' + _selType, JSON.stringify(_dimSelection));
  }

  function _dimensionValues(items, axis, parser) {
    const values = [];
    (items || []).forEach(item => {
      const dims = parser(item);
      if (!dims) return;
      if (axis !== 'W' && _dimSelection.W && dims.W !== _dimSelection.W) return;
      if (axis === 'H' && _dimSelection.D && dims.D !== _dimSelection.D) return;
      values.push(dims[axis]);
    });
    return [...new Set(values)].sort((a, b) => Number(a) - Number(b));
  }

  function _normalizeDimSelection(items, parser) {
    const widths = _dimensionValues(items, 'W', parser);
    if (_dimSelection.W && !widths.includes(_dimSelection.W)) {
      _dimSelection = { W: '', D: '', H: '' };
    }
    const depths = _dimensionValues(items, 'D', parser);
    if (_dimSelection.D && !depths.includes(_dimSelection.D)) {
      _dimSelection.D = '';
      _dimSelection.H = '';
    }
    const heights = _dimensionValues(items, 'H', parser);
    if (_dimSelection.H && !heights.includes(_dimSelection.H)) _dimSelection.H = '';
  }

  function _matchesDimensions(item, parser) {
    const dims = parser(item);
    if (!dims) return true;
    return ['W', 'D', 'H'].every(axis =>
      !_dimSelection[axis] || dims[axis] === _dimSelection[axis]
    );
  }

  function _allDimensionsSelected() {
    return Boolean(_dimSelection.W && _dimSelection.D && _dimSelection.H);
  }

  function _renderDimensionFilters(containerId, items, parser, scope) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const parsedCount = (items || []).filter(item => parser(item)).length;
    if (parsedCount === 0) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }

    _normalizeDimSelection(items, parser);
    const labels = { W: '폭(W) mm', D: '깊이(D) mm', H: '높이(H) mm' };
    container.innerHTML = ['W', 'D', 'H'].map(axis => {
      const values = _dimensionValues(items, axis, parser);
      const buttons = ['', ...values].map(value => {
        const selected = value === _dimSelection[axis];
        const label = value || '전체';
        return '<button type="button" class="dim-chip' + (selected ? ' is-selected' : '') +
          '" aria-pressed="' + String(selected) + '" onclick="App.onDimensionChip(\'' +
          scope + '\',\'' + axis + '\',\'' + value + '\')">' + label + '</button>';
      }).join('');
      return '<div class="dim-filter-row"><span class="pt-3 text-xs font-semibold text-gray-500">' +
        labels[axis] + '</span><div class="dim-filter-options">' + buttons + '</div></div>';
    }).join('');
    container.classList.remove('hidden');
  }

  function onDimensionChip(scope, axis, value) {
    if (['W', 'D', 'H'].indexOf(axis) < 0) return;
    _dimSelection[axis] = String(value || '');
    if (axis === 'W') {
      _dimSelection.D = '';
      _dimSelection.H = '';
    } else if (axis === 'D') {
      _dimSelection.H = '';
    }
    _saveDimSelection();
    _clearCardSelection();
    if (scope === 'set') _renderDSetCards(_selType, true);
    else if (_getPricingModel(_selType) === 'B') _renderModelBSpecs(true);
    else renderSpecCards(_selType, _selForm, true);
  }

  function _clearCardSelection() {
    currentSelection = null;
    _wizardCall('onSelectionCleared');
    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.add('hidden');
    const shelfAddon = document.getElementById('sel-shelf-addon');
    if (shelfAddon) shelfAddon.classList.add('hidden');
  }

  function _renderUnpricedToggle(id, items) {
    const button = document.getElementById(id);
    if (!button) return;
    const count = (items || []).filter(item => !_isPriced(item)).length;
    button.classList.toggle('hidden', count === 0);
    button.textContent = _showUnpriced
      ? '단가 미입력 규격 ' + count + '개 숨기기'
      : '단가 미입력 규격 ' + count + '개 보기';
    button.setAttribute('aria-pressed', String(_showUnpriced));
  }

  function _unpricedBadge(item) {
    return _isPriced(item) ? '' : '<span class="v2-unpriced-badge">단가 미입력</span>';
  }

  function _setCardListOverflow(container, count) {
    if (!container) return;
    container.classList.toggle('overflow-y-auto', count > 3);
    container.classList.toggle('overflow-y-visible', count <= 3);
  }

  function _rejectUnpriced(item) {
    if (_isPriced(item)) return false;
    UI.toast('단가가 입력되지 않은 규격입니다. 더보기 > 단가 관리에서 단가를 넣어주세요.', 'warning', 5000);
    return true;
  }

  function toggleUnpriced() {
    _showUnpriced = !_showUnpriced;
    _clearCardSelection();
    const model = _getPricingModel(_selType);
    if (model === 'B') {
      _renderModelBSpecs();
    } else if (model === 'C') {
      if (_selPartCat) _renderPartCards();
    } else if (model === 'D') {
      if (_dMode === 'set') _renderDSetCards(_selType);
      else if (_selPartCat) onDPartCatChip(_selPartCat);
    } else {
      renderSpecCards(_selType, _selForm);
    }
  }

  function _autoSelectForm(type, forms) {
    if (!forms || forms.length === 0) return;
    const remembered = forms.length > 1 ? _lsGet('yr_last_form_' + type) : '';
    const nextForm = forms.length === 1 ? forms[0] : remembered;
    if (nextForm && forms.includes(nextForm)) onFormChip(nextForm);
  }

  function onTypeChip(type, options) {
    _selType = type;
    _selForm = '';
    _selLayout = '';
    _selPartCat = '';
    _selPartThickness = '';
    _specWidthFilter = '';
    _showUnpriced = false;
    _dimSelection = { W: '', D: '', H: '' };
    currentSelection = null;
    setQuantity(1);
    _hideAllSubGroups();

    // 타입 칩 활성 상태
    document.querySelectorAll('#chips-type .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === type);
    });

    const model = _getPricingModel(type);
    if (!options?.restoreOnly) _wizardCall('onTypeSelected', type);

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
    _autoSelectForm(type, allForms);
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
    _autoSelectForm(type, forms);
    const rememberedLayout = _lsGet('yr_last_layout_' + type);
    if (rememberedLayout && layouts.includes(rememberedLayout)) onLayoutChip(rememberedLayout);
  }

  function onLayoutChip(layout) {
    _clearCardSelection();
    _selLayout = layout;
    if (_selType && layout) _lsSet('yr_last_layout_' + _selType, layout);
    document.querySelectorAll('#chips-layout .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === layout);
    });
    if (_getPricingModel(_selType) === 'D') _renderDSetCards(_selType);
    else if (_selForm) _renderModelBSpecs();
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
    _clearCardSelection();
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
    _clearCardSelection();
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
    _renderUnpricedToggle('toggle-unpriced-parts', parts);
    parts = _priceVisible(parts);

    cardsContainer.innerHTML = parts.map((p, i) => {
      const label = p.spec || (p.partLength ? p.partLength + 'mm' : '');
      return `<button type="button" onclick="App.onPartCard('${_selPartCat}','${_selPartThickness}',${i})" data-idx="${i}"
        class="part-card min-h-16 flex items-center justify-between px-4 py-3 ${_isPriced(p) ? 'bg-white' : 'v2-unpriced-card'} border-b border-gray-200 text-left transition-colors">
        <span class="text-sm font-bold text-gray-800">${label}</span>${_unpricedBadge(p)}
        <span class="v2-money text-sm font-bold text-[#2F6BFF]">${UI.formatCurrency(p.unitPrice)}</span>
      </button>`;
    }).join('') || '<p class="text-gray-400 text-xs text-center py-3">등록된 부품이 없습니다</p>';
    listArea.classList.remove('hidden');
  }

  function onPartCard(cat, thickness, index) {
    let parts = getPartsForType(_selType).filter(p => p.partCategory === cat);
    if (thickness) parts = parts.filter(p => p.partThickness === thickness);
    parts.sort((a, b) => (a.partLength || 0) - (b.partLength || 0));
    parts = _priceVisible(parts);
    currentSelection = parts[index] || null;
    if (!currentSelection) return;
    if (_rejectUnpriced(currentSelection)) {
      currentSelection = null;
      return;
    }

    document.querySelectorAll('.part-card').forEach(el => {
      const isSelected = parseInt(el.dataset.idx) === index;
      el.classList.toggle('v2-selected', isSelected);
      el.classList.toggle('bg-white', !isSelected);
      el.classList.toggle('v2-selected-outline', isSelected);
      el.classList.toggle('v2-selected-check', isSelected);
    });

    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.remove('hidden');
    if (typeof EstimateWizard !== 'undefined') EstimateWizard.onSpecSelected(currentSelection);
  }

  // ======== 모델 D: 세트 선택 / 부품 개별 ========
  function _renderModelD(type) {
    const setsGroup = document.getElementById('sel-sets-group');
    setsGroup.classList.remove('hidden');
    _dMode = 'set';
    const layouts = [...new Set(getSetsForType(type).map(item => {
      const dims = _parseDSetDimensions(item);
      return String(item.layoutType || (dims && dims.layout) || '').trim();
    }).filter(Boolean))];
    const layoutGroup = document.getElementById('sel-layout-group');
    const layoutChips = document.getElementById('chips-layout');
    if (layouts.length) {
      layoutChips.innerHTML = layouts.map(layout =>
        '<span class="chip" onclick="App.onLayoutChip(\'' + layout + '\')">' + layout + '</span>'
      ).join('');
      layoutGroup.classList.remove('hidden');
      const rememberedLayout = _lsGet('yr_last_layout_' + type);
      const nextLayout = layouts.length === 1 ? layouts[0] : rememberedLayout;
      if (nextLayout && layouts.includes(nextLayout)) {
        _selLayout = nextLayout;
        Array.from(layoutChips.children).forEach(chip => {
          chip.classList.toggle('selected', chip.textContent === nextLayout);
        });
      }
    }
    _renderDSetCards(type);
  }

  function onDModeSwitch(mode) {
    _clearCardSelection();
    _dMode = mode;
    const layoutGroup = document.getElementById('sel-layout-group');
    document.getElementById('d-mode-set').classList.toggle('selected', mode === 'set');
    document.getElementById('d-mode-part').classList.toggle('selected', mode === 'part');

    if (mode === 'set') {
      if (layoutGroup && document.getElementById('chips-layout').children.length) layoutGroup.classList.remove('hidden');
      document.getElementById('d-set-cards').classList.remove('hidden');
      document.getElementById('d-part-area').classList.add('hidden');
      _renderDSetCards(_selType);
    } else {
      if (layoutGroup) layoutGroup.classList.add('hidden');
      document.getElementById('d-set-cards').classList.add('hidden');
      document.getElementById('d-part-area').classList.remove('hidden');
      _renderDPartCats(_selType);
    }
  }

  function _getDSetContext(type) {
    let sets = getSetsForType(type);
    if (_selLayout) {
      sets = sets.filter(item => {
        const dims = _parseDSetDimensions(item);
        return String(item.layoutType || (dims && dims.layout) || '').trim() === _selLayout;
      });
    }
    return sets;
  }

  function _getVisibleDSets(type) {
    return _priceVisible(_getDSetContext(type))
      .filter(item => _matchesDimensions(item, _parseDSetDimensions));
  }

  function _renderDSetCards(type, autoAdvance = false) {
    const container = document.getElementById('d-set-cards');
    const contextSets = _getDSetContext(type);
    const dimensionSets = _priceVisible(contextSets);
    _renderUnpricedToggle('toggle-unpriced-sets', contextSets);
    _renderDimensionFilters('d-set-dim-filters', dimensionSets, _parseDSetDimensions, 'set');
    const sets = _getVisibleDSets(type);

    if (sets.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-xs text-center py-3">등록된 세트가 없습니다</p>';
      return;
    }

    container.innerHTML = sets.map((s, i) => {
      const layoutBadge = s.layoutType ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">${s.layoutType}</span>` : '';
      const formBadge = s.form ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700">${s.form}</span>` : '';
      return `<button type="button" onclick="App.onDSetCard(${i})" data-idx="${i}"
        class="d-set-card min-h-16 flex items-center justify-between px-4 py-3 ${_isPriced(s) ? 'bg-white' : 'v2-unpriced-card'} border-b border-gray-200 text-left transition-colors">
        <div>
          <div class="flex items-center gap-1 mb-0.5">${layoutBadge}${formBadge}${_unpricedBadge(s)}</div>
          <span class="text-sm font-bold text-gray-800">${s.setName || s.spec || '세트'}</span>
          <span class="text-[10px] text-gray-400 ml-1">${s.spec || ''}</span>
        </div>
        <span class="v2-money text-sm font-bold text-[#2F6BFF]">${UI.formatCurrency(s.unitPrice)}</span>
      </button>`;
    }).join('');
    _setCardListOverflow(container, sets.length);
    if (autoAdvance && _allDimensionsSelected() && sets.length === 1 && _isPriced(sets[0])) onDSetCard(0);
  }

  function onDSetCard(index) {
    const sets = _getVisibleDSets(_selType);
    currentSelection = sets[index] || null;
    if (!currentSelection) return;
    if (_rejectUnpriced(currentSelection)) {
      currentSelection = null;
      return;
    }

    document.querySelectorAll('.d-set-card').forEach(el => {
      const isSelected = parseInt(el.dataset.idx) === index;
      el.classList.toggle('v2-selected', isSelected);
      el.classList.toggle('bg-white', !isSelected);
      el.classList.toggle('v2-selected-outline', isSelected);
      el.classList.toggle('v2-selected-check', isSelected);
    });

    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.remove('hidden');
    if (typeof EstimateWizard !== 'undefined') EstimateWizard.onSpecSelected(currentSelection);
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
    _clearCardSelection();
    _selPartCat = cat;
    document.querySelectorAll('#d-chips-part-cat .chip').forEach(el => {
      el.classList.toggle('selected', el.textContent === cat);
    });

    const container = document.getElementById('d-parts-list');
    let parts = getPartsForType(_selType).filter(p => p.partCategory === cat);
    parts.sort((a, b) => (a.partLength || a.unitPrice || 0) - (b.partLength || b.unitPrice || 0));
    _renderUnpricedToggle('toggle-unpriced-d-parts', parts);
    parts = _priceVisible(parts);

    container.innerHTML = parts.map((p, i) => {
      const label = p.spec || (p.partLength ? p.partLength + 'mm' : p.partCategory);
      return `<button type="button" onclick="App.onDPartCard('${cat}',${i})" data-idx="${i}"
        class="d-part-card min-h-16 flex items-center justify-between px-4 py-3 ${_isPriced(p) ? 'bg-white' : 'v2-unpriced-card'} border-b border-gray-200 text-left transition-colors">
        <span class="text-sm font-bold text-gray-800">${label}</span>${_unpricedBadge(p)}
        <span class="v2-money text-sm font-bold text-[#2F6BFF]">${UI.formatCurrency(p.unitPrice)}</span>
      </button>`;
    }).join('') || '<p class="text-gray-400 text-xs text-center py-3">등록된 부품이 없습니다</p>';
    container.classList.remove('hidden');
  }

  function onDPartCard(cat, index) {
    let parts = getPartsForType(_selType).filter(p => p.partCategory === cat);
    parts.sort((a, b) => (a.partLength || a.unitPrice || 0) - (b.partLength || b.unitPrice || 0));
    parts = _priceVisible(parts);
    currentSelection = parts[index] || null;
    if (!currentSelection) return;
    if (_rejectUnpriced(currentSelection)) {
      currentSelection = null;
      return;
    }

    document.querySelectorAll('.d-part-card').forEach(el => {
      const isSelected = parseInt(el.dataset.idx) === index;
      el.classList.toggle('v2-selected', isSelected);
      el.classList.toggle('bg-white', !isSelected);
    });

    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.remove('hidden');
    if (typeof EstimateWizard !== 'undefined') EstimateWizard.onSpecSelected(currentSelection);
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
        class="acc-card min-h-16 flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 text-left transition-colors">
        <span class="text-xs font-bold text-gray-700">${label || '부속품'}</span>
        <span class="v2-money text-xs font-bold text-[#2F6BFF]">${UI.formatCurrency(a.unitPrice)}</span>
      </button>`;
    }).join('');
    accGroup.classList.remove('hidden');
  }

  function onAccessoryCard(index) {
    const accessories = getAccessoriesForType(_selType);
    const acc = accessories[index];
    if (!acc) return;
    if (_rejectUnpriced(acc)) return;

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
    _wizardCall('onItemAdded', items[items.length - 1]);
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
    if (_selType && form) _lsSet('yr_last_form_' + _selType, form);
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
  function _renderModelBSpecs(autoAdvance = false) {
    if (!_selLayout || !_selForm) return;
    const specGroup = document.getElementById('sel-spec-group');
    const cardsContainer = document.getElementById('cards-spec');

    const contextSpecs = priceData.filter(p =>
      p.type === _selType &&
      (p.form || '') === _selForm &&
      (p.layoutType || '') === _selLayout &&
      !p.isAccessory
    );
    _renderUnpricedToggle('toggle-unpriced-spec', contextSpecs);
    const dimensionSpecs = _priceVisible(contextSpecs);
    _renderDimensionFilters('spec-dim-filters', dimensionSpecs, _parseSpecDimensions, 'spec');
    const specs = dimensionSpecs.filter(item => _matchesDimensions(item, _parseSpecDimensions));

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
        class="v2-spec-card spec-card min-h-16 flex items-center justify-between px-4 py-3 ${_isPriced(p) ? 'bg-white' : 'v2-unpriced-card'} border-b border-gray-200 text-left transition-colors">
        <div class="v2-spec-copy flex items-center gap-2">
          <span class="text-sm font-bold text-gray-800">${heightStr}</span>${_unpricedBadge(p)}
          <span class="text-[10px] text-gray-400">${tierStr}</span>
          ${panelStr}
        </div>
        <span class="v2-money v2-spec-price text-sm font-bold text-[#2F6BFF]">${UI.formatCurrency(p.unitPrice)}</span>
      </button>`;
    }).join('');
    _setCardListOverflow(cardsContainer, sorted.length);
    if (autoAdvance && _allDimensionsSelected() && sorted.length === 1 && _isPriced(sorted[0])) onModelBSpecCard(0);
  }

  function onModelBSpecCard(index) {
    const specs = _priceVisible(priceData.filter(p =>
      p.type === _selType &&
      (p.form || '') === _selForm &&
      (p.layoutType || '') === _selLayout &&
      !p.isAccessory
    )).filter(item => _matchesDimensions(item, _parseSpecDimensions));
    const sorted = [...specs].sort((a, b) => {
      if (_specSortMode === 'price') return (a.unitPrice || 0) - (b.unitPrice || 0);
      return (a.tier || 0) - (b.tier || 0);
    });
    currentSelection = sorted[index] || null;
    if (!currentSelection) return;
    if (_rejectUnpriced(currentSelection)) {
      currentSelection = null;
      return;
    }

    document.querySelectorAll('.spec-card').forEach(el => {
      const isSelected = parseInt(el.dataset.idx) === index;
      el.classList.toggle('v2-selected', isSelected);
      el.classList.toggle('bg-white', !isSelected);
    });

    const addSection = document.getElementById('add-section');
    if (addSection) addSection.classList.remove('hidden');
    if (typeof EstimateWizard !== 'undefined') EstimateWizard.onSpecSelected(currentSelection);
  }

  function onFormChipCustom() {
    const form = prompt('형태를 입력하세요:');
    if (!form || !form.trim()) return;
    _selForm = form.trim();
    currentSelection = null;

    document.querySelectorAll('#chips-form .chip').forEach(el => {
      el.classList.remove('selected');
      if (el.textContent === '기타') el.classList.add('selected');
    });

    if (_getPricingModel(_selType) === 'B') _renderModelBSpecs();
    else renderSpecCards(_selType, _selForm);
  }

  let _specSortMode = 'spec'; // 'spec' or 'price'

  function _getSpecWidth(item) {
    const dims = _parseSpecDimensions(item);
    return dims ? dims.W : '';
  }

  function _matchesSpecWidth(item) {
    return !_specWidthFilter || _getSpecWidth(item) === _specWidthFilter;
  }

  function _renderSpecWidthFilters(items) {
    let container = document.getElementById('spec-width-filters');
    if (!container) {
      const sortButton = document.getElementById('sort-spec-btn');
      if (!sortButton || !sortButton.parentElement || !sortButton.parentElement.parentElement) return;
      container = document.createElement('div');
      container.id = 'spec-width-filters';
      container.className = 'hidden flex flex-wrap gap-2';
      container.setAttribute('aria-label', '폭 빠른 필터');
      sortButton.parentElement.parentElement.insertBefore(container, sortButton.parentElement);
    }
    const model = _getPricingModel(_selType);
    if (model !== 'A' && model !== 'B') {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }
    const widths = [...new Set(items.map(_getSpecWidth).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b));
    if (_specWidthFilter && !widths.includes(_specWidthFilter)) _specWidthFilter = '';
    container.classList.toggle('hidden', widths.length === 0);
    container.innerHTML = '';
    ['', ...widths].forEach(width => {
      const button = document.createElement('button');
      const selected = width === _specWidthFilter;
      button.type = 'button';
      button.className = 'spec-width-chip' + (selected ? ' is-selected' : '');
      button.textContent = width ? 'W ' + width : '전체';
      button.setAttribute('aria-pressed', String(selected));
      button.addEventListener('click', () => filterSpecsByWidth(width));
      container.appendChild(button);
    });
  }

  function filterSpecsByWidth(width) {
    _clearCardSelection();
    _specWidthFilter = String(width || '');
    _dimSelection.W = _specWidthFilter;
    _dimSelection.D = '';
    _dimSelection.H = '';
    _saveDimSelection();
    if (_getPricingModel(_selType) === 'B') _renderModelBSpecs();
    else renderSpecCards(_selType, _selForm);
  }

  function sortSpecs(mode) {
    _specSortMode = mode;
    // 정렬 버튼 활성 상태 토글
    const specBtn = document.getElementById('sort-spec-btn');
    const priceBtn = document.getElementById('sort-price-btn');
    if (specBtn && priceBtn) {
      specBtn.className = mode === 'spec'
        ? 'text-[10px] px-2 py-0.5 rounded-full bg-primary text-white'
        : 'text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600';
      priceBtn.className = mode === 'price'
        ? 'text-[10px] px-2 py-0.5 rounded-full bg-primary text-white'
        : 'text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600';
    }
    if (_getPricingModel(_selType) === 'B') _renderModelBSpecs();
    else renderSpecCards(_selType, _selForm);
  }

  function _parseSpecDims(spec) {
    if (!spec) return [9999, 9999, 9999];
    const parts = String(spec).split('*').map(s => parseInt(s, 10) || 9999);
    return [parts[0] || 9999, parts[1] || 9999, parts[2] || 9999]; // 가로, 세로, 높이
  }

  function renderSpecCards(type, form, autoAdvance = false) {
    const specGroup = document.getElementById('sel-spec-group');
    const cardsContainer = document.getElementById('cards-spec');
    const allItems = getSpecsForTypeAndForm(type, form);
    _renderUnpricedToggle('toggle-unpriced-spec', allItems);
    const dimensionItems = _priceVisible(allItems);
    _renderDimensionFilters('spec-dim-filters', dimensionItems, _parseSpecDimensions, 'spec');
    const items = dimensionItems.filter(item => _matchesDimensions(item, _parseSpecDimensions));

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
        class="v2-spec-card spec-card min-h-16 flex items-center justify-between px-4 py-3 ${_isPriced(p) ? 'bg-white' : 'v2-unpriced-card'} border-b border-gray-200 text-left transition-colors"
        ><div class="v2-spec-copy flex items-center gap-2 min-w-0">
          <span class="text-sm font-bold text-gray-800">${p.spec || '규격 없음'}</span>${_unpricedBadge(p)}
          ${tierStr ? `<span class="text-[10px] text-gray-400 shrink-0">${tierStr}</span>` : ''}
        </div>
        <div class="v2-spec-price flex items-center gap-1 shrink-0 ml-2">
          <span class="v2-money text-sm font-bold text-[#2F6BFF]">${UI.formatCurrency(p.unitPrice || 0)}</span>
          ${feeStr}
        </div>
      </button>`;
    }).join('');
    _setCardListOverflow(cardsContainer, sorted.length);
    if (autoAdvance && _allDimensionsSelected() && sorted.length === 1 && _isPriced(sorted[0])) onSpecCard(idxMap[0]);
  }

  function onSpecCard(index) {
    const items = _priceVisible(getSpecsForTypeAndForm(_selType, _selForm))
      .filter(item => _matchesDimensions(item, _parseSpecDimensions));
    currentSelection = items[index] || null;
    if (!currentSelection) return;
    if (_rejectUnpriced(currentSelection)) {
      currentSelection = null;
      return;
    }

    // 행 활성 상태
    document.querySelectorAll('.spec-card').forEach(el => {
      const isSelected = parseInt(el.dataset.idx) === index;
      el.classList.toggle('v2-selected', isSelected);
      el.classList.toggle('bg-white', !isSelected);
      el.classList.toggle('v2-selected-outline', isSelected);
      el.classList.toggle('v2-selected-check', isSelected);
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
    if (typeof EstimateWizard !== 'undefined') EstimateWizard.onSpecSelected(currentSelection);
  }

  function addRecentQuick(index) {
    const r = getRecentItems()[index];
    if (!r) return;
    _addQuickItem(r);
  }

  function addFrequentlyUsedQuick(index) {
    const r = getTopItems(6)[index];
    if (!r) return;
    _addQuickItem(r);
  }

  function toggleRecentItems() {
    _recentItemsExpanded = !_recentItemsExpanded;
    var section = document.getElementById('quick-recent-section');
    var button = document.getElementById('recent-items-toggle');
    if (section) section.classList.toggle('hidden', !_recentItemsExpanded);
    if (button) {
      button.textContent = _recentItemsExpanded ? '최근 사용 접기' : '최근 사용 보기';
      button.setAttribute('aria-expanded', String(_recentItemsExpanded));
    }
  }

  function _addPatternItem(index) {
    var r = _customerPatternItems[index];
    if (!r) return;
    _addQuickItem(r);
  }

  function _addQuickItem(r) {
    // Stored shortcuts are hints, not a second price table.
    const matches = priceData.filter(p => !p.isAccessory && p.type === r.type &&
      (p.form || '') === (r.form || '') && String(p.spec || '') === String(r.spec || '') &&
      String(p.tier || '') === String(r.tier || '') &&
      ['layoutType', 'setName', 'partCategory'].every(key => !r[key] || p[key] === r[key]));
    if (matches.length !== 1) {
      UI.toast('현재 단가표에서 품목을 확인할 수 없습니다. 종류와 규격을 다시 선택하세요.', 'warning');
      return;
    }
    r = matches[0];
    if (_rejectUnpriced(r)) return;
    _clearCardSelection();
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
    _wizardCall('onItemAdded', items[items.length - 1]);
  }

  // 음성 입력처럼 단가표 행이 이미 확정된 진입점에서 기존 담기 효과를 그대로 재사용한다.
  function addItemFromPrice(row, quantity) {
    if (!_isPriced(row)) {
      UI.toast('단가가 입력된 품목만 담을 수 있습니다', 'warning');
      return null;
    }
    const newItem = {
      type: row.type,
      form: row.form || '',
      spec: String(row.spec || ''),
      tier: row.tier,
      unitPrice: Number(row.unitPrice) || 0,
      installFee: Number(row.installFee) || 0,
      vat: row.vat || '별도',
      quantity: Math.max(1, Math.min(9999, parseInt(quantity, 10) || 1)),
      pricingModel: row.pricingModel || _getPricingModel(row.type),
      layoutType: row.layoutType || '',
      setName: row.setName || '',
      partCategory: row.partCategory || '',
    };
    items.push(newItem);
    addRecentItem(newItem);
    addItemFrequency(newItem);
    renderItems();
    updateTotal();
    saveDraft();
    UI.toast('품목이 추가되었습니다', 'success');
    notifyItemAdded(newItem);
    return newItem;
  }

  // --- 수량 ---
  function updateQuantitySubtotal() {
    const subtotal = document.getElementById('quantity-subtotal');
    if (!subtotal) return;
    const unitPrice = Number(currentSelection?.unitPrice) || 0;
    subtotal.textContent = '소계 ' + UI.formatCurrency(unitPrice * currentQuantity);
  }

  function setQuantity(q) {
    currentQuantity = Math.max(1, Math.min(9999, parseInt(q) || 1));
    const input = document.getElementById('qty-input');
    if (input) input.value = currentQuantity;
    updateQuantitySubtotal();
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

    // Read the visible value as well: mobile keyboards may not have blurred yet.
    setQuantity(document.getElementById('qty-input')?.value ?? currentQuantity);
    const sel = currentSelection;
    const chkShelf = document.getElementById('chk-shelf-addon');
    const includeShelf = Boolean(chkShelf?.checked && Number(sel.shelfAddonPrice) > 0);
    const shelfQty = Number(document.getElementById('shelf-addon-qty')?.value || 1);
    if (includeShelf && (!Number.isFinite(Number(sel.shelfAddonPrice)) || !Number.isInteger(shelfQty) || shelfQty < 1 || shelfQty > 9999)) {
      UI.toast('추가 선반 수량은 1~9999 사이의 정수로 입력하세요', 'warning');
      return;
    }
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
    if (includeShelf) {
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
    _wizardCall('onItemAdded', newItem);
  }

  // --- 자유 항목 추가 ---
  function addCustomItem() {
    const nameEl = document.getElementById('custom-name');
    const priceEl = document.getElementById('custom-price');
    const qtyEl = document.getElementById('custom-qty');
    const name = (nameEl?.value || '').trim();
    const price = Number(priceEl?.value) || 0;
    const qty = Number(qtyEl?.value || 1);

    if (!name) { UI.toast('항목명을 입력하세요', 'warning'); return; }
    if (!Number.isFinite(price) || price === 0) { UI.toast('금액을 입력하세요', 'warning'); return; }
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) { UI.toast('수량은 1~9999 사이의 정수로 입력하세요', 'warning'); return; }

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
    notifyItemAdded(items[items.length - 1]);
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
    if (!Number.isFinite(amount) || amount <= 0) { UI.toast('할인 금액을 입력하세요', 'warning'); return; }

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
    notifyItemAdded(items[items.length - 1]);
  }

  function addMargin() {
    calcMarginFromPct();
    const pctEl = document.getElementById('margin-pct');
    const amountEl = document.getElementById('margin-amount');
    const pct = Number(pctEl?.value) || 0;
    const amount = Number(amountEl?.dataset?.amount) || 0;
    if (!Number.isFinite(amount) || amount <= 0) { UI.toast('랙 품목과 마진율을 확인하세요', 'warning'); return; }

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
    notifyItemAdded(items[items.length - 1]);
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
      container.innerHTML = `
        <div class="wizard-empty-cart">
          <p>담은 품목이 없습니다 · 1단계에서 담아주세요</p>
          <button type="button" onclick="EstimateWizard.go(1)">품목 담기</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="bg-white rounded-xl border-0 border-[#2F6BFF] overflow-hidden">
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
              <div class="v2-estimate-item min-h-16 px-4 py-3 border-t border-gray-200 ${isNegative ? 'bg-red-50/50' : ''}">
                <div class="v2-estimate-item-copy">
                  <p class="v2-estimate-item-name text-sm font-bold ${isNegative ? 'text-red-600' : 'text-gray-800'}">${label}</p>
                  <p class="v2-estimate-item-meta text-xs text-gray-500">@${UI.formatNumber(item.unitPrice)} × ${item.quantity}</p>
                </div>
                <p class="v2-estimate-item-amount v2-money text-sm font-bold ${isNegative ? 'text-red-600' : 'text-[#2F6BFF]'}">${UI.formatCurrency(itemTotal)}</p>
                <button onclick="App.removeItem(${i})"
                  class="v2-estimate-item-remove flex items-center justify-center text-red-400 active:bg-red-50 text-lg flex-shrink-0">✕</button>
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
            <div class="v2-estimate-item min-h-16 px-4 py-3 border-t border-gray-200">
              <div class="v2-estimate-item-copy">
                <p class="v2-estimate-item-name text-sm font-bold text-gray-800">${itemLabel}</p>
                <p class="v2-estimate-item-meta text-xs text-gray-500">@${UI.formatNumber(item.unitPrice)} × ${item.quantity}${unitLabel}${feeStr}</p>
              </div>
              <p class="v2-estimate-item-amount v2-money text-sm font-bold text-[#2F6BFF]">${UI.formatCurrency(itemTotal)}</p>
              <button onclick="App.removeItem(${i})"
                class="v2-estimate-item-remove flex items-center justify-center text-red-400 active:bg-red-50 text-lg flex-shrink-0">✕</button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function loadItems(nextItems) {
    items = Array.isArray(nextItems) ? nextItems.map(item => ({ ...item })) : [];
    renderItems();
    updateTotal();
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
    _wizardCall('sync');
  }

  // --- 폼 상태 localStorage 임시 저장 ---
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const draft = {
        clientId: draftClientId,
        items,
        customer: getCustomerInfo(),
        wizard: typeof window !== 'undefined' && window.EstimateWizard?.getDraftState
          ? window.EstimateWizard.getDraftState()
          : null,
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
        draftClientId = data.clientId || null;
        return data;
      }
    } catch {}
    return null;
  }

  function clearDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    _lsRemove(DRAFT_KEY);
    draftClientId = null;
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
  function saveEstimate() {
    if (savePromise) return savePromise;
    savePromise = performSaveEstimate().finally(() => { savePromise = null; });
    return savePromise;
  }
  async function performSaveEstimate() {
    const { supplyTotal, vat, total, items: calcItems } = calculate();
    if (!calcItems || calcItems.length === 0) {
      UI.toast('품목을 추가하세요', 'warning');
      return null;
    }

    const customer = getCustomerInfo();
    const randomPart = (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(36)).join('').substr(0, 6)
      : Math.random().toString(36).substr(2, 6);
    const clientId = draftClientId || ('est-' + Date.now() + '-' + randomPart);
    draftClientId = clientId;
    // 응답 유실·새로고침 후에도 동일한 저장으로 처리하도록 송신 전에 저장.
    clearTimeout(draftTimer);
    _lsSet(DRAFT_KEY, JSON.stringify({ clientId, items, customer, timestamp: Date.now() }));
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
        if (result.duplicate) {
          sessionStorage.removeItem('yr-estimate-' + result.estimateId);
          UI.toast('앞선 요청에서 저장된 견적을 확인합니다. 추가 변경은 견적 수정에서 진행하세요.', 'info', 5000);
        } else {
        sessionStorage.setItem('yr-estimate-' + result.estimateId, JSON.stringify({
          ...data,
          estimateId: result.estimateId,
        }));
        }
      } catch(e) {}
      _wizardCall('markSaved');
      clearDraft();
      items = [];
    }
    return result;
  }

  function resetEstimate() {
    if ((items.length > 0 || currentSelection || Object.values(getCustomerInfo()).some(Boolean)) && !confirm('현재 작성 중인 견적을 초기화하시겠습니까?')) return;
    items = [];
    currentSelection = null;
    _selType = _selForm = _selLayout = _selPartCat = _selPartThickness = '';
    _dimSelection = { W: '', D: '', H: '' };
    _specWidthFilter = '';
    _showUnpriced = false;
    _dMode = 'set';
    setQuantity(1);
    _hideAllSubGroups();
    hideAllPresetAreas();
    ['custom-name', 'custom-price', 'margin-pct', 'dc-amount'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['custom-qty', 'shelf-addon-qty'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '1';
    });
    const shelfCheck = document.getElementById('chk-shelf-addon');
    if (shelfCheck) shelfCheck.checked = false;
    const marginAmount = document.getElementById('margin-amount');
    if (marginAmount) { marginAmount.dataset.amount = '0'; marginAmount.textContent = UI.formatCurrency(0); }
    renderRackSelector();
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
    _wizardCall('resetState');
    _wizardCall('go', 1);
    clearDraft();
  }

  return {
    loadPrices, setQuantity, changeQuantity, updateQuantitySubtotal,
    addItem, addItemFromPrice, addCustomItem, addPresetItem, setActivePreset,
    calcMarginFromPct, addMargin, addDiscount,
    removeItem, renderItems, loadItems,
    calculate, updateTotal, saveEstimate, resetEstimate,
    loadDraft, saveDraft, clearDraft, getCustomerInfo, notifyItemAdded,
    onTypeChip, onFormChip, onFormChipCustom, onSpecCard, addRecentQuick, addFrequentlyUsedQuick, toggleRecentItems, sortSpecs, filterSpecsByWidth, onDimensionChip, toggleUnpriced, _addPatternItem, setCustomerPatternItems, renderRackSelector,
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
    get currentSelection() { return currentSelection; },
    get selectedType() { return _selType; },
    set items(v) { items = v; },
  };
})();
