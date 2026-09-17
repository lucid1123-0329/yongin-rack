import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const storage = () => { const data = new Map(); return {
  getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key)
}; };
const prices = [900, 1200].map(width => ({ type: '경량랙', form: '독립', spec: `${width}*450*1800`, tier: 4, unitPrice: width === 900 ? 75000 : 90000, installFee: 10000 }));
prices.push({type:'하이퍼 진열대',form:'독립',layoutType:'벽면',spec:'900*450*1800',tier:1800,unitPrice:120000});
prices.push({type:'곤도라 진열대',form:'독립',layoutType:'벽면',setName:'벽면(900*450*1800)',spec:'900*450*1800',unitPrice:130000});
prices.push({type:'파렛트랙',partCategory:'기둥',partThickness:'2.2',partLength:3000,spec:'기둥 3000',unitPrice:65000});

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
  const c = { console, localStorage:storage(), sessionStorage:storage(), confirm:()=>true,
    setTimeout: fn => {timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),
    document:{getElementById:element,querySelectorAll:()=>[]},
    window:{scrollTo(){},addEventListener:(name,fn)=>events[name]=fn},
    history:{pushState(){},replaceState(){}},location:{href:'https://test.invalid/app/index.html'},
    UI:{toast(){},formatCurrency:v=>String(v)+'원',formatNumber:String,escapeHtml:String},
    API:{getPrices:async()=>({prices})}, syncEstimateFixedBar(){}
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
