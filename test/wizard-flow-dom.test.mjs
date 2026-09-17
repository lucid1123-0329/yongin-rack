import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const indexSource = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

class ClassList {
  constructor(initial = []) { this.values = new Set(initial); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.add(name); else this.remove(name);
    return enabled;
  }
}

class Element {
  constructor(id = '', dataset = {}, classes = []) {
    this.id = id;
    this.dataset = dataset;
    this.classList = new ClassList(classes);
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.attributes = {};
    this.listeners = {};
    this.childrenBySelector = {};
    this.disabled = true;
    this.offsetWidth = 120;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  querySelector(selector) { return this.childrenBySelector[selector] || this.indicator || null; }
}

function extract(startText, endText) {
  const start = indexSource.indexOf(startText);
  const end = indexSource.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, startText + ' source must exist');
  return indexSource.slice(start, end);
}

const stepPanels = Array.from({ length: 6 }, (_, index) =>
  new Element('panel-' + (index + 1), { wizardStep: String(index + 1) }, ['wizard-inactive']));
const rangePanel = new Element('price-area', { wizardRange: '1-3' }, ['wizard-inactive']);
const stepLabels = ['종류', '규격', '수량', '추가', '고객', '확인'];
const stepLinks = Array.from({ length: 6 }, (_, index) => {
  const link = new Element('link-' + (index + 1), { stepLink: String(index + 1) });
  link.childrenBySelector.span = new Element('number-' + (index + 1));
  link.childrenBySelector.b = new Element('label-' + (index + 1));
  link.childrenBySelector.b.textContent = stepLabels[index];
  return link;
});
const elements = new Map();
['wizard-back', 'estimate-fixed-bar', 'wizard-panel-title', 'customer-form', 'customer-form-toggle',
  'wizard-selection-summary', 'selected-spec-summary', 'selected-spec-title', 'selected-spec-meta',
  'wizard-cart-summary', 'wizard-cart-summary-button', 'wizard-added-banner', 'wizard-added-banner-copy',
  'item-added-sheet', 'item-added-sheet-summary', 'cart-sheet', 'cart-sheet-items',
  'cart-sheet-supply', 'cart-sheet-vat', 'cart-sheet-total', 'cust-name', 'cust-phone',
  'btn-save', 'total-amount', 'total-detail', 'supply-amount', 'vat-amount', 'items-area']
  .forEach(id => elements.set(id, new Element(id)));
elements.get('wizard-back').classList.add('hidden');
elements.get('item-added-sheet').classList.add('hidden');
elements.get('cart-sheet').classList.add('hidden');
elements.get('customer-form').classList.add('hidden');
elements.get('customer-form-toggle').indicator = new Element('indicator');

const listeners = {};
const historyEntries = [];
let historyIndex = -1;
const history = {
  replaceState(state) {
    if (historyIndex < 0) { historyEntries.push(state); historyIndex = 0; }
    else historyEntries[historyIndex] = state;
  },
  pushState(state) {
    historyEntries.splice(historyIndex + 1);
    historyEntries.push(state);
    historyIndex += 1;
  },
  back() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    listeners.popstate?.({ state: historyEntries[historyIndex] });
  }
};

const pickedTypes = [];
const toasts = [];
let timerId = 0;
const timers = new Map();
const context = {
  console,
  location: { href: 'https://example.test/app/index.html' },
  history,
  document: {
    getElementById: id => elements.get(id) || null,
    querySelectorAll: selector => {
      if (selector === '[data-wizard-step]') return stepPanels;
      if (selector === '[data-wizard-range]') return [rangePanel];
      if (selector === '[data-step-link]') return stepLinks;
      return [];
    }
  },
  window: {
    scrollTo() {},
    addEventListener(name, handler) { listeners[name] = handler; }
  },
  setTimeout(handler, delay) { timerId += 1; timers.set(timerId, { handler, delay }); return timerId; },
  clearTimeout(id) { timers.delete(id); },
  UI: {
    formatCurrency: value => Number(value).toLocaleString('ko-KR') + '원',
    toast: message => toasts.push(message)
  },
  App: {
    items: [],
    currentSelection: null,
    calculate() {
      const calculated = this.items.map(item => ({ ...item,
        itemTotal: ((Number(item.unitPrice) || 0) + (Number(item.installFee) || 0)) * (Number(item.quantity) || 1) }));
      const supplyTotal = calculated.reduce((sum, item) => sum + item.itemTotal, 0);
      return { supplyTotal, vat: Math.round(supplyTotal * 0.1), total: Math.round(supplyTotal * 1.1), items: calculated };
    },
    getCustomerInfo: () => ({ name: elements.get('cust-name').value, phone: elements.get('cust-phone').value }),
    renderItems() {
      elements.get('items-area').innerHTML = this.items.length ? 'items' : '담은 품목이 없습니다 · 1단계에서 담아주세요 품목 담기';
    },
    saveDraft() {},
    selectedType: '',
    onTypeChip(type, options) {
      pickedTypes.push(type);
      this.selectedType = type;
      this.currentSelection = null;
      if (!options?.restoreOnly) context.EstimateWizard.onTypeSelected(type);
    }
  },
  syncEstimateFixedBar() {}
};
vm.createContext(context);
const wizardSource = extract('const EstimateWizard = (() => {', 'window.EstimateWizard = EstimateWizard;');
vm.runInContext(wizardSource + '\nthis.EstimateWizard = EstimateWizard;', context);

context.App.removeItem = index => {
  context.App.items.splice(index, 1);
  context.EstimateWizard.sync();
};
context.EstimateWizard.init(1);
assert.equal(context.EstimateWizard.step, 1);
stepLinks.forEach(link => assert.equal(link.disabled, false, 'all six step tabs stay available'));

context.EstimateWizard.go(3);
assert.equal(context.EstimateWizard.step, 1, 'step 3 without a type must route to step 1');
assert.equal(toasts.at(-1), '먼저 종류를 선택하세요');
context.EstimateWizard.go(1);
context.EstimateWizard.onTypeSelected('경량랙');
assert.equal(context.EstimateWizard.step, 2, 'type selection must auto-advance to step 2');
const rackItem = { type: '경량랙', form: '독립', spec: '1200*450*1800', tier: 5, unitPrice: 98700, quantity: 2 };
context.App.currentSelection = rackItem;
context.EstimateWizard.onSpecSelected(rackItem);
context.EstimateWizard.sync();
assert.equal(context.EstimateWizard.step, 3, 'spec selection must auto-advance to step 3');
assert.equal(elements.get('selected-spec-title').textContent, '경량랙 · 독립 · 1200×450×1800');
assert.equal(elements.get('selected-spec-meta').textContent, '단가 98,700원 · 5단');

history.back();
assert.equal(context.EstimateWizard.step, 2, 'one browser back must return to the previous step');
context.EstimateWizard.onSpecSelected(rackItem);
context.App.items = [rackItem];
context.App.currentSelection = null;
context.App.selectedType = '';
context.EstimateWizard.onItemAdded(rackItem);
assert.equal(elements.get('item-added-sheet').classList.contains('hidden'), false);
assert.equal(elements.get('wizard-added-banner').classList.contains('is-visible'), true, 'add banner must slide open');
assert.equal(elements.get('wizard-added-banner-copy').textContent, '경량랙 · 독립 · 1200×450×1800 × 2대 담김 (197,400원)');
const bannerTimer = [...timers.values()].find(timer => timer.delay === 2500);
assert.ok(bannerTimer, 'add banner must schedule a 2.5 second close');
bannerTimer.handler();
assert.equal(elements.get('wizard-added-banner').classList.contains('is-visible'), false);

context.EstimateWizard.chooseAfterAdd(4);
assert.equal(context.EstimateWizard.step, 4);
context.EstimateWizard.previous();
assert.equal(context.EstimateWizard.step, 2, 'after adding, back restores a usable spec selector');
assert.equal(context.App.selectedType, '경량랙');
context.EstimateWizard.go(4);
stepLinks.slice(0, 3).forEach(link => assert.equal(link.classList.contains('is-complete'), true, 'cart item completes steps 1–3'));
assert.equal(stepLinks[0].attributes['aria-label'], '1단계 종류 완료');
context.EstimateWizard.openCartSheet();
assert.equal(elements.get('cart-sheet').classList.contains('hidden'), false, 'header summary opens cart sheet');
assert.match(elements.get('cart-sheet-items').innerHTML, /App\.removeItem\(0\)/);
context.App.removeItem(0);
assert.match(elements.get('cart-sheet-items').innerHTML, /아직 담은 품목이 없습니다/);

context.App.items = [rackItem];
context.EstimateWizard.sync();
context.EstimateWizard.go(5);
assert.equal(stepLinks[3].classList.contains('is-complete'), true, 'leaving step 4 completes the optional step');
context.EstimateWizard.go(6);
assert.equal(stepLinks[4].classList.contains('is-skipped'), true, 'empty customer step is marked skipped');
context.App.items = [];
context.EstimateWizard.go(6);
assert.match(elements.get('items-area').innerHTML, /담은 품목이 없습니다 · 1단계에서 담아주세요/);
assert.match(elements.get('items-area').innerHTML, /품목 담기/);

context.App.items = [rackItem];
context.EstimateWizard.go(5);
elements.get('cust-name').value = '홍길동';
elements.get('cust-name').listeners.input();
context.EstimateWizard.go(6);
assert.equal(stepLinks[4].classList.contains('is-complete'), true, 'customer name input completes step 5');

const initialStepSource = extract('function getInitialWizardStep(', "document.addEventListener('DOMContentLoaded'");
vm.runInContext(initialStepSource + '\nthis.getInitialWizardStep = getInitialWizardStep;', context);
assert.equal(context.getInitialWizardStep('edit', 0), 6, 'from=edit must enter step 6');
assert.equal(context.getInitialWizardStep('request', 3), 1, 'from=request must enter step 1');
assert.equal(context.getInitialWizardStep('ai-analysis', 1), 6, 'AI analysis must enter step 6');
assert.equal(context.getInitialWizardStep('', 2), 6, 'restored draft with items must enter step 6');

const updateStart = appSource.indexOf('  function updateTotal()');
const updateEnd = appSource.indexOf('\n  function saveDraft()', updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart);
context.calculate = () => ({ supplyTotal: 100000, vat: 10000, total: 110000, items: [{}] });
context._wizardCall = () => {};
vm.runInContext(appSource.slice(updateStart, updateEnd) + '\nthis.updateTotal = updateTotal;', context);
context.updateTotal();
assert.equal(elements.get('btn-save').disabled, false, 'step 6 save button must enable when items exist');

assert.match(appSource, /_wizardCall\('onTypeSelected', type\)/);
assert.ok((appSource.match(/onSpecSelected\(currentSelection\)/g) || []).length >= 5,
  'all rack pricing models must connect selection to step 3');
assert.match(appSource, /_wizardCall\('onItemAdded', newItem\)/);
assert.match(indexSource, /class="wizard-step-fixed-actions wizard-inactive"[\s\S]*onclick="App\.addItem\(\)"/);
assert.match(indexSource, /data-step-link="6"/);

console.log('PASS H1–H3/H7 wizard tabs, summaries, add sheet, save enable, edit entry, browser back');
