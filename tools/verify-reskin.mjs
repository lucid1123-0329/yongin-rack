import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
// main이 배포 후 이동해도 리스킨 전 원본 비교 기준을 유지한다.
const BASELINE_REF = '60ae8796960dcbb4628f4556ab5606decea0ab37';
// 관리자 페이지는 app/ 아래로 이동했다. main의 X.html은 app/X.html(있으면)과 비교한다.
const baselineHtmlFiles = new Set(gitList(BASELINE_REF, '.').filter((name) => name.endsWith('.html') && !name.includes('/')));
const htmlFiles = [...baselineHtmlFiles].sort();
function currentPath(file) {
  const moved = path.join('app', file);
  return fs.existsSync(path.join(repo, moved)) ? moved : file;
}
const rows = [];
const failures = [];

function git(args) {
  const safeRepo = repo.split(path.sep).join('/');
  const result = spawnSync('git', ['-c', 'safe.directory=' + safeRepo, ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'git command failed').trim());
  }
  return result.stdout.replace(/\r\n/g, '\n');
}

function gitList(ref, pattern) {
  const safeRepo = repo.split(path.sep).join('/');
  const result = spawnSync('git', ['-c', 'safe.directory=' + safeRepo, 'ls-tree', '-r', '--name-only', ref, '--', pattern], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'git command failed').trim());
  return result.stdout.replace(/\r\n/g, '\n').trim().split('\n').filter(Boolean);
}

function current(file) {
  const target = file.endsWith('.html') && baselineHtmlFiles.has(file) ? currentPath(file) : file;
  return fs.readFileSync(path.join(repo, target), 'utf8').replace(/\r\n/g, '\n');
}

function baseline(file) {
  return git(['show', BASELINE_REF + ':' + file]);
}

function pass(name, detail) {
  rows.push({ check: name, result: 'PASS', detail });
}

function fail(name, detail) {
  rows.push({ check: name, result: 'FAIL', detail });
  failures.push(name + ': ' + detail);
}

function report(name, problems, successDetail) {
  if (problems.length === 0) pass(name, successDetail);
  else fail(name, problems.join('; '));
}

function cleanDocument(html) {
  const noPassive = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
  const body = noPassive.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  return body ? body[1] : noPassive;
}

function parseAttrs(source) {
  const attrs = {};
  const attrRe = /([:@A-Za-z_][:@A-Za-z0-9_.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
  let match;
  while ((match = attrRe.exec(source))) {
    const name = match[1].toLowerCase();
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function parseTags(html) {
  const body = cleanDocument(html);
  const tags = [];
  const tagRe = /<([A-Za-z][A-Za-z0-9-]*)(\s[^<>]*?)?\/?>/g;
  let match;
  while ((match = tagRe.exec(body))) {
    tags.push({ name: match[1].toLowerCase(), attrs: parseAttrs(match[2] || '') });
  }
  return { body, tags };
}

function sortedSet(values) {
  return [...new Set(values)].sort();
}

function equalValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function missingFromSuperset(before, after) {
  const afterSet = new Set(after.map((value) => JSON.stringify(value)));
  return before.filter((value) => !afterSet.has(JSON.stringify(value)));
}

function visibleText(body) {
  const emoji = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
  const values = [];
  const textRe = />([^<]+)</g;
  let match;
  while ((match = textRe.exec('>' + body + '<'))) {
    const value = match[1].replace(emoji, '').replace(/\s+/g, ' ').trim();
    if (value) values.push(value);
  }
  return sortedSet(values);
}

function inputSignatures(tags) {
  return tags.filter((tag) => tag.name === 'input').map((tag) => ({
    id: tag.attrs.id || '',
    placeholder: tag.attrs.placeholder || '',
    type: tag.attrs.type || '',
    name: tag.attrs.name || '',
  }));
}

function selectSignatures(body) {
  const values = [];
  const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi;
  let selectMatch;
  while ((selectMatch = selectRe.exec(body))) {
    const attrs = parseAttrs(selectMatch[1]);
    const options = [];
    const optionRe = /<option\b[^>]*>([\s\S]*?)<\/option\s*>/gi;
    let optionMatch;
    while ((optionMatch = optionRe.exec(selectMatch[2]))) {
      options.push(optionMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
    }
    values.push({ id: attrs.id || '', name: attrs.name || '', option: '@select' });
    options.forEach((option) => values.push({ id: attrs.id || '', name: attrs.name || '', option }));
  }
  return values;
}

const htmlChecks = { ids: [], handlers: [], hrefs: [], scripts: [], text: [], inputs: [], selects: [] };

for (const file of htmlFiles) {
  if (!baselineHtmlFiles.has(file)) continue;
  const before = parseTags(baseline(file));
  const after = parseTags(current(file));
  const beforeIds = sortedSet(before.tags.map((tag) => tag.attrs.id).filter(Boolean));
  const afterIds = sortedSet(after.tags.map((tag) => tag.attrs.id).filter(Boolean));
  if (missingFromSuperset(beforeIds, afterIds).length) htmlChecks.ids.push(file);

  const handlerValues = (parsed) => sortedSet(parsed.tags.flatMap((tag) =>
    Object.entries(tag.attrs)
      .filter(([name]) => /^on[a-z]+$/.test(name))
      .map(([name, value]) => name + '=' + value),
  ));
  if (missingFromSuperset(handlerValues(before), handlerValues(after)).length) htmlChecks.handlers.push(file);

  const anchorHrefs = (parsed) => sortedSet(parsed.tags
    .filter((tag) => tag.name === 'a' && Object.hasOwn(tag.attrs, 'href'))
    .map((tag) => tag.attrs.href));
  // User-approved public consultation number migration; all other hrefs remain protected.
  const expectedHrefs = anchorHrefs(before).map(href =>
    ['request.html', 'portfolio-public.html'].includes(file) && /^tel:010-?3776-?1230$/.test(href)
      ? 'tel:0507-1482-1708' : href);
  if (missingFromSuperset(expectedHrefs, anchorHrefs(after)).length) htmlChecks.hrefs.push(file);

  const scriptSources = (parsed) => sortedSet(parsed.tags
    .filter((tag) => tag.name === 'script' && Object.hasOwn(tag.attrs, 'src'))
    .map((tag) => tag.attrs.src.replace(/\?v=\d+$/, '?v=@cache').replace(/^\/js\//, 'js/')));
  if (missingFromSuperset(scriptSources(before), scriptSources(after)).length) htmlChecks.scripts.push(file);

  // 2026-09-17 승인된 사실성 수정: 무료 홍보 문구만 정확히 대체 허용.
  const originalText = visibleText(before.body).map(text => file === 'portfolio-public.html' && text === '무료 견적 요청' ? '견적 요청' : text);
  if (missingFromSuperset(originalText, visibleText(after.body)).length) htmlChecks.text.push(file);
  if (missingFromSuperset(inputSignatures(before.tags), inputSignatures(after.tags)).length) htmlChecks.inputs.push(file);
  if (missingFromSuperset(selectSignatures(before.body), selectSignatures(after.body)).length) htmlChecks.selects.push(file);
}

report('HTML id superset', htmlChecks.ids, htmlFiles.length + ' files preserve every original id');
report('HTML inline handler superset', htmlChecks.handlers, htmlFiles.length + ' files preserve every original handler');
report('HTML anchor href superset', htmlChecks.hrefs, htmlFiles.length + ' files preserve every original href');
report('HTML script source superset', htmlChecks.scripts, htmlFiles.length + ' files preserve every original script path');
report('HTML visible text superset', htmlChecks.text, htmlFiles.length + ' files preserve every original label after emoji removal');
report('HTML input superset', htmlChecks.inputs, htmlFiles.length + ' files preserve every original input');
report('HTML select superset', htmlChecks.selects, htmlFiles.length + ' files preserve every original select and options');

const themeProblems = [];
for (const file of htmlFiles) {
  const html = current(file);
  const tailwindAt = html.indexOf('cdn.tailwindcss.com');
  const designAt = html.search(/href=["']\/?css\/design\.css\?v=83["']/);
  const styleAt = html.indexOf('<style');
  if (designAt < 0 || designAt < tailwindAt || (styleAt >= 0 && designAt > styleAt)) {
    themeProblems.push(file + ' link order');
  }
  if (!html.includes('cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css')) {
    themeProblems.push(file + ' font link');
  }
  if (html.includes('IBM+Plex+Sans+KR') || html.includes('IBM Plex Sans KR')) {
    themeProblems.push(file + ' IBM Plex remains');
  }
  if (!/fontFamily\s*:\s*\{[\s\S]*?sans\s*:\s*\[\s*['"]Pretendard['"]/.test(html)) {
    themeProblems.push(file + ' font family');
  }
  if (!/primary\s*:\s*['"]#2F6BFF['"]/.test(html) || !/accent\s*:\s*['"]#FF6B00['"]/.test(html)) {
    themeProblems.push(file + ' theme colors');
  }
  const cacheVersions = [...html.matchAll(/\?v=(\d+)/g)].map((match) => match[1]);
  if (cacheVersions.length === 0 || cacheVersions.some((version) => version !== '83')) {
    themeProblems.push(file + ' cache version');
  }
}
report('HTML v3 theme wiring', themeProblems, htmlFiles.length + ' files use Pretendard, v3 colors, and v83');

const emojiProblems = htmlFiles.filter((file) => /[\p{Extended_Pictographic}\uFE0F\u200D]/u.test(current(file)));
report('HTML inline SVG icons', emojiProblems, htmlFiles.length + ' files contain no emoji glyphs');

const versionData = JSON.parse(current('version.json'));
if (String(versionData.version) === '83') pass('version.json cache version', 'version is 83');
else fail('version.json cache version', 'expected 83, found ' + versionData.version);

function normalizeChangedLine(line) {
  return line
    .replace(/\b(class|className|style)="[^"]*"/g, '$1=""')
    .replace(/\b(class|className|style)='[^']*'/g, "$1=''")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .trim();
}

function changedLinesAreStringsOnly(diff) {
  const problems = [];
  let removed = [];
  let added = [];
  let hunk = '';
  const flush = () => {
    if (removed.length === 0 && added.length === 0) return;
    if (removed.length !== added.length) {
      problems.push(hunk + ' line count ' + removed.length + '/' + added.length);
    } else {
      for (let i = 0; i < removed.length; i += 1) {
        if (normalizeChangedLine(removed[i]) !== normalizeChangedLine(added[i])) {
          problems.push(hunk + ' non-string change: ' + removed[i] + ' => ' + added[i]);
        }
      }
    }
    removed = [];
    added = [];
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      flush();
      hunk = line;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed.push(line.slice(1));
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      added.push(line.slice(1));
    }
  }
  flush();
  return problems;
}

function sourceTokens(code) {
  const apiCalls = [...code.matchAll(/\bAPI\.([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => 'API.' + match[1]);
  const paramCalls = [...code.matchAll(/\.(?:get|set|has|delete)\(\s*['"]([^'"]+)['"]/g)].map((match) => 'param:' + match[1]);
  const queryKeys = [...code.matchAll(/[?&]([A-Za-z][\w-]*)=/g)].map((match) => 'query:' + match[1]);
  return sortedSet([...apiCalls, ...paramCalls, ...queryKeys]);
}

const jsFiles = git(['ls-tree', '-r', '--name-only', BASELINE_REF, '--', 'js'])
  .trim().split('\n').filter((name) => name.endsWith('.js'));
const behaviorFiles = [...baselineHtmlFiles, ...jsFiles];
const originalBehavior = sourceTokens(behaviorFiles.map(baseline).join('\n'));
const currentBehavior = sourceTokens(behaviorFiles.map(current).join('\n'));
// 승인된 보안 전환: URL hideMargin 신뢰 및 인증 없는 ?setup 온보딩 경로 폐지.
const retiredSecurityTokens = new Set(['param:hideMargin', 'query:setup']);
report('API and URL token superset', missingFromSuperset(originalBehavior, currentBehavior).filter(token => !retiredSecurityTokens.has(token)), 'original tokens preserved except explicitly retired insecure routes');

// api.js / Code.gs는 보안 개선 승인 범위. 변경 금지 대신 실행형 회귀 테스트를 강제.
const securityCheck = spawnSync(process.execPath, ['--test', 'test/security-regression.test.mjs'], { cwd: repo, encoding: 'utf8' });
report('Approved security changes', securityCheck.status === 0 ? [] : [securityCheck.stdout + securityCheck.stderr], 'server authorization, session, privacy and API error regressions pass');
for (const protectedFile of ['js/calc.js']) {
  const diff = git(['diff', '--no-ext-diff', BASELINE_REF, '--', protectedFile]);
  if (diff) fail(protectedFile + ' unchanged', 'diff detected');
  else pass(protectedFile + ' unchanged', '0 diff lines');
}

for (const protectedFile of ['js/version-check.js']) {
  const diff = git(['diff', '--no-ext-diff', BASELINE_REF, '--', protectedFile]);
  if (diff) fail(protectedFile + ' unchanged', 'diff detected');
  else pass(protectedFile + ' unchanged', '0 diff lines');
}
// app/ 이동에 따라 서비스워커 경로만 절대경로로 바뀐다.
for (const [protectedFile, from, to] of [
  ['js/sw-register.js', "register('sw.js')", "register('/sw.js')"],
  ['js/onesignal-init.js', "serviceWorkerPath: 'sw.js'", "serviceWorkerPath: '/sw.js'"],
]) {
  if (baseline(protectedFile).replace(from, to) === current(protectedFile)) pass(protectedFile + ' allowed changes', 'only the service worker path is absolute');
  else fail(protectedFile + ' allowed changes', 'changes beyond the service worker path detected');
}

const swBefore = baseline('sw.js');
const swAfter = current('sw.js');
const staticListRe = /const STATIC_ASSETS = \[[\s\S]*?\];/;
const expectedSw = swBefore
  .replace("const CACHE_NAME = 'yr-v64';", "const CACHE_NAME = 'yr-v83';")
  .replace(staticListRe, (swAfter.match(staticListRe) || [''])[0]);
const swListOk = (swAfter.match(staticListRe) || [''])[0].split('\n').every((line) =>
  !/^\s+'/.test(line) || /^\s+'\/(app\/[\w-]+\.html|index\.html|view\.html|request\.html|portfolio-public\.html|css\/design\.css|js\/[\w-]+\.js|OneSignalSDKWorker\.js|manifest\.json)?',$/.test(line));
if (expectedSw === swAfter && swListOk) {
  pass('sw.js allowed changes', 'CACHE_NAME and precache list updated for app/');
} else {
  fail('sw.js allowed changes', 'changes beyond CACHE_NAME and cases precache assets detected');
}

function functionSlice(code, name) {
  const start = code.indexOf('  function ' + name + '(');
  if (start < 0) return '';
  const next = code.indexOf('\n  function ', start + 12);
  return code.slice(start, next < 0 ? code.length : next);
}

const estimateBefore = baseline('js/estimate.js');
const estimateAfter = current('js/estimate.js').replace(/src="\/assets\/sign_rack\.png"/g, 'src="assets/sign_rack.png"');
for (const name of ['renderFormalQuotation', 'renderTransactionStatement', 'renderPreview']) {
  if (functionSlice(estimateBefore, name) === functionSlice(estimateAfter, name)) {
    pass('estimate.js ' + name, 'function body identical');
  } else {
    fail('estimate.js ' + name, 'function body differs');
  }
}

const design = current('css/design.css');
const allowedHex = new Set([
  '#F2F4F6', '#FFFFFF', '#E5E8EB', '#EEF0F2', '#191F28', '#4E5968', '#8B95A1',
  '#2F6BFF', '#2457D6', '#E8F0FF', '#FF6B00', '#1FA36B', '#E6F7EF', '#F04452', '#FEECEE',
  '#333D4B', '#FFF3E8', '#FEE500', '#3C1E1E',
]);
const hexes = [...design.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map((match) => match[0].toUpperCase());
const invalidHex = sortedSet(hexes.filter((hex) => !allowedHex.has(hex)));
report('design.css palette', invalidHex, 'only v3 palette colors remain');

const legacyCss = [
  ['border-radius:0', /border-radius\s*:\s*0(?:\s*!important)?\s*;/gi],
  ['1.5px solid', /1\.5px\s+solid/gi],
  ['old ink', /#1B1F24/gi],
  ['old canvas', /#EFEEEA/gi],
  ['13px-or-smaller', /font-size\s*:\s*(?:[0-9]|1[0-3])px/gi],
  ['color blend', /gradient/gi],
].flatMap(([label, pattern]) => pattern.test(design) ? [label] : []);
report('design.css v2 traces', legacyCss, '0 banned v2 declarations, undersized text, or color blends');

const requiredV3 = [
  '--r-card:20px', '--r-ctl:14px', '--r-chip:999px', '--r-sheet:24px',
  '--shadow-card:0 2px 12px rgba(25,31,40,.06)',
  '.wizard-progress button span', '.wizard-sheet-panel', '.v2-fixed-cta', '.yr-toast',
].filter((token) => !design.includes(token));
report('design.css v3 components', requiredV3, 'v3 tokens and key components are present');

console.log('| Check | Result | Detail |');
console.log('|---|---|---|');
for (const row of rows) {
  console.log('| ' + row.check + ' | ' + row.result + ' | ' + row.detail.replace(/\|/g, '\\|') + ' |');
}

if (failures.length > 0) {
  console.error('\nFailures:');
  for (const problem of failures) console.error('- ' + problem);
  process.exit(1);
}

console.log('\nAll reskin invariants passed.');
