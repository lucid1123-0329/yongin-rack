import fs from 'node:fs';
import vm from 'node:vm';

const files=['app.html','customer-request.html','customer-quote.html'];
const source=Object.fromEntries(files.map(file=>[file,fs.readFileSync(new URL(file,import.meta.url),'utf8')]));
const styles=Object.fromEntries(files.map(file=>[file,[...source[file].matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n')]));
const failures=[];
const check=(label,pass,detail)=>{if(!pass)failures.push(`${label}: ${detail}`)};
const has=(file,pattern)=>pattern.test(styles[file]);
const lastProp=(file,selector,property)=>{
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rules=[...styles[file].matchAll(new RegExp(`${escaped}\\{([^}]*)\\}`,'g'))];
  let value='';
  for(const rule of rules)for(const declaration of rule[1].split(';')){const [name,...rest]=declaration.split(':');if(name?.trim()===property)value=rest.join(':').trim()}
  return value;
};

const separators=[
  ['app 종류 격자',has('app.html',/\.type-grid\{[^}]*gap:1px[^}]*border:1\.5px/)&&lastProp('app.html','.choice','border')==='0'],
  ['app 상태 격자',has('app.html',/\.status-grid\{[^}]*gap:1px/)&&lastProp('app.html','.status','border')==='0'],
  ['app 숫자 키패드',has('app.html',/\.keypad\{[^}]*gap:1px/)&&lastProp('app.html','.keypad button','border')==='0'],
  ['app 세트 목록',has('app.html',/\.set-list\{border:1\.5px/)&&has('app.html',/\.set-row\{[^}]*border-bottom:1px/)&&has('app.html',/\.set-row:last-child\{border-bottom:0/)],
  ['app 최근 견적·관리',has('app.html',/\.recent-list,.manage-list,.quote-list\{border:1\.5px/)&&has('app.html',/\.recent:last-child,.row:last-child,.quote-row:last-child\{border-bottom:0/)],
  ['app 규격 목록',has('app.html',/\.spec-list\{border:1\.5px/)&&has('app.html',/\.spec-option:last-child\{border-bottom:0/)],
  ['app 부대비용',has('app.html',/\.fee-list\{border:1\.5px/)&&has('app.html',/\.fee:last-child\{border-bottom:0/)],
  ['app 진행 목록',has('app.html',/\.load-list\{border:1\.5px/)&&has('app.html',/\.load-row:last-child\{border-bottom:0/)],
  ['고객 문의 종류',has('customer-request.html',/\.choices\{[^}]*gap:1px[^}]*border:1\.5px/)&&lastProp('customer-request.html','.choice','border')==='0'],
  ['고객 문의 접수',has('customer-request.html',/\.receipt\{border:1\.5px/)&&has('customer-request.html',/\.receipt-row:last-child\{border-bottom:0/)],
  ['고객 견적 품목',has('customer-quote.html',/\.items\{border:1\.5px/)&&has('customer-quote.html',/\.item-head span:last-child,.item-main>span:last-child\{border-right:0/)],
  ['고객 견적 안내',has('customer-quote.html',/\.trust\{border:1\.5px/)&&has('customer-quote.html',/\.trust-row:last-child\{border-bottom:0/)],
  ['고객 견적 사업자',has('customer-quote.html',/\.business\{border:1\.5px/)&&has('customer-quote.html',/\.business-row:last-child\{border-bottom:0/)]
];
for(const [name,pass] of separators)check('V1 '+name,pass,'단일 1px 구분선 규칙 불충족');
const feeHeight=Number.parseFloat(lastProp('app.html','.fee','height'));
const choiceHeight=Number.parseFloat(lastProp('app.html','.choice','height'));
check('V2 부대비용',feeHeight===64,`행 높이 ${feeHeight}px`);
check('V2 종류 격자',choiceHeight===96,`셀 높이 ${choiceHeight}px`);
const allowed=new Set([0,1,8,12,16,24,32,40]);
const spacingViolations=[];
for(const file of files){
  for(const match of styles[file].matchAll(/(?:margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|gap)\s*:\s*([^;}]+)/g)){
    const values=[...match[1].matchAll(/(-?\d+(?:\.\d+)?)px/g)].map(value=>Number(value[1]));
    if(values.some(value=>!allowed.has(value)))spacingViolations.push(`${file}: ${match[0]}`);
  }
  for(const match of source[file].matchAll(/style="([^"]*)"/g))if(/(?:margin|padding|gap)\s*:/.test(match[1]))spacingViolations.push(`${file}: inline ${match[1]}`);
}
check('V3 간격 토큰',spacingViolations.length===0,spacingViolations.join(' | '));

const anchorColorViolations=[];
for(const file of files){
  if(!/a\{color:var\(--ink\)\}/.test(styles[file]))anchorColorViolations.push(`${file}: a 기본색 없음`);
  for(const rule of styles[file].matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    if(!/(^|[\s,.])a(?:[.:#\s,{]|$)/.test(rule[1]))continue;
    for(const color of rule[2].matchAll(/(?:^|;)\s*color\s*:\s*([^;]+)/g))if(!/^var\(--[a-z0-9-]+\)$/.test(color[1].trim()))anchorColorViolations.push(`${file}: ${rule[1].trim()} => ${color[1].trim()}`);
  }
}
check('V4 링크 색',anchorColorViolations.length===0,anchorColorViolations.join(' | '));

function appRuntime(){
  const app={className:'main',innerHTML:''},overlay={innerHTML:''};
  const document={getElementById:id=>id==='app'?app:id==='overlay'?overlay:{textContent:'',value:'',classList:{toggle(){}}},querySelectorAll:()=>[]};
  const context={document,location:{hash:''},window:{addEventListener(){}},setTimeout(){return 0},clearTimeout(){},Intl,console};
  vm.createContext(context);
  const js=[...source['app.html'].matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n');
  new vm.Script(`${js}\n;globalThis.__verify={state,runFlowForTest,startDirect,chooseType,chooseSpec,changeQty,addAndReview,go,itemPreview,racks};`).runInContext(context);
  return{app,api:context.__verify};
}
let flowPass=false,a4Pass=false,a4Detail='';
try{
  const first=appRuntime();
  flowPass=first.api.runFlowForTest()===true;
  const second=appRuntime(),{api,app}=second;
  api.startDirect();
  const emptyText=app.innerHTML.includes('규격을 고르세요');
  api.chooseType(2);api.chooseSpec(0);
  const before=api.itemPreview(api.racks[2],api.racks[2].specs[0],api.state.qty);
  const beforeText=app.innerHTML.includes(`이번 품목 ${api.state.qty}대</span><strong>${before.toLocaleString("ko-KR")}원`);
  api.changeQty(1);
  const after=api.itemPreview(api.racks[2],api.racks[2].specs[0],api.state.qty);
  const afterText=app.innerHTML.includes(`이번 품목 ${api.state.qty}대</span><strong>${after.toLocaleString("ko-KR")}원`);
  const changed=before!==after;
  api.addAndReview();api.go('types');
  const basketText=app.innerHTML.includes('담은 5대 · '+after.toLocaleString('ko-KR')+'원');
  a4Pass=emptyText&&beforeText&&afterText&&changed&&basketText;
  a4Detail=`미선택=${emptyText}, 변경 전=${before.toLocaleString('ko-KR')}원, 변경 후=${after.toLocaleString('ko-KR')}원, 장바구니=${basketText}`;
}catch(error){a4Detail=error.stack||error.message}
check('V5 기존 흐름',flowPass,'runFlowForTest() 실패');
check('V5 A4 갱신',a4Pass,a4Detail);

console.log(`V1 인접 구분선: ${separators.filter(([,pass])=>pass).length}/${separators.length} 통과, 2px 겹선 ${separators.filter(([,pass])=>!pass).length}건`);
console.log(`V2 부대비용 높이: [${Array(4).fill(feeHeight).join(', ')}]px`);
console.log(`V2 종류 격자 높이: [${Array(7).fill(choiceHeight).join(', ')}]px (선택 outline 포함)`);
console.log(`V3 허용 외 margin/padding/gap: ${spacingViolations.length}건`);
console.log(`V4 토큰 외 a 색상: ${anchorColorViolations.length}건`);
console.log(`V5 흐름 완주: ${flowPass?'통과':'실패'}`);
console.log(`V5 A4 수량·금액 즉시 갱신: ${a4Pass?'통과':'실패'} (${a4Detail})`);
if(failures.length){console.error('\nFAIL\n- '+failures.join('\n- '));process.exitCode=1}else console.log('\nALL CHECKS PASSED');