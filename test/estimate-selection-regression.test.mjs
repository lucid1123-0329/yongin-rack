import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const storage = () => { const data = new Map(); return {
  getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key)
}; };
const prices = [900, 1200].map(width => ({ type: '경량랙', form: '독립', spec: `${width}*450*1800`, tier: 4, unitPrice: width === 900 ? 75000 : 90000, installFee: 10000 }));
prices.push({type:'하이퍼 진열대',form:'독립',layoutType:'벽면',spec:'900*450*1800',tier:1800,unitPrice:120000});
prices.push({type:'곤도라 진열대',form:'독립',layoutType:'벽면',setName:'벽면(900*450*1800)',spec:'900*450*1800',unitPrice:130000});
prices.push({type:'파렛트랙',partCategory:'기둥',partThickness:'2.2',partLength:3000,spec:'기둥 3000',unitPrice:65000});
prices.push({type:'무볼트앵글',partCategory:'기둥',partLength:1800,spec:'기둥 1800',unitPrice:12000});
prices.push({type:'무볼트앵글',isAccessory:true,accessoryCategory:'고무발',spec:'4개 세트',unitPrice:4000});

async function fixture() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {id, value:'', textContent:'', innerHTML:'', dataset:{}, children:[], checked:false,
        classList:{add:(...a)=>a.forEach(v=>classes.add(v)),remove:(...a)=>a.forEach(v=>classes.delete(v)),contains:v=>classes.has(v),toggle(v,on){if(on ?? !classes.has(v))classes.add(v);else classes.delete(v);}},
        setAttribute(){}, querySelector:()=>null, addEventListener(){}, focus(){} });
    }
    return elements.get(id);
  };
  const events = {}, timers = new Map(); let timer = 0;
  const c = { console, crypto:webcrypto, localStorage:storage(), sessionStorage:storage(), confirm:()=>true,
    setTimeout: fn => {timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),
    document:{getElementById:element,querySelectorAll:()=>[]},
    window:{scrollTo(){},addEventListener:(name,fn)=>events[name]=fn},
    history:{pushState(){},replaceState(){}},location:{href:'https://test.invalid/app/index.html'},
    UI:{toast(){},formatCurrency:v=>String(v)+'원',formatNumber:String,escapeHtml:String},
    API:{getPrices:async()=>({prices:structuredClone(prices)})}, syncEstimateFixedBar(){}
  };
  vm.createContext(c);
  const html=read('app/index.html');
  const wizard=html.slice(html.indexOf('const EstimateWizard = (() => {'),html.indexOf('    function getInitialWizardStep('));
  vm.runInContext(read('js/calc.js')+'\n'+read('js/app.js')+'\n'+wizard+'\nthis.App=App;this.Wizard=EstimateWizard;',c);
  await c.App.loadPrices(true);c.Wizard.init(1);
  return {c,element,timers,events};
}

test('real App and Wizard: same rack different specs, direct quantity, back, cart remove and reset', async()=>{
  const {c,element,timers,events}=await fixture();const a=c.App,w=c.Wizard;
  const pick=width=>{a.onDimensionChip('spec','W',String(width));a.onDimensionChip('spec','D','450');a.onDimensionChip('spec','H','1800');};
  a.onTypeChip('경량랙');a.onFormChip('독립');pick(900);assert.equal(w.step,3);
  element('qty-input').value='3';a.addItem();assert.equal(a.items[0].quantity,3);
  w.chooseAfterAdd(2);assert.equal(w.step,2);assert.equal(a.currentSelection,null);
  pick(1200);assert.equal(w.step,3);w.previous();assert.equal(w.step,2);
  a.sortSpecs('price');assert.equal(w.step,2,'rendering does not auto-advance');
  a.onSpecCard(0);element('qty-input').value='2';a.addItem();
  assert.equal(a.items.length,2);assert.equal(a.items[1].spec,'1200*450*1800');assert.equal(a.items[1].quantity,2);
  assert.equal(a.calculate().total,500500);
  w.chooseAfterAdd(4);w.previous();assert.equal(w.step,2);assert.equal(a.selectedType,'경량랙');
  assert.equal(element('sel-spec-group').classList.contains('hidden'),false);
  a.onSpecCard(0);w.previous();a.onDimensionChip('spec','W','1200');w.go(3);
  assert.equal(w.step,2,'invalidated spec cannot be used through the quantity tab');
  a.removeItem(0);assert.equal(a.items.length,1);assert.equal(a.calculate().total,220000);
  element('cust-name').value='테스트';element('custom-name').value='운송비';element('dc-amount').value='5000';
  element('margin-amount').dataset.amount='9000';c.sessionStorage.setItem('yr_edit_id','fake');
  a.onSpecCard(0);a.setQuantity(9);w.openCartSheet();
  c.confirm=()=>false;a.resetEstimate();assert.equal(a.items.length,1);assert.equal(element('cust-name').value,'테스트');
  c.confirm=()=>true;a.resetEstimate();
  assert.equal(a.items.length,0);assert.equal(a.currentSelection,null);assert.equal(a.selectedType,'');assert.equal(w.step,1);
  assert.equal(Number(element('qty-input').value),1);assert.equal(element('cust-name').value,'');
  assert.equal(element('custom-name').value,'');assert.equal(element('dc-amount').value,'');
  assert.equal(element('margin-amount').dataset.amount,'0');assert.equal(c.sessionStorage.getItem('yr_edit_id'),null);
  assert.equal(element('cart-sheet').classList.contains('hidden'),true);
  for(const fn of [...timers.values()])fn();assert.equal(a.loadDraft(),null,'reset cannot resurrect a pending draft');
  w.go(3);assert.equal(w.step,1);a.onTypeChip('경량랙');assert.equal(w.step,2);
  a.onFormChip('독립');pick(900);a.addItem();assert.equal(a.items[0].quantity,1);
  events.popstate({state:{estimateWizard:true,step:2}});
  assert.equal(w.step,2);assert.equal(a.selectedType,'경량랙');
  assert.equal(element('item-added-sheet').classList.contains('hidden'),true,'browser back closes the add dialog');
  a.onSpecCard(0);a.addItem();w.closeAddedSheet();assert.equal(w.step,2);
  assert.equal(element('sel-spec-group').classList.contains('hidden'),false,'closing the dialog restores the selector');
});

test('models B/C/D clear stale selections when layout, part or mode changes',async()=>{
  const {c}=await fixture();const a=c.App,w=c.Wizard;
  a.onTypeChip('하이퍼 진열대');a.onFormChip('독립');a.onLayoutChip('벽면');a.onModelBSpecCard(0);
  assert.equal(w.step,3);w.previous();a.onLayoutChip('벽면');assert.equal(a.currentSelection,null);w.go(3);assert.equal(w.step,2);
  a.onTypeChip('파렛트랙');a.onPartCatChip('기둥');a.onPartCard('기둥','2.2',0);assert.equal(w.step,3);
  w.previous();a.onPartThicknessChip('2.2');assert.equal(a.currentSelection,null);w.go(3);assert.equal(w.step,2);
  a.onTypeChip('곤도라 진열대');a.onDSetCard(0);assert.equal(w.step,3);
  w.previous();a.onDModeSwitch('part');assert.equal(a.currentSelection,null);w.go(3);assert.equal(w.step,2);
});

test('accessory-only add opens follow-up dialog with or without a part category selected', async()=>{
  for (const pickCategory of [false, true]) {
    const {c,element}=await fixture();const a=c.App,w=c.Wizard;
    a.onTypeChip('무볼트앵글');
    if (pickCategory) a.onPartCatChip('기둥');
    assert.equal(a.currentSelection,null);
    assert.equal(element('item-added-sheet').classList.contains('hidden'),true);
    a.onAccessoryCard(0);
    assert.equal(a.items.length,1);
    assert.equal(a.items[0].itemType,'accessory');
    assert.equal(a.calculate().total,4400);
    assert.equal(element('item-added-sheet').classList.contains('hidden'),false);
    assert.match(element('item-added-sheet-summary').textContent,/고무발/);
    w.chooseAfterAdd(2);
    assert.equal(w.step,2);assert.equal(a.selectedType,'무볼트앵글');
    assert.equal(element('item-added-sheet').classList.contains('hidden'),true);
    a.onAccessoryCard(0);w.closeAddedSheet();assert.equal(w.step,2);
    a.onAccessoryCard(0);w.chooseAfterAdd(1);assert.equal(w.step,1);
    a.onTypeChip('무볼트앵글');a.onAccessoryCard(0);w.chooseAfterAdd(4);
    assert.equal(w.step,4);assert.equal(a.items.length,4);assert.equal(a.calculate().total,17600);
  }
});

const routes = [
  ['일반 랙', '경량랙', a=>{a.onFormChip('독립');a.onSpecCard(0);}],
  ['하이퍼', '하이퍼 진열대', a=>{a.onFormChip('독립');a.onLayoutChip('벽면');a.onModelBSpecCard(0);}],
  ['파렛트 부품', '파렛트랙', a=>{a.onPartCatChip('기둥');a.onPartCard('기둥','2.2',0);}],
  ['무볼트 부품', '무볼트앵글', a=>{a.onPartCatChip('기둥');a.onPartCard('기둥','',0);}],
  ['곤도라 세트', '곤도라 진열대', a=>a.onDSetCard(0)],
];
for (const [label,type,pick] of routes) for (const action of [1,2,4,'close','back']) {
  test(`${label}: add -> ${action} -> keep cart, usable next step`, async()=>{
    const {c,element,events}=await fixture();const a=c.App,w=c.Wizard;
    a.onTypeChip(type);pick(a);assert.equal(w.step,3);
    element('qty-input').value='2';a.addItem();
    assert.equal(a.items.length,1);assert.equal(a.items[0].quantity,2);
    assert.equal(element('item-added-sheet').classList.contains('hidden'),false);
    if(action==='close') w.closeAddedSheet();
    else if(action==='back') events.popstate({state:{estimateWizard:true,step:2}});
    else w.chooseAfterAdd(action);
    assert.equal(w.step,typeof action==='number'?action:2);
    assert.equal(element('item-added-sheet').classList.contains('hidden'),true);
    if(w.step===2){assert.equal(a.selectedType,type);pick(a);a.addItem();assert.equal(a.items.length,2);}
    w.go(6);a.removeItem(0);assert.ok(Number.isFinite(a.calculate().total));
    a.resetEstimate();assert.equal(a.items.length,0);assert.equal(w.step,1);
  });
}

test('recent, frequent and customer-pattern shortcuts use current prices and show the follow-up dialog',async()=>{
  for(const method of ['addRecentQuick','addFrequentlyUsedQuick','_addPatternItem']){
    const {c,element}=await fixture();const a=c.App,w=c.Wizard;
    const row={...a.priceData[0],unitPrice:1};
    c.localStorage.setItem('yr_recent_items',JSON.stringify([row]));
    const key=[row.type,row.form,row.spec,row.tier].join('|');
    c.localStorage.setItem('yr_item_freq',JSON.stringify({[key]:[Date.now(),Date.now(),Date.now()]}));
    a.setCustomerPatternItems([{items:[row]}]);
    a[method](0);assert.equal(a.items[0].unitPrice,75000);
    assert.equal(element('item-added-sheet').classList.contains('hidden'),false);
    w.chooseAfterAdd(2);assert.equal(w.step,2);assert.equal(a.selectedType,'경량랙');
  }
});

test('unpriced, missing, ambiguous and non-finite quick or accessory items never enter cart',async()=>{
  for(const scenario of ['unpriced','missing','ambiguous']) {
    const {c}=await fixture();const a=c.App,row={...a.priceData[0]};
    c.localStorage.setItem('yr_recent_items',JSON.stringify([row]));
    if(scenario==='unpriced')a.priceData[0].unitPrice=0;
    if(scenario==='missing')a.priceData.splice(0,1);
    if(scenario==='ambiguous')a.priceData.push({...row});
    a.addRecentQuick(0);assert.equal(a.items.length,0);
  }
  for(const price of [0,-1,NaN,Infinity]) {
    const {c,element}=await fixture();const a=c.App;
    a.priceData.find(p=>p.isAccessory).unitPrice=price;
    a.onTypeChip('무볼트앵글');a.onAccessoryCard(0);
    assert.equal(a.items.length,0);assert.equal(element('item-added-sheet').classList.contains('hidden'),true);
    assert.equal(a.addItemFromPrice({...prices[0],unitPrice:price},2),null);
  }
});

test('invalid custom/shelf quantities never add partial items; margin refreshes after cart changes',async()=>{
  const {c,element}=await fixture();const a=c.App;
  for(const value of ['0','-1','1.5','10000','Infinity']) {
    element('custom-name').value='운송비';element('custom-price').value='10000';element('custom-qty').value=value;
    a.addCustomItem();assert.equal(a.items.length,0,`reject custom qty ${value}`);
  }
  a.priceData[0].shelfAddonPrice=5000;a.onTypeChip('경량랙');a.onFormChip('독립');a.onSpecCard(0);
  element('chk-shelf-addon').checked=true;element('shelf-addon-qty').value='-1';a.addItem();
  assert.equal(a.items.length,0,'invalid shelf qty cannot partially add the rack');
  element('shelf-addon-qty').value='2';a.addItem();assert.equal(a.items.length,2);
  element('margin-pct').value='10';a.calcMarginFromPct();a.removeItem(0);a.addMargin();
  assert.equal(a.items.length,1,'a stale positive margin must not survive rack deletion');
  element('dc-amount').value='Infinity';a.addDiscount();assert.equal(a.items.length,1);
  a.resetEstimate();a.addItemFromPrice(prices[0],2);
  element('custom-name').value='운송비';element('custom-price').value='10000';element('custom-qty').value='1';a.addCustomItem();
  element('margin-pct').value='10';a.addMargin();element('dc-amount').value='5000';a.addDiscount();
  // D/C is deducted from the VAT-inclusive total: (170000 + 10000 + 17000) * 1.1 - 5000.
  assert.equal(a.calculate().total,211700);
});

test('width changes invalidate selected item; voice/catalog add keeps non-modal review flow and saves exact totals',async()=>{
  const {c,element}=await fixture();const a=c.App,w=c.Wizard;
  a.onTypeChip('경량랙');a.onFormChip('독립');a.onSpecCard(0);w.previous();a.filterSpecsByWidth('1200');w.go(3);
  assert.equal(w.step,2);assert.equal(a.currentSelection,null);
  a.addItemFromPrice(a.priceData[0],2);a.addItemFromPrice(a.priceData[1],3);
  assert.equal(element('item-added-sheet').classList.contains('hidden'),true);
  w.go(6);let payload;c.API.saveEstimate=async data=>{payload=data;return {estimateId:'TEST-ONLY'};};
  element('cust-name').value='회귀 점검';await a.saveEstimate();
  assert.equal(payload.total,517000);assert.equal(payload.items.length,2);
  assert.equal(payload.items[0].quantity,2);assert.equal(payload.items[1].quantity,3);
  assert.equal(a.items.length,0);assert.equal(a.loadDraft(),null);
});
