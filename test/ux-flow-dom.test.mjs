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
  constructor(id = '') {
    this.id = id;
    this.textContent = '';
    this.disabled = false;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.classList = new ClassList();
  }
  set innerHTML(value) { this.children = []; this._innerHTML = value; }
  get innerHTML() { return this._innerHTML || ''; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  click() { this.listeners.click?.(); }
}

function sliceFunction(source, name, nextName) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('function ' + nextName + '(', start);
  assert.ok(start >= 0 && end > start, name + ' source must exist');
  return source.slice(start, end);
}

function testFixedTotalMirror() {
  const elements = new Map();
  ['btn-save', 'btn-save-fixed', 'fixed-total-amount', 'fixed-save-empty', 'fixed-save-ready', 'total-amount']
    .forEach(id => elements.set(id, new Element(id)));
  elements.get('fixed-save-ready').classList.add('hidden');
  elements.get('total-amount').textContent = '0원';
  elements.get('btn-save').textContent = '견적 저장';
  elements.get('btn-save').disabled = true;

  const start = indexSource.indexOf('function syncEstimateFixedBar()');
  const end = indexSource.indexOf('function initEstimateFixedBar()', start);
  const source = indexSource.slice(start, end);
  const context = {
    App: { items: [] },
    document: { getElementById: id => elements.get(id) || null },
    updateRecentEstimateVisibility() {}
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.syncEstimateFixedBar = syncEstimateFixedBar;', context);
  context.syncEstimateFixedBar();
  assert.equal(elements.get('fixed-save-empty').classList.contains('hidden'), false);
  assert.equal(elements.get('fixed-save-ready').classList.contains('hidden'), true);
  assert.equal(elements.get('btn-save-fixed').classList.contains('is-disabled'), true);
  assert.equal(elements.get('btn-save-fixed').classList.contains('is-enabled'), false);

  context.App.items.push({ type: '경량랙' });
  elements.get('total-amount').textContent = '1,234,500원';
  elements.get('btn-save').textContent = '견적 수정 저장';
  elements.get('btn-save').disabled = false;
  context.syncEstimateFixedBar();
  assert.equal(elements.get('fixed-total-amount').textContent, '총액 1,234,500원');
  assert.equal(elements.get('btn-save-fixed').textContent, '견적 수정 저장');
  assert.equal(elements.get('btn-save-fixed').disabled, false);
  assert.equal(elements.get('btn-save-fixed').classList.contains('is-enabled'), true);
  assert.equal(elements.get('btn-save-fixed').classList.contains('is-disabled'), false);
  assert.equal(elements.get('fixed-save-ready').classList.contains('flex'), true);
}

function testRememberedFormAutoSelection() {
  const store = new Map([['yr_last_form_파렛트랙', '연결']]);
  const selected = [];
  const context = {
    _lsGet: key => store.get(key) || null,
    onFormChip: form => selected.push(form)
  };
  vm.createContext(context);
  vm.runInContext(sliceFunction(appSource, '_autoSelectForm', 'onTypeChip') + '\nthis.auto = _autoSelectForm;', context);
  context.auto('단일랙', ['독립']);
  context.auto('파렛트랙', ['독립', '연결']);
  context.auto('기억없음', ['독립', '연결']);
  assert.deepEqual(selected, ['독립', '연결']);
}

function testQuantitySubtotal() {
  const elements = new Map([
    ['quantity-subtotal', new Element('quantity-subtotal')],
    ['qty-input', new Element('qty-input')]
  ]);
  const source = [
    'let currentSelection = { unitPrice: 98700 };',
    'let currentQuantity = 1;',
    sliceFunction(appSource, 'updateQuantitySubtotal', 'setQuantity'),
    sliceFunction(appSource, 'setQuantity', 'changeQuantity'),
    'this.update = updateQuantitySubtotal;',
    'this.setQuantity = setQuantity;'
  ].join('\n');
  const context = {
    document: { getElementById: id => elements.get(id) || null },
    UI: { formatCurrency: value => Number(value).toLocaleString('ko-KR') + '원' }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.update();
  assert.equal(elements.get('quantity-subtotal').textContent, '소계 98,700원');
  context.setQuantity(3);
  assert.equal(elements.get('qty-input').value, 3);
  assert.equal(elements.get('quantity-subtotal').textContent, '소계 296,100원');
}

function testWidthFilterDom() {
  const container = new Element('spec-width-filters');
  const specs = [
    { spec: '900*450*1800' },
    { spec: '1200*450*1800' },
    { spec: '1200*600*2100' },
    { spec: '1500*600*2100' }
  ];
  let model = 'A';
  let visible = [];
  const context = {
    document: {
      getElementById: id => id === 'spec-width-filters' ? container : null,
      createElement: () => new Element()
    },
    _selType: '경량랙',
    _selForm: '독립',
    _specWidthFilter: '',
    _dimSelection: { W: '', D: '', H: '' },
    _saveDimSelection: () => {},
    _getPricingModel: () => model,
    _parseSpecDimensions: item => {
      const width = String(item.spec || '').split('*')[0];
      return width ? { W: width } : null;
    }
  };
  vm.createContext(context);
  const helpers = [
    sliceFunction(appSource, '_getSpecWidth', '_matchesSpecWidth'),
    sliceFunction(appSource, '_matchesSpecWidth', '_renderSpecWidthFilters'),
    sliceFunction(appSource, '_renderSpecWidthFilters', 'filterSpecsByWidth'),
    sliceFunction(appSource, 'filterSpecsByWidth', 'sortSpecs'),
    'function renderSpecCards() { _renderSpecWidthFilters(specs); visible = specs.filter(_matchesSpecWidth); }',
    'function _renderModelBSpecs() { visible = specs.filter(_matchesSpecWidth); }',
    'this.renderFilters = _renderSpecWidthFilters;',
    'this.filterWidth = filterSpecsByWidth;',
    'this.getVisible = () => visible;'
  ].join('\n');
  context.specs = specs;
  vm.runInContext(helpers, context);

  context.renderFilters(specs);
  assert.deepEqual(container.children.map(button => button.textContent), ['전체', 'W 900', 'W 1200', 'W 1500']);
  container.children[2].click();
  assert.deepEqual(context.getVisible().map(item => item.spec), ['1200*450*1800', '1200*600*2100']);
  model = 'B';
  context.filterWidth('900');
  assert.deepEqual(context.getVisible().map(item => item.spec), ['900*450*1800']);
}

for (const file of ['index.html', 'estimate-preview.html', 'dashboard.html', 'requests.html']) {
  const html = fs.readFileSync(new URL('../app/' + file, import.meta.url), 'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new vm.Script(match[1], { filename: file });
  }
}

new vm.Script(appSource, { filename: 'js/app.js' });
testFixedTotalMirror();
testRememberedFormAutoSelection();
testQuantitySubtotal();
testWidthFilterDom();
console.log('PASS H2/H5 subtotal + save-state mirror, H6 form memory, U4 width filter DOM simulations');
