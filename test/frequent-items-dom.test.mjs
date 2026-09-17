import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appSource = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const cssSource = fs.readFileSync(new URL('../css/design.css', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const DAY = 24 * 60 * 60 * 1000;
const now = 2_000_000_000_000;

function item(number, count = 0) {
  return {
    type: '랙' + number,
    form: '독립',
    spec: '900*300*1800',
    tier: 5,
    unitPrice: 75300 + count
  };
}

function key(row) {
  return `${row.type}|${row.form}|${row.spec}|${row.tier}`;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function frequencyHarness(initial = {}) {
  const store = new Map([['yr_item_freq', JSON.stringify(initial)]]);
  const start = appSource.indexOf("var FREQ_KEY = 'yr_item_freq';");
  const end = appSource.indexOf('  // --- 고객 패턴 추천 ---', start);
  assert.ok(start >= 0 && end > start, 'frequency implementation must be extractable');
  const context = {
    priceData: Array.from({ length: 9 }, (_, index) => item(index + 1)),
    _lsGet: name => store.get(name) || null,
    _lsSet: (name, value) => store.set(name, value)
  };
  vm.createContext(context);
  vm.runInContext(appSource.slice(start, end) + '\nthis.top = getTopItems; this.addUse = addItemFrequency;', context);
  return { context, store };
}

// Q1: a legacy count migrates once to one timestamp and cannot qualify alone.
{
  const row = item(1);
  const { context, store } = frequencyHarness({ [key(row)]: 99 });
  assert.deepEqual(plain(context.top(6, now)), []);
  assert.deepEqual(JSON.parse(store.get('yr_item_freq'))[key(row)], [now]);

  context.addUse(row, now + 1);
  context.addUse(row, now + 2);
  assert.equal(context.top(6, now + 2)[0]._count, 3, 'each cart add must append one use time');
}

// Q1: 30-day retention and the inclusive 15-day window feed the three-use threshold.
{
  const row1 = item(1);
  const row2 = item(2);
  const { context, store } = frequencyHarness({
    [key(row1)]: [now - 31 * DAY, now - 15 * DAY, now - 2 * DAY, now],
    [key(row2)]: [now - 16 * DAY, now - 2 * DAY, now]
  });
  const tops = context.top(6, now);
  assert.deepEqual(plain(tops.map(row => [row.type, row._count])), [['랙1', 3]]);
  assert.equal(JSON.parse(store.get('yr_item_freq'))[key(row1)].includes(now - 31 * DAY), false);
}

// Q2: qualifying items sort by 15-day count descending and stop at six.
{
  const saved = {};
  for (let number = 1; number <= 7; number += 1) {
    const row = item(number);
    saved[key(row)] = Array.from({ length: number + 2 }, (_, index) => now - index * 1000);
  }
  const { context } = frequencyHarness(saved);
  const tops = context.top(6, now);
  assert.deepEqual(plain(tops.map(row => row.type)), ['랙7', '랙6', '랙5', '랙4', '랙3', '랙2']);
  assert.deepEqual(plain(tops.map(row => row._count)), [9, 8, 7, 6, 5, 4]);
}

class Element {
  constructor() {
    this.innerHTML = '';
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  setAttribute() {}
}

// Q2/Q3 DOM: recent remains separate, collapses behind the 48px toggle, and cards use display labels.
{
  const rackSelector = new Element();
  const recent = item(2);
  const frequent = item(1);
  const currentNow = Date.now();
  const store = new Map([
    ['yr_prices_cache', JSON.stringify([frequent, recent])],
    ['yr_prices_cache_ts', String(currentNow)],
    ['yr_recent_items', JSON.stringify([recent])],
    ['yr_item_freq', JSON.stringify({ [key(frequent)]: [currentNow - 2000, currentNow - 1000, currentNow] })]
  ]);
  const context = {
    localStorage: {
      getItem: name => store.get(name) || null,
      setItem: (name, value) => store.set(name, value),
      removeItem: name => store.delete(name)
    },
    document: {
      getElementById: id => id === 'rack-selector' ? rackSelector : null,
      querySelectorAll: () => []
    },
    UI: {
      formatCurrency: value => Number(value).toLocaleString('ko-KR') + '원',
      empty: () => '',
      toast() {}
    }
  };
  vm.createContext(context);
  vm.runInContext(appSource + '\nthis.TestApp = App;', context);
  await context.TestApp.loadPrices();

  assert.match(rackSelector.innerHTML, /id="quick-frequent-section"/);
  assert.match(rackSelector.innerHTML, /id="recent-items-toggle"[^>]*aria-expanded="false"[^>]*>최근 사용 보기</);
  assert.match(rackSelector.innerHTML, /id="quick-recent-section" class="quick-item-section hidden"/);
  assert.match(rackSelector.innerHTML, /900×300×1800 · 5단/);
  assert.match(rackSelector.innerHTML, /75,300원 · 3회/);

  store.set('yr_item_freq', '{}');
  context.TestApp.renderRackSelector();
  assert.doesNotMatch(rackSelector.innerHTML, /id="quick-frequent-section"/);
  assert.doesNotMatch(rackSelector.innerHTML, /id="recent-items-toggle"/);
  assert.match(rackSelector.innerHTML, /id="quick-recent-section" class="quick-item-section"/);
}

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cssSource.match(new RegExp(escaped + '\\s*\\{([^}]+)\\}'));
  assert.ok(match, selector + ' CSS rule must exist');
  return match[1].replace(/\s+/g, '');
}

const rowRule = rule('.quick-item-row');
for (const declaration of [
  'display:flex', 'overflow-x:auto', 'scroll-snap-type:xmandatory', 'gap:8px',
  'scrollbar-width:none', 'padding-right:20px'
]) assert.ok(rowRule.includes(declaration), declaration + ' must style the horizontal row');

const cardRule = rule('.quick-item-card');
for (const declaration of ['min-width:220px', 'height:64px', 'border-radius:14px', 'background:var(--fill)']) {
  assert.ok(cardRule.includes(declaration), declaration + ' must style each fixed card');
}
assert.ok(rule('.quick-item-sections').includes('max-height:33.333dvh'));
assert.ok(rule('.recent-items-toggle').includes('height:48px'));
assert.ok(indexSource.includes('id="rack-selector" class="rack-selector-root"'));

console.log('PASS Q1 frequency migration/window/threshold, Q2 sorting/max/collapse, Q3 horizontal card DOM styles');
