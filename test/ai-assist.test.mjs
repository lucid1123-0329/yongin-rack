import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(file, extras = {}) {
  const store = {};
  const context = {
    console,
    localStorage: { getItem:key => store[key] || null, setItem:(key,value) => { store[key] = value; } },
    setTimeout, clearTimeout,
    ...extras,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), context);
  return context;
}

const priceData = [
  { type:'경량랙', form:'독립', spec:'1200*450*1800', tier:5, unitPrice:100000 },
  { type:'경량랙', form:'연결', spec:'1200*450*1800', tier:5, unitPrice:90000 },
  { type:'경량랙', form:'독립', spec:'900*450*1800', tier:5, unitPrice:80000 },
  { type:'경량랙', form:'독립', spec:'900*600*1800', tier:5, unitPrice:85000 },
  { type:'중량랙', form:'독립', spec:'900*450*1800', tier:4, unitPrice:120000 },
  { type:'고급경량랙', form:'독립형', spec:'450*1200', tier:'1800(5단)', unitPrice:140000 },
  { type:'아연랙', form:'독립', spec:'1000*500*2000', tier:4, unitPrice:110000 },
  { type:'파렛트랙', form:'독립', spec:'2000*1000*3000', tier:3, unitPrice:300000 },
  { type:'하이퍼 진열대', form:'벽면', spec:'900*500', tier:'1800(5단)', unitPrice:150000 },
  { type:'곤도라 진열대', form:'독립', spec:'1200*600*1500', tier:4, unitPrice:160000 },
  { type:'무볼트앵글', form:'독립', spec:'900*400*1800', tier:5, unitPrice:70000 },
];

const voice = load('../js/voice.js');
const V = voice.VoiceAdd;
[
  ['일',1],['십',10],['십오',15],['이십',20],['백',100],['백오십',150],
  ['천',1000],['천이백',1200],['이천오백',2500],['구백',900],
  ['하나',1],['둘',2],['셋',3],['세',3],['다섯',5],['아홉',9],
].forEach(([word,expected]) => assert.equal(V.koreanNumber(word), expected, word));

assert.equal(V.normalize('천이백 미리 사백오십 mm 천팔백'), '1200 450 1800');
assert.equal(V.normalize('세 대'), '3대');
assert.equal(V.normalize('셋'), '3');
assert.equal(V.normalize('다섯대'), '5대');
assert.equal(V.normalize('3 대'), '3대');
assert.equal(V.normalize('경량랙 그리고 중량랙'), '경량랙,중량랙');

let parsed = V.parse('경량랙 독립 천이백 사백오십 천팔백 세 대', priceData);
assert.equal(parsed.items[0].type, '경량랙');
assert.deepEqual([parsed.items[0].W,parsed.items[0].D,parsed.items[0].H], [1200,450,1800]);
assert.equal(parsed.items[0].quantity, 3);
assert.equal(parsed.items[0].form, '독립');
parsed = V.parse('고급경량랙 천이백 사백오십 천팔백', priceData);
assert.equal(parsed.items[0].form, '독립형');
assert.equal(parsed.items[0].defaultForm, true);
parsed = V.parse('경량랙 연결 1200 450 1800 5단 2대, 중량랙 900 450 1800 4단 1대', priceData);
assert.equal(parsed.items.length, 2);
assert.equal(parsed.items[1].form, '독립');
assert.equal(parsed.items[1].formKind, 'linked');
assert.equal(parsed.items[0].tier, 5);
assert.equal(parsed.items[1].quantity, 1);
assert.equal(V.parse('아연 1000 500 2000 4단 1대', priceData).items[0].type, '아연랙');
assert.equal(V.parse('팔레트 2000 1000 3000 3단 1대', priceData).items[0].type, '파렛트랙');
assert.equal(V.parse('하이퍼 벽면 900 500 1800 5단 1대', priceData).items[0].type, '하이퍼 진열대');
assert.equal(V.parse('곤도라 1200 600 1500 4단 1대', priceData).items[0].type, '곤도라 진열대');
assert.equal(V.parse('앵글 900 400 1800 5단 1대', priceData).items[0].type, '무볼트앵글');

let matched = V.matchItem(V.parse('경량랙 독립 1200 450 1800 5단 2대', priceData).items[0], priceData);
assert.equal(matched.status, 'exact');
matched = V.matchItem(V.parse('경량랙 독립 1000 450 1800 5단 2대', priceData).items[0], priceData);
assert.equal(matched.status, 'none');
assert.equal(matched.candidates.length, 2);
matched = V.matchItem(V.parse('경량랙 독립 1000 500 1800 5단 2대', priceData).items[0], priceData);
assert.equal(matched.candidates.length, 0);
matched = V.matchItem(V.parse('경량랙 1200 450 1800', priceData).items[0], priceData);
assert.equal(matched.status, 'default');

const pre = load('../js/precheck.js').Precheck;
const rack = { type:'경량랙',form:'독립',spec:'1200*450*1800',tier:5,unitPrice:100000,quantity:2 };
const baseHistory = { priceData, estimates:[] };
function codes(result) { return [...result.blocks,...result.warns].map(item => item.code); }
assert.ok(codes(pre.run([{...rack,unitPrice:0}],{name:'고객'},{total:0},baseHistory)).includes('unpriced'));
assert.ok(codes(pre.run([{...rack,spec:'111*222*333'}],{name:'고객'},{total:220000},baseHistory)).includes('unmatched'));
assert.ok(codes(pre.run([{...rack,quantity:0}],{name:'고객'},{total:0},baseHistory)).includes('quantity'));
assert.ok(codes(pre.run([{...rack,spec:''}],{name:'고객'},{total:0},baseHistory)).includes('dimensions'));
assert.ok(codes(pre.run([rack,{itemType:'custom',name:'D/C(할인)',unitPrice:-300000,quantity:1}],{name:'고객'},{total:-80000},baseHistory)).includes('discount'));
assert.ok(codes(pre.run([rack,{itemType:'custom',name:'마진(20%)',unitPrice:20000,quantity:1},{itemType:'custom',name:'마진(10%)',unitPrice:10000,quantity:1}],{name:'고객'},{total:250000},baseHistory)).includes('margin_duplicate'));
assert.ok(codes(pre.run([{...rack,form:'연결',unitPrice:90000}],{name:'고객'},{total:198000},baseHistory)).includes('linked_only'));
assert.ok(codes(pre.run([{...rack,quantity:101}],{name:'고객'},{total:11110000},baseHistory)).includes('quantity_outlier'));
assert.ok(codes(pre.run([rack],{name:'고객'},{total:600000},{priceData,estimates:[{customerName:'고객',total:100000,items:[rack]}]})).includes('total_outlier'));
assert.ok(codes(pre.run([rack,{...rack,quantity:3}],{name:'고객'},{total:550000},baseHistory)).includes('duplicate'));
assert.ok(codes(pre.run([rack,{itemType:'custom',name:'마진(2%)',unitPrice:4000,quantity:1}],{name:'고객'},{total:224400},baseHistory)).includes('margin_rate'));
assert.ok(codes(pre.run([rack],{name:''},{total:220000},baseHistory)).includes('customer_name'));
const merged = pre.mergeDuplicates([rack,{...rack,quantity:3}],pre.duplicateKey(rack));
assert.equal(merged.length,1);
assert.equal(merged[0].quantity,5);

const kakao = load('../js/kakao-message.js').KakaoMessage;
const message = kakao.build({ customerName:'김고객',date:'2026-09-16',total:1234000,items:[rack,{...rack,type:'중량랙',quantity:3}] },{phone:'010-1234-5678'});
assert.match(message,/안녕하세요, 김고객님/);
assert.match(message,/경량랙 외 1종 5대/);
assert.match(message,/1,234,000원 \(VAT 포함\)/);
assert.match(message,/2026\.10\.16/);
assert.match(message,/010-1234-5678/);
assert.equal(message.includes('₩'),false);

const indexHtml = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const previewHtml = fs.readFileSync(new URL('../app/estimate-preview.html', import.meta.url), 'utf8');
const requestsHtml = fs.readFileSync(new URL('../app/requests.html', import.meta.url), 'utf8');
assert.match(indexHtml,/id=[']voice-add-card[']/);
assert.match(indexHtml,/id=[']voice-result-sheet[']/);
assert.match(indexHtml,/id=[']precheck-sheet[']/);
assert.match(indexHtml,/js\/voice\.js\?v=\d+/);
assert.match(indexHtml,/js\/precheck\.js\?v=\d+/);
assert.doesNotMatch(previewHtml,/js\/voice\.js/);
assert.match(previewHtml,/js\/kakao-message\.js\?v=\d+/);
assert.match(previewHtml,/고객 연락처가 없습니다/);
assert.match(previewHtml,/문구 복사/);
assert.match(requestsHtml,/전화로 확인할 질문/);
assert.match(requestsHtml,/종류만 반영/);
assert.match(indexHtml,/oldApplyButton\.hidden = true/);

console.log('PASS voice parser 40+ assertions, matching, precheck 12 rules, Kakao fixed fields and DOM wiring');
