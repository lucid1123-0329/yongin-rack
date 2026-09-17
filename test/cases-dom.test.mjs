import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightPath = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@playwright', 'mcp', 'node_modules', 'playwright');
const { chromium } = require(playwrightPath);
const browserCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = browserCandidates.find(candidate => fs.existsSync(candidate));
assert.ok(executablePath, 'Chrome or Edge is required for the cases DOM test');

const html = fs.readFileSync(new URL('../app/cases.html', import.meta.url), 'utf8');
const blogDraftSource = fs.readFileSync(new URL('../js/blog-draft.js', import.meta.url), 'utf8');
const uiSource = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const moreHtml = fs.readFileSync(new URL('../app/more.html', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
const appSource = inlineScripts.map(match => match[1]).find(source => source.includes('const BLOG_RSS_URL'));
assert.ok(appSource, 'cases app script exists');
assert.match(moreHtml, /href="portfolio\.html"[\s\S]*?시공 사진 업로드/, '더보기에서 사진 업로드 페이지에 접근 가능');
assert.match(uiSource, /id: 'portfolio'[\s\S]*?hidden: true/, '사진 탭 정의는 hidden으로 보존');

const sanitizedHtml = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', async route => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: sanitizedHtml });
    } else {
      await route.fulfill({ status: 200, body: '' });
    }
  });
  await page.goto('http://cases.test/app/cases.html');
  await page.addScriptTag({ content: blogDraftSource });
  await page.addScriptTag({ content: `
    window.Auth = { guard: () => true };
    window.UI = {
      renderTabBar: active => { window.__activeTab = active; },
      escapeHtml: value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      toast: message => { window.__toast = message; }
    };
    window.API = { getEstimates: async () => ({ estimates: [{
      estimateId: 'Q-1', customerName: '김고객', company: '오프뷰티 울산점', address: '울산 중구 성남동',
      date: '2026-08-07', statusChangedAt: '2026-08-08', status: '시공완료', itemSummary: 'MD경량랙', items: [{ type: 'MD경량랙' }]
    }] }) };
    window.fetch = async () => ({ json: async () => ({ status: 'error' }) });
    Element.prototype.scrollIntoView = function() {};
  ` });
  await page.addScriptTag({ content: appSource });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));

  await page.waitForSelector('[data-estimate-index="0"]');
  await page.click('[data-estimate-index="0"]');
  assert.equal(await page.inputValue('#store-name'), '오프뷰티 울산점', '견적 선택 시 현장 이름 자동 채움');
  assert.equal(await page.inputValue('#site-location'), '울산 중구 성남동', '견적 선택 시 주소 자동 채움');
  assert.equal(await page.inputValue('#site-date'), '2026-08-07', '견적 선택 시 날짜 자동 채움');
  assert.equal(await page.$eval('[data-rack="경량랙"]', element => element.classList.contains('is-selected')), true, '견적 품목으로 랙 종류 자동 선택');

  await page.click('#build-draft');
  await page.waitForSelector('#draft-result:not(.hidden)');
  assert.match(await page.inputValue('#draft-body'), /시공 개요[\s\S]*주요 랙 종류: 경량랙/, '초안 본문 생성');
  assert.equal(await page.locator('#draft-titles [data-title-index]').count(), 3, '제목 후보 3개 생성');
  assert.ok(await page.$('#copy-draft'), '제목과 본문 복사 버튼 존재');
  assert.ok(await page.$('#copy-hashtags'), '해시태그 복사 버튼 존재');
  assert.equal(await page.evaluate(() => window.__activeTab), 'cases', 'cases 탭 활성화');
} finally {
  await browser.close();
}

console.log('cases DOM behavior tests passed');
