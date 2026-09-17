import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const memory = () => { const values = new Map(); return { getItem:k=>values.get(k)||null, setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k) }; };
const rack = {type:'경량랙',form:'독립',spec:'1200*450*1800',tier:4,unitPrice:90000,installFee:10000,quantity:3};
test('model A new W/D/H and legacy two-axis specifications roundtrip without rewriting stored formats', () => {
  const c={};vm.createContext(c);vm.runInContext(read('js/rack-spec.js')+'\nthis.RackSpec=RackSpec;',c);
  for(const row of [rack,{...rack,type:'고급경량랙',spec:'450*1200',tier:'1800(5단)'},{...rack,type:'MD중량랙',spec:'450*1200*1800'},{...rack,spec:'450*1200',tier:'1800(4단)'}]) {
    const d=c.RackSpec.parse(row), serialized=c.RackSpec.serialize(row.type,d.width,d.depth,d.height,d.tier,d.legacy);
    assert.equal(serialized.spec,row.spec);assert.equal(serialized.tier,row.tier);
    assert.equal(d.width,'1200');assert.equal(d.depth,'450');
  }
  assert.equal(c.RackSpec.serialize('경량랙','900','450','1800','4',false).spec,'900*450*1800');
});
test('new quote copy reprices exactly; unknown/ambiguous rows stop; originals unchanged; outdated quotes warn', () => {
  const c={};vm.createContext(c);vm.runInContext(read('js/precheck.js'),c);
  const prices=[{...rack,unitPrice:130000}];
  const result=c.Precheck.reprice([rack],prices);
  assert.equal(result.items[0].unitPrice,130000);assert.equal(result.changed,1);assert.equal(rack.unitPrice,90000);
  assert.throws(()=>c.Precheck.reprice([rack],[]));
  assert.throws(()=>c.Precheck.reprice([rack],[...prices,...prices]));
  assert.ok(c.Precheck.run([rack],{}, {},{priceData:prices}).warns.some(w=>w.code==='price_changed'));
  assert.doesNotThrow(()=>c.Precheck.run([rack],{}, {},{}), 'absent App must not recurse');
});
test('save response loss uses stable ID across retries, reload, and double taps', async () => {
  const local=memory(), session=memory(), ids=[];
  function app() {
    const c={localStorage:local,sessionStorage:session,crypto:webcrypto,setTimeout,clearTimeout,window:{},document:{getElementById:()=>null},UI:{toast(){}},
      API:{saveEstimate:async data=>{ids.push(data.clientId);await Promise.resolve();throw new Error('response lost');}}};
    vm.createContext(c);vm.runInContext(read('js/calc.js')+'\n'+read('js/app.js')+'\nthis.App=App;',c);return c.App;
  }
  let a=app();a.items=[rack];
  await Promise.allSettled([a.saveEstimate(),a.saveEstimate()]);assert.equal(ids.length,1);
  await assert.rejects(a.saveEstimate());assert.equal(ids[0],ids[1]);
  a=app();const draft=a.loadDraft();a.items=draft.items;
  await assert.rejects(a.saveEstimate());assert.equal(ids[0],ids[2]);assert.equal(a.items.length,1);
  a.clearDraft();await assert.rejects(a.saveEstimate());assert.notEqual(ids[0],ids[3]);
});
test('share failure never falls back to public ID; cancellation reports not sent', async () => {
  const c={localStorage:memory(),UI:{escapeHtml:String,formatNumber:String,formatCurrency:String,toast(){}},location:{origin:'https://example.test'},
    navigator:{share:async()=>{const e=new Error('cancel');e.name='AbortError';throw e;}},API:{createShareToken:async()=>{throw new Error('offline')}}};
  vm.createContext(c);vm.runInContext(read('js/calc.js')+'\n'+read('js/estimate.js')+'\nthis.Estimate=Estimate;',c);
  await assert.rejects(c.Estimate.share({estimateId:'TEST',items:[rack]},'formal'),/offline/);
  c.API.createShareToken=async()=>({token:'synthetic'});
  assert.equal(await c.Estimate.share({estimateId:'TEST',items:[rack]},'formal'),false);
});
test('forbidden marketing copy is removed from customer pages and generated blog inquiry', () => {
  for(const file of ['index.html','request.html','portfolio-public.html','js/blog-draft.js']) assert.doesNotMatch(read(file), /무료|0원.*실측/);
});
