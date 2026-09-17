import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,String(v)), removeItem: k => values.delete(k) };
}
function server() {
  const props = new Map(), cache = new Map();
  const properties = { getProperty: k => props.get(k) || null, setProperty: (k,v) => props.set(k,String(v)),
    deleteProperty: k => props.delete(k), setProperties: values => Object.entries(values).forEach(([k,v]) => props.set(k,String(v))) };
  const settings = [['key','value'], ['company','중용랙'], ['pinHash','SECRET_PIN'], ['geminiApiKey','SECRET_GEMINI'], ['onesignalApiKey','SECRET_PUSH'], ['githubToken','SECRET_GITHUB']];
  const c = { console, Date, JSON, PropertiesService: { getScriptProperties: () => properties },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k,v) => cache.set(k,v), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: randomUUID, DigestAlgorithm: { SHA_256:'sha256' }, Charset: { UTF_8:'utf8' },
      computeDigest: (_, value) => [...createHash('sha256').update(value).digest()] },
  };
  vm.createContext(c);
  vm.runInContext(read('Code.gs'), c);
  c.jsonResponse = value => value;
  c.getSheet = () => ({ getDataRange: () => ({ getValues: () => settings }) });
  c.post = body => c.doPost({ postData: { contents: JSON.stringify(body) } });
  c.get = action => c.doGet({ parameter: { action } });
  c.props = props;
  return c;
}
test('all admin GETs and unauthenticated POSTs fail closed, even without a configured PIN', () => {
  const c = server();
  for (const action of ['getSettings','getPrices','getEstimates','getEstimate','getRequests','getDashboard','getPortfolio','viewEstimate','testGemini']) {
    assert.equal(c.get(action).code, 'UNAUTHORIZED', action);
    assert.equal(c.post({ action }).code, 'UNAUTHORIZED', action);
  }
  for (const action of ['saveSettings','changePin','registerPush','initializeAdminPin']) assert.equal(c.post({ action }).code, 'UNAUTHORIZED');
});
test('public and admin settings never return secret values; arbitrary settings writes rejected', () => {
  const c = server();
  for (const value of [c.get('getPublicSettings'), c.getSettings()]) assert.doesNotMatch(JSON.stringify(value), /SECRET_|pinHash|geminiApiKey|onesignalApiKey|githubToken/);
  assert.ok(c.saveSettings({ pinHash:'replace' }).error);
});
test('owner initialization, server PIN verification, session expiry, PIN rotation and logout', () => {
  const c = server();
  c.props.set('ADMIN_INITIAL_PIN','1234');
  c.initializeAdminPin();
  assert.equal(c.props.has('ADMIN_INITIAL_PIN'), false);
  assert.equal(c._verifyAuthToken('SECRET_PIN'), false);
  const login = c.post({ action:'authenticate', pin:'1234' });
  assert.equal(c._verifyAuthToken(login.token), true);
  const changed = c.post({ action:'changePin', pin:'5678', authToken:login.token });
  assert.equal(c._verifyAuthToken(login.token), false);
  assert.equal(c._verifyAuthToken(changed.token), true);
  assert.equal(c.post({ action:'authenticate', pin:'1234' }).code, 'INVALID_PIN');
  assert.ok(c.post({ action:'logout', authToken:changed.token }).result);
  assert.equal(c._verifyAuthToken(changed.token), false);
  const fresh = c.post({ action:'authenticate', pin:'5678' });
  const future = Date.now() + 21600001;
  c.Date = class extends Date { static now() { return future; } };
  assert.equal(c._verifyAuthToken(fresh.token), false);
});
test('five bad PINs lock server independently of browser storage', () => {
  const c = server(); c._storeAdminPin('1234');
  for (let i=0;i<5;i++) assert.equal(c.post({ action:'authenticate', pin:'9999' }).code, 'INVALID_PIN');
  assert.match(c.post({ action:'authenticate', pin:'1234' }).error, /15분/);
});
test('saved retry ID returns original record, but changed payload cannot silently overwrite it', () => {
  const c = server();
  const items = [{type:'경량랙',quantity:1,unitPrice:10000}];
  const row = ['2026-09-17','Q-1','가상 고객','','01000000000','',JSON.stringify(items),11000,'상담','retry-1'];
  c.getSheet = () => ({getDataRange:()=>({getValues:()=>[[],row]})});
  c.generateEstimateId = () => 'unused';
  c.Utilities.formatDate = () => '2026-09-17';
  const payload = {clientId:'retry-1',items,total:11000,name:'가상 고객',phone:'01000000000'};
  assert.equal(c.saveEstimate(payload).duplicate,true);
  assert.equal(c.saveEstimate({...payload,name:'다른 고객'}).code,'SAVE_CONFLICT');
  assert.equal(c.saveEstimate({...payload,total:22000}).code,'SAVE_CONFLICT');
});
test('push registration requires authenticated server allowlist, not client tags', () => {
  const c = server(); c._storeAdminPin('1234');
  const login = c.post({ action:'authenticate', pin:'1234' });
  const subscriptionId = randomUUID();
  assert.equal(c.post({ action:'registerPush', subscriptionId }).code, 'UNAUTHORIZED');
  assert.equal(c.post({ action:'registerPush', subscriptionId, authToken:login.token }).result, 'success');
  assert.equal(c.post({ action:'getPushRegistration', subscriptionId, authToken:login.token }).registered, true);
  assert.equal(c.post({ action:'unregisterPush', subscriptionId, authToken:login.token }).result, 'success');
  assert.equal(c.post({ action:'getPushRegistration', subscriptionId, authToken:login.token }).registered, false);
  assert.doesNotMatch(read('app/admin-push.html'), /addTag\(/);
  assert.match(read('Code.gs'), /include_subscription_ids: ids/);
});
test('customer DTO strips internal fields and margin, preserving actual Calc totals including rounding and D/C', () => {
  const c = server(); vm.runInContext(read('js/calc.js') + '\nthis.Calc=Calc;', c);
  c.UI = { escapeHtml:String, formatNumber:String, formatCurrency:String };
  vm.runInContext(read('js/estimate.js') + '\nthis.Estimate=Estimate;', c);
  for (const margin of [0,1,101,10000,-101]) {
    const items = [{ type:'경량랙', quantity:3, unitPrice:10000, installFee:1000, internalCost:123 },
      { type:'중량랙', quantity:7, unitPrice:20000, installFee:2000 },
      { itemType:'custom', name:'마진', unitPrice:margin, quantity:1 },
      { itemType:'custom', name:'D/C', unitPrice:-1000, quantity:1 }];
    const totals = c.Calc.calcTotals(items);
    const output = c.customerQuote({ items, total:totals.total, supplyTotal:totals.supplyTotal, vat:totals.vat }, 'formal');
    assert.doesNotMatch(JSON.stringify(output), /마진|internalCost|itemTotal|subtotal/);
    for (const key of ['total','vat','supplyTotal']) assert.equal(c.Calc.calcTotals(output.items)[key], totals[key], `${margin}: ${key}`);
    for (const key of ['total','vat','supplyTotal']) assert.equal(c.Calc.calcTotals(c.Estimate.applyMarginToUnitPrices(items))[key], totals[key], `preview ${margin}: ${key}`);
  }
  assert.ok(c.customerQuote({ items:[{itemType:'custom',name:'마진',unitPrice:100,quantity:1}] }).error);
});
test('invalid customer contact and oversized or non-image attachments rejected before storage', () => {
  const c = server();
  assert.ok(c.submitRequest({name:'test',phone:'abc'}).error);
  assert.ok(c.submitRequest({name:'test',phone:'01000000000',images:Array(6).fill({})}).error);
  assert.ok(c.submitRequest({name:'test',phone:'01000000000',images:[{mimeType:'text/html',base64:'data'}]}).error);
});
test('API uses POST session authentication, throws server JSON errors, and leaves customer token queries public', async () => {
  const calls=[];
  const c = { localStorage:storage({yr_pin_hash:'OLD_SECRET'}), sessionStorage:storage({yr_auth_token:'session-token'}),
    URLSearchParams, AbortController, setTimeout, clearTimeout, navigator:{onLine:true}, console,
    fetch: async (url, options) => { calls.push({url,options}); return {ok:true,text:async()=>JSON.stringify({error:'denied'})}; } };
  vm.createContext(c); vm.runInContext(read('js/api.js')+'\nthis.API=API;',c);
  await assert.rejects(c.API.getSettings(), /denied/);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(JSON.parse(calls[0].options.body).authToken, 'session-token');
  assert.doesNotMatch(calls[0].url, /session-token|OLD_SECRET/);
  await assert.rejects(c.API.getEstimateByToken('share'), /denied/);
  assert.equal(calls[1].options.method, 'GET');
  assert.match(calls[1].url, /token=share/);
});
test('failed PIN change does not replace the existing session or persist a PIN hash', async () => {
  const c = { localStorage:storage({yr_pin_hash:'old'}), sessionStorage:storage({yr_auth_token:'valid',yr_auth_expires:String(Date.now()+60000)}),
    API:{request:async()=>{throw new Error('server failed')}}, console };
  vm.createContext(c); vm.runInContext(read('js/auth.js')+'\nthis.Auth=Auth;',c);
  await assert.rejects(c.Auth.setPin('9999'), /server failed/);
  assert.equal(c.sessionStorage.getItem('yr_auth_token'),'valid');
  assert.equal(c.localStorage.getItem('yr_pin_hash'),null);
});
