import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../app/requests.html', import.meta.url), 'utf8');
const appSource = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .find(source => source.includes('let allRequests = []'));

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
  constructor(id = '') {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.dataset = {};
    this.classList = new ClassList();
  }
}

const requestList = new Node('request-list');
const requestSummary = new Node('request-summary');
const statuses = ['전체', '미처리', '연락완료', '견적발송', '완료'];
const tabs = statuses.map(status => {
  const node = new Node();
  node.dataset.status = status;
  node.className = 'req-tab';
  return node;
});
const elements = new Map([
  ['request-list', requestList],
  ['request-summary', requestSummary],
]);
let detailNodes = [];
let aiNodes = [];

const document = {
  hidden: false,
  addEventListener() {},
  createElement: () => new Node(),
  getElementById(id) { return elements.get(id) || null; },
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === '.req-tab') return tabs;
    if (selector === '.v2-request-detail') return detailNodes;
    if (selector === '.v2-request-detail:not(.hidden)') return detailNodes.filter(node => !node.classList.contains('hidden'));
    if (selector === '[id^="ai-result-"]:not(.hidden)') return aiNodes.filter(node => !node.classList.contains('hidden'));
    return [];
  },
};

let restoredScroll = null;
const window = {
  scrollY: 0,
  addEventListener() {},
  scrollTo(x, y) { restoredScroll = { x, y }; },
};

const escapeHtml = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const context = {
  document,
  window,
  navigator: { onLine: true },
  location: {},
  URLSearchParams,
  requestAnimationFrame: callback => callback(),
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  clearInterval() {},
  localStorage: { getItem: () => null, setItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Auth: { guard: () => true },
  API: {},
  UI: {
    escapeHtml,
    formatDate: value => String(value),
    empty: (_icon, title, description) => `<div class="v2-state-card"><h3>${title}</h3><p>${description}</p></div>`,
    renderTabBar() {}, updateRequestBadge() {}, markRequestsSeen() {}, skeleton: () => '', toast() {}, confirm() {},
  },
  console,
};

vm.createContext(context);
vm.runInContext(`${appSource}
this.__requests = { formatRequestPhone, splitRequestStatuses, renderRequestStatusBadges, renderRequests, captureRequestViewState, restoreRequestViewState };
this.__setRequests = value => { allRequests = value; };
this.__setFilter = value => { currentFilter = value; };`, context);

assert.equal(context.__requests.formatRequestPhone('1051306094'), '010-5130-6094');
assert.equal(context.__requests.formatRequestPhone('010-91721046'), '010-9172-1046');
assert.equal(context.__requests.formatRequestPhone('01091721046'), '010-9172-1046');
assert.equal(context.__requests.formatRequestPhone('010-1234-5678'), '010-1234-5678');

assert.deepEqual(
  Array.from(context.__requests.splitRequestStatuses('견적발송,연락완료')),
  ['견적발송', '연락완료'],
);
const splitBadges = context.__requests.renderRequestStatusBadges('견적발송,연락완료');
assert.equal((splitBadges.match(/v2-request-status-badge/g) || []).length, 2);
assert.match(splitBadges, /is-quoted[^>]*>견적발송/);
assert.match(splitBadges, /is-contacted[^>]*>연락완료/);

// The current live shape is three requests without optional site fields.
const liveLikeRequests = [
  { rowIndex: 2, name: '김고객', phone: '1051306094', rackType: '경량랙', quantity: 1, memo: '전화 주세요', status: '미처리', date: '2026-09-16' },
  { rowIndex: 3, name: '이고객', phone: '010-1234-5678', rackType: '중량랙', quantity: 2, status: '견적발송,연락완료', date: '2026-09-15' },
  { rowIndex: 4, name: '박고객', phone: '01091721046', status: '완료', estimateId: 'EST-1', date: '2026-09-14' },
];
context.__setRequests(liveLikeRequests);
context.__requests.renderRequests();
assert.equal((requestList.innerHTML.match(/<article class="request-card/g) || []).length, 3);
assert.equal(requestSummary.textContent, '미처리 1건 · 전체 3건');
assert.match(requestList.innerHTML, /010-5130-6094/);
assert.match(requestList.innerHTML, /href="tel:1051306094" onclick="handleCall\(2, '미처리'\)"/);
assert.equal((requestList.innerHTML.match(/<h3>고객이 남긴 내용<\/h3>/g) || []).length, 3);
assert.match(requestList.innerHTML, /남긴 내용이 없습니다/);
assert.match(requestList.innerHTML, /class="hidden" aria-hidden="true" tabindex="-1"[\s\S]*detail-arrow-2/);
assert.doesNotMatch(requestList.innerHTML, /id="detail-2" class="[^\"]*hidden/);

const injected = {
  rowIndex: 5,
  name: '현장 고객',
  phone: '010-91721046',
  company: '용인물류',
  address: '경기도 용인시',
  bizNumber: '123-45-67890',
  rackType: '경량랙',
  quantity: 1,
  memo: '1층 설치\n오후 방문',
  status: '견적발송,연락완료',
  spaceWidth: 5,
  spaceDepth: 10,
  spaceHeight: 4,
  spacePurpose: '창고',
  cargoType: '박스',
  cargoWeight: '20kg',
  photoUrls: 'https://example.com/site-a.jpg,https://drive.google.com/file/d/12345678901234567890/view',
  date: '2026-09-16',
};
context.__setRequests([...liveLikeRequests, injected]);
context.__requests.renderRequests();
assert.equal(requestSummary.textContent, '미처리 1건 · 전체 4건');
assert.match(requestList.innerHTML, /가로 5m × 세로 10m × 높이 4m/);
assert.match(requestList.innerHTML, /박스 · 20kg/);
assert.match(requestList.innerHTML, /1층 설치\n오후 방문/);
assert.match(requestList.innerHTML, /href="tel:010-91721046"/);
assert.match(requestList.innerHTML, /010-9172-1046/);
assert.equal((requestList.innerHTML.match(/class="v2-request-photo-link"/g) || []).length, 2);
assert.equal((requestList.innerHTML.match(/사진 보기/g) || []).length, 2);
assert.match(requestList.innerHTML, /target="_blank" rel="noopener noreferrer"/);
assert.match(requestList.innerHTML, /v2-ai-button/);

context.__setFilter('미처리');
context.__requests.renderRequests();
assert.equal((requestList.innerHTML.match(/<article class="request-card/g) || []).length, 1);
context.__setFilter('연락완료');
context.__requests.renderRequests();
assert.equal((requestList.innerHTML.match(/<article class="request-card/g) || []).length, 2);

const oldDetail = new Node('detail-2');
const oldAi = new Node('ai-result-2');
oldAi.innerHTML = '<div>saved analysis</div>';
detailNodes = [oldDetail];
aiNodes = [oldAi];
window.scrollY = 420;
const savedView = context.__requests.captureRequestViewState();
assert.deepEqual(Array.from(savedView.openDetails), ['detail-2']);
const newDetail = new Node('detail-2');
const newAi = new Node('ai-result-2');
newAi.classList.add('hidden');
detailNodes = [newDetail];
aiNodes = [newAi];
elements.set('ai-result-2', newAi);
context.__requests.restoreRequestViewState(savedView);
assert.equal(newAi.innerHTML, '', 'never restore raw analysis HTML by a movable sheet row number');
assert.equal(newAi.classList.contains('hidden'), true);
assert.deepEqual(restoredScroll, { x: 0, y: 420 });

context.__setFilter('전체');
context.__setRequests([{...injected, estimateId:'Q-SAVED', aiAnalysis:{savedAt:'2026-09-17T05:00:00Z', result:{analysis:'저장한 요약 <script>',reasoning:'통로 폭 확인',recommendedType:'경량랙'}}}]);
context.__requests.renderRequests();
assert.match(requestList.innerHTML, /저장된 분석/);
assert.match(requestList.innerHTML, /저장한 요약 &lt;script&gt;/);
assert.match(requestList.innerHTML, /AI 다시 분석/);
assert.doesNotMatch(requestList.innerHTML, /id="ai-result-5" class="hidden/);

assert.match(appSource, /setInterval\(loadRequests, 60000\)/, 'poll interval stays at 60 seconds');

console.log('requests DOM behavior tests passed');
