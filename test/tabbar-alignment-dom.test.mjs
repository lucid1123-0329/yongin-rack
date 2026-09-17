import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const appData = process.env.APPDATA || '';
const playwrightPath = path.join(appData, 'npm', 'node_modules', '@playwright', 'mcp', 'node_modules', 'playwright');
const { chromium } = require(playwrightPath);
const browserCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = browserCandidates.find(candidate => fs.existsSync(candidate));
assert.ok(executablePath, 'Chrome or Edge is required for the tab bar DOM test');

const uiSource = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const designCss = fs.readFileSync(new URL('../css/design.css', import.meta.url), 'utf8');
const utilityCss = `
  *{box-sizing:border-box} body{margin:0}
  .fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}
  .bottom-0{bottom:0}.left-0{left:0}.right-0{right:0}
  .flex{display:flex}.flex-1{flex:1 1 0%}.flex-col{flex-direction:column}
  .items-center{align-items:center}.justify-center{justify-content:center}
  .hidden{display:none!important}.w-6{width:24px}.h-6{height:24px}
`;

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<style>${utilityCss}\n${designCss}</style>`);
  await page.addScriptTag({ content: uiSource });
  await page.evaluate(() => UI.renderTabBar('requests'));

  const labels = await page.$$eval('nav > a', links => links.map(link => link.textContent.trim().replace(/\s+/g, ' ')));
  assert.deepEqual(labels, ['견적', '대시보드', '요청', '시공 사례', '더보기'], '시공 사례가 네 번째 탭이며 사진 탭은 숨김');

  const measure = () => page.$$eval('nav > a', links => links.map(link => {
    const cell = link.getBoundingClientRect();
    const iconWrap = link.querySelector('.tab-icon-wrap').getBoundingClientRect();
    const icon = link.querySelector('.tab-icon-wrap > svg').getBoundingClientRect();
    return {
      cellCenter: cell.left + cell.width / 2,
      wrapCenter: iconWrap.left + iconWrap.width / 2,
      iconCenter: icon.left + icon.width / 2,
      wrapWidth: iconWrap.width,
      wrapHeight: iconWrap.height,
    };
  }));

  const withoutBadge = await measure();
  assert.equal(withoutBadge.length, 5);
  withoutBadge.forEach((entry, index) => {
    assert.ok(Math.abs(entry.cellCenter - entry.iconCenter) <= 1, `tab ${index + 1} icon center is within 1px`);
    assert.ok(Math.abs(entry.cellCenter - entry.wrapCenter) <= 1, `tab ${index + 1} wrapper center is within 1px`);
    assert.equal(entry.wrapWidth, 24);
    assert.equal(entry.wrapHeight, 24);
  });

  await page.evaluate(() => {
    const badge = document.getElementById('req-badge');
    badge.textContent = '3';
    badge.classList.remove('hidden');
  });
  const withBadge = await measure();
  withBadge.forEach((entry, index) => {
    assert.ok(Math.abs(entry.cellCenter - entry.iconCenter) <= 1, `tab ${index + 1} remains centered with badge`);
    assert.equal(entry.iconCenter, withoutBadge[index].iconCenter, `tab ${index + 1} icon does not move`);
  });

  const badgeOffset = await page.$eval('#req-badge', badge => {
    const style = getComputedStyle(badge);
    return { top: style.top, right: style.right, position: style.position };
  });
  assert.deepEqual(badgeOffset, { top: '-6px', right: '-10px', position: 'absolute' });
} finally {
  await browser.close();
}

console.log('tab bar icon alignment DOM tests passed');
