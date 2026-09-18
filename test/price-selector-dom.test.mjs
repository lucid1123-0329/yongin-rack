import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appSource = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function functionSource(name) {
  const start = appSource.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' source must exist');
  const next = appSource.indexOf('\n  function ', start + 12);
  assert.ok(next > start, name + ' must be followed by another function');
  return appSource.slice(start, next);
}

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
  constructor(id, classes = []) {
    this.id = id;
    this.classList = new ClassList(classes);
    this.attributes = {};
    this.textContent = '';
    this.checked = false;
    this.value = '';
    this._innerHTML = '';
  }
  set innerHTML(value) { this._innerHTML = String(value); }
  get innerHTML() { return this._innerHTML; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

const elements = new Map();
[
  ['sel-spec-group', ['hidden']],
  ['cards-spec', []],
  ['spec-dim-filters', ['hidden']],
  ['toggle-unpriced-spec', ['hidden']],
  ['add-section', ['hidden']],
  ['sel-shelf-addon', ['hidden']],
  ['chk-shelf-addon', []],
  ['shelf-addon-detail', ['hidden']],
  ['shelf-addon-qty', []],
  ['shelf-addon-price-label', []]
].forEach(([id, classes]) => elements.set(id, new Element(id, classes)));

const fixture = [
  { type: '경량랙', form: '독립', spec: '900*450*1800', tier: 4, unitPrice: 100000 },
  { type: '경량랙', form: '독립', spec: '900*450*2100', tier: 5, unitPrice: 110000 },
  { type: '경량랙', form: '독립', spec: '900*600*1800', tier: 4, unitPrice: 120000 },
  { type: '경량랙', form: '독립', spec: '1200*450*1800', tier: 4, unitPrice: 130000 },
  { type: '경량랙', form: '독립', spec: '1500*700*2400', tier: 5, unitPrice: 0 }
];

const source = [
  'let quotePrices = new WeakMap();',
  'let pendingPriceEdit = null;',
  functionSource('withQuotePrice'),
  functionSource('openPriceEditor'),
  "let _dimSelection = { W: '', D: '', H: '' };",
  'let _showUnpriced = false;',
  "let _selType = '경량랙';",
  "let _selForm = '독립';",
  "let _specSortMode = 'spec';",
  'let currentSelection = null;',
  'let priceData = fixture;',
  functionSource('_isPriced'),
  functionSource('_priceVisible'),
  functionSource('_dimensionNumbers'),
  functionSource('_parseSpecDimensions'),
  functionSource('_parseDSetDimensions'),
  functionSource('_dimensionValues'),
  functionSource('_normalizeDimSelection'),
  functionSource('_matchesDimensions'),
  functionSource('_allDimensionsSelected'),
  functionSource('_renderDimensionFilters'),
  functionSource('onDimensionChip'),
  functionSource('_clearCardSelection'),
  functionSource('_renderUnpricedToggle'),
  functionSource('_unpricedBadge'),
  functionSource('_setCardListOverflow'),
  functionSource('_rejectUnpriced'),
  functionSource('_parseSpecDims'),
  functionSource('renderSpecCards'),
  functionSource('onSpecCard'),
  "function getSpecsForTypeAndForm(type, form) { return priceData.filter(item => item.type === type && item.form === form); }",
  "function _saveDimSelection() {}",
  "function _getPricingModel() { return 'A'; }",
  "function _renderModelBSpecs() {}",
  "function updateShelfAddonPreview() {}",
  'this.render = renderSpecCards;',
  'this.pick = onDimensionChip;',
  'this.getSelection = () => currentSelection;',
  'this.parseSpec = _parseSpecDimensions;',
  'this.parseSet = _parseDSetDimensions;',
  'this.select = onSpecCard;',
  'this.setShowUnpriced = value => { _showUnpriced = Boolean(value); };',
  "this.setData = (rows, type, form) => { priceData = rows; _selType = type; _selForm = form; _dimSelection = { W: '', D: '', H: '' }; currentSelection = null; };"
].join('\n');

const toasts = [];
const wizardSelections = [];
const context = {
  fixture,
  _wizardCall() {},
  UI: {
    formatCurrency: value => String(Number(value) || 0) + '원',
    toast: message => toasts.push(message)
  },
  document: {
    getElementById: id => elements.get(id) || null,
    querySelectorAll: () => []
  },
  EstimateWizard: { onSpecSelected: item => wizardSelections.push(item) }
};
vm.createContext(context);
vm.runInContext(source, context);

function valuesFor(axis) {
  const html = elements.get('spec-dim-filters').innerHTML;
  const pattern = new RegExp("onDimensionChip\\('spec','" + axis + "','(\\d+)'\\)", 'g');
  return [...html.matchAll(pattern)].map(match => Number(match[1]));
}

context.render('경량랙', '독립');
assert.deepEqual(valuesFor('W'), [900, 1200], 'W chips must match priced table rows');
assert.equal(elements.get('cards-spec').innerHTML.includes('1500*700*2400'), false, 'zero-price row must be hidden');
assert.equal(elements.get('toggle-unpriced-spec').textContent, '단가 미입력 규격 1개 보기');

context.pick('spec', 'W', '1200');
assert.deepEqual(valuesFor('D'), [450], 'D chips must cascade from W');
context.pick('spec', 'D', '450');
assert.deepEqual(valuesFor('H'), [1800], 'H chips must cascade from W and D');
context.pick('spec', 'H', '1800');

assert.equal(context.getSelection().spec, '1200*450*1800', 'the sole three-dimension match must auto-select');
assert.equal(elements.get('add-section').classList.contains('hidden'), false, 'auto-select must open quantity');
assert.equal(wizardSelections.at(-1).spec, '1200*450*1800', 'auto-selected spec must immediately advance through the wizard callback');
assert.equal((elements.get('cards-spec').innerHTML.match(/class="v2-spec-card/g) || []).length, 1);
const advancesBeforeRender = wizardSelections.length;
context.render('경량랙', '독립');
assert.equal(wizardSelections.length, advancesBeforeRender, 'restoring or sorting the same dimensions must not auto-advance');
context.pick('spec', 'W', '900');
context.pick('spec', 'D', '600');
context.pick('spec', 'H', '1800');
assert.equal(context.getSelection().spec, '900*600*1800', 'a different size of the same rack remains selectable');

context.setData(fixture, '경량랙', '독립');
context.setShowUnpriced(true);
elements.get('add-section').classList.add('hidden');
context.render('경량랙', '독립');
assert.equal(elements.get('cards-spec').innerHTML.includes('1500*700*2400'), true);
assert.equal(elements.get('cards-spec').innerHTML.includes('단가 미입력'), true);
context.select(4);
assert.equal(context.getSelection(), null, 'zero-price card must not become a cart selection');
assert.equal(elements.get('add-section').classList.contains('hidden'), true);
assert.equal(context.getSelection(), null, 'an unpriced row must wait for explicit price entry');
context.setShowUnpriced(false);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.parseSpec({ type: '고급경량랙', spec: '450*900', tier: '1800(5단)' }))),
  { W: '900', D: '450', H: '1800' }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.parseSpec({ type: '하이퍼 진열대', spec: '1200*600', tier: '2080(5단)', layoutType: '벽면' }))),
  { W: '1200', D: '600', H: '2080' }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.parseSet({ setName: '앤드(900*450*1380*4s)' }))),
  { layout: '앤드', W: '900', D: '450', H: '1380' }
);

console.log('PASS P1 zero-price hiding, H6 W/D/H auto-select wizard advance, P3 set parsing');

if (process.argv.includes('--live')) {
  const apiSource = fs.readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
  const urlMatch = apiSource.match(/const DEFAULT_URL = '([^']+)'/);
  assert.ok(urlMatch, 'DEFAULT_URL must exist');
  const response = await fetch(urlMatch[1] + '?action=getPrices');
  assert.ok(response.ok, 'live getPrices must return HTTP success');
  const payload = await response.json();
  assert.ok(Array.isArray(payload.prices), 'live getPrices must return prices');

  const lightRows = payload.prices.filter(item =>
    item.type === '경량랙' && !item.isAccessory
  );
  const forms = [...new Set(lightRows.map(item => item.form).filter(form => String(form).includes('독립')))];
  assert.ok(forms.length, 'live 경량랙 독립 form must exist');
  const liveForm = forms.sort((a, b) =>
    lightRows.filter(item => item.form === b).length - lightRows.filter(item => item.form === a).length
  )[0];
  const relevant = lightRows.filter(item => item.form === liveForm);
  const priced = relevant.filter(item => Number(item.unitPrice) > 0);
  const unpriced = relevant.filter(item => Number(item.unitPrice) <= 0);
  assert.ok(unpriced.length > 0, 'live 경량랙 독립 rows must include zero-price catalog entries');

  context.setData(payload.prices, '경량랙', liveForm);
  context.setShowUnpriced(false);
  elements.get('add-section').classList.add('hidden');
  context.render('경량랙', liveForm);
  const renderedCount = (elements.get('cards-spec').innerHTML.match(/class="v2-spec-card/g) || []).length;
  assert.equal(renderedCount, priced.length, 'live zero-price rows must be hidden by default');

  const expectedWidths = [...new Set(priced.map(context.parseSpec).filter(Boolean).map(dims => Number(dims.W)))]
    .sort((a, b) => a - b);
  assert.deepEqual(valuesFor('W'), expectedWidths, 'live W chips must equal getPrices values');

  const parsed = priced.map(item => ({ item, dims: context.parseSpec(item) })).filter(entry => entry.dims);
  const counts = new Map();
  parsed.forEach(entry => {
    const key = entry.dims.W + '|' + entry.dims.D + '|' + entry.dims.H;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const unique = parsed.find(entry =>
    counts.get(entry.dims.W + '|' + entry.dims.D + '|' + entry.dims.H) === 1
  );
  assert.ok(unique, 'live 경량랙 독립 data must contain a unique W/D/H card');
  context.pick('spec', 'W', unique.dims.W);
  context.pick('spec', 'D', unique.dims.D);
  context.pick('spec', 'H', unique.dims.H);
  assert.equal(context.getSelection().spec, unique.item.spec, 'live unique card must auto-select');
  assert.equal(elements.get('add-section').classList.contains('hidden'), false);
  console.log('PASS LIVE getPrices rows=' + payload.prices.length + ', unpriced=' +
    payload.prices.filter(item => Number(item.unitPrice) <= 0).length);
}
