import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../app/dashboard.html', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
const appSource = inlineScripts.map(match => match[1]).find(source => source.includes('let allEstimates = []'));

class ClassList {
  constructor(initial = []) { this.values = new Set(initial); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.add(name); else this.remove(name);
    return enabled;
  }
}

class Node {
  constructor() {
    this.attributes = {};
    this.classList = new ClassList();
    this.dataset = {};
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.inert = false;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { this.focused = true; }
}

function makeCard(id) {
  const card = new Node();
  const summary = new Node();
  const collapse = new Node();
  const inner = new Node();
  inner.inert = true;
  card.dataset.estimateId = id;
  card.querySelector = selector => ({
    '.v2-estimate-card__summary': summary,
    '.v2-detail-collapse': collapse,
    '.v2-detail-collapse__inner': inner,
  }[selector] || null);
  return { card, summary, collapse, inner };
}

function makeStatusButton(status) {
  const button = new Node();
  const count = new Node();
  button.dataset.status = status;
  button.querySelector = selector => selector === '.status-count' ? count : null;
  return { button, count };
}

const searchInput = new Node();
const clearButton = new Node();
const list = new Node();
const cards = [makeCard('q1'), makeCard('q2')];
const statuses = ['전체', '상담완료', '계약', '시공중', '시공완료', '후속필요'].map(makeStatusButton);
const elements = new Map([
  ['search-input', searchInput],
  ['search-clear', clearButton],
  ['estimate-list', list],
]);

const document = {
  addEventListener() {},
  getElementById(id) { return elements.get(id) || null; },
  querySelectorAll(selector) {
    if (selector === '.v2-estimate-card') return cards.map(entry => entry.card);
    if (selector === '.status-tab') return statuses.map(entry => entry.button);
    return [];
  },
};

const context = {
  document,
  Event: class Event { constructor(type, options = {}) { this.type = type; this.bubbles = options.bubbles; } },
  Estimate: {
    calcTotals: estimate => ({ total: estimate.total || 0 }),
    share() {},
  },
  UI: {
    empty: (...args) => `<div class="v2-state-card">${args.join('|')}</div>`,
    escapeHtml: value => String(value || ''),
    formatCurrency: value => `${Number(value).toLocaleString('ko-KR')}원`,
    formatDate: value => value || '',
    skeleton: () => '',
    statusBadge: status => `<span class="status-badge">${status}</span>`,
    toast() {},
    confirm() {},
    renderTabBar() {},
  },
  API: {},
  Auth: { guard: () => true },
  localStorage: { getItem: () => null, setItem() {} },
  requestAnimationFrame: callback => callback(),
  setTimeout,
  console,
};

vm.createContext(context);
vm.runInContext(`${appSource}\nthis.__dashboard = { renderCard, renderDetail, toggleExpand, clearSearch, updateFilterCounts, filterEstimates }; this.__setEstimates = value => { allEstimates = value; };`, context);

const estimate = {
  estimateId: 'q1',
  customerName: '김고객',
  status: '계약',
  date: '2026-08-19',
  itemSummary: '경량랙 외 2종',
  totalQuantity: 3,
  total: 1200000,
  phone: '010-1234-5678',
  items: [{ type: '경량랙', spec: '1200*450*1800', quantity: 3, unitPrice: 400000, installFee: 0 }],
};

const cardHtml = context.__dashboard.renderCard(estimate);
assert.match(cardHtml, /onclick="toggleExpand\('q1'\)"/, 'card header keeps the expand handler');
assert.match(cardHtml, /event\.stopPropagation\(\);shareEstimate/, 'quick send stops header propagation');
assert.match(cardHtml, /v2-detail-collapse/, 'detail remains mounted for animation');
assert.match(cardHtml, /v2-card-arrow[\s\S]*?<svg/, 'card uses an SVG chevron');

const detailHtml = context.__dashboard.renderDetail(estimate);
assert.match(detailHtml, /is-current bg-primary text-white[^>]*aria-pressed="true">계약/, 'current status chip is highlighted');
assert.match(detailHtml, /href="tel:/, 'phone values render as tel links when present');
assert.match(detailHtml, /미입력/, 'missing contact values use the requested label');

context.__dashboard.toggleExpand('q1');
assert.equal(cards[0].card.classList.contains('is-expanded'), true, 'card opens');
assert.equal(cards[0].collapse.classList.contains('is-open'), true, 'detail animation class opens');
assert.equal(cards[0].summary.attributes['aria-expanded'], 'true');
assert.equal(cards[0].inner.inert, false);
context.__dashboard.toggleExpand('q1');
assert.equal(cards[0].card.classList.contains('is-expanded'), false, 'card closes');
assert.equal(cards[0].inner.inert, true);

context.__setEstimates([
  { ...estimate, estimateId: 'q1', status: '계약', date: '2000-01-01' },
  { ...estimate, estimateId: 'q2', status: '상담완료', date: '2000-01-01' },
  { ...estimate, estimateId: 'q3', status: '시공완료', date: '2000-01-01' },
]);
context.__dashboard.updateFilterCounts();
const countFor = status => statuses.find(entry => entry.button.dataset.status === status).count.textContent;
assert.equal(countFor('전체'), 3);
assert.equal(countFor('계약'), 1);
assert.equal(countFor('상담완료'), 1);
assert.equal(countFor('시공완료'), 1);
assert.equal(countFor('후속필요'), 2);

let inputEvents = 0;
searchInput.value = '김';
searchInput.dispatchEvent = event => {
  inputEvents += 1;
  assert.equal(event.type, 'input');
  assert.equal(event.bubbles, true);
  context.__dashboard.filterEstimates();
};
context.__dashboard.clearSearch();
assert.equal(searchInput.value, '');
assert.equal(searchInput.focused, true);
assert.equal(inputEvents, 1, 'clear dispatches the existing input event');
assert.match(list.innerHTML, /v2-estimate-card/, 'dispatched input event refreshes the list');

console.log('dashboard DOM behavior tests passed');
