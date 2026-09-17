import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/blog-draft.js', import.meta.url), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(`${source}\nthis.BlogDraft = BlogDraft;`, context);

const input = {
  storeName: '오프뷰티 울산점', location: '울산 중구 성남동', date: '2026-08-07',
  rackType: '경량랙', siteType: '뷰티매장', note: '3차 추가 설치',
};
const branding = { company: '중용', phone: '010-9999-8888' };
const result = context.BlogDraft.build(input, branding);

assert.equal(result.titles.length, 3, '제목 후보는 3개');
result.titles.forEach(title => assert.match(title, /울산/, '모든 제목에 지역 포함'));
assert.match(result.body, /✔️ 시공 개요\n시공 날짜: 2026년 8월7일\n시공 장소: 울산 중구 성남동\n주요 랙 종류: 경량랙/, '시공 개요 3줄 포함');
assert.equal([...result.body.matchAll(/[💡🛠️📏💰] \d\./gu)].length, 4, '장점 문단 4개 포함');
assert.match(result.body, /📞 문의 안내:[\s\S]*전화 문의: 010-9999-8888/, '문의 안내에 브랜딩 전화번호 포함');
assert.ok(result.hashtags.length >= 15 && result.hashtags.length <= 25, '해시태그는 15~25개');
result.hashtags.forEach(tag => {
  assert.ok(tag.startsWith('#'), '해시태그는 #으로 시작');
  assert.ok(!/\s/.test(tag), '해시태그에는 공백 없음');
});

const rackTypes = ['경량랙', '중량랙', '파렛트랙', '하이퍼 진열대', '곤도라 진열대', '무볼트앵글', '아연랙'];
rackTypes.forEach(rackType => {
  const draft = context.BlogDraft.build({ ...input, rackType }, branding);
  assert.match(draft.body, new RegExp(`주요 랙 종류: ${rackType}`), `${rackType} 개요 포함`);
  assert.equal((draft.body.match(/ \d\./g) || []).length, 4, `${rackType} 장점 문구 4개 존재`);
});

assert.deepEqual(context.BlogDraft.build(input, branding), context.BlogDraft.build(input, branding), '같은 입력은 같은 출력');
console.log('blog draft tests passed');
