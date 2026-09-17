import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/auth.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(){
 const store=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
 const element=()=>{const classes=new Set();return {classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},setAttribute(){},addEventListener(type,fn){this.handler=fn;},remove(){this.removed=true;}};};
 const nodes=Object.fromEntries(['#pin-pad','#pin-error','#pin-progress','#pin-progress-text','.bg-white'].map(k=>[k,element()]));
 const dots=Array.from({length:4},element),keys=Array.from({length:11},element),modal=element();
 modal.style={};modal.querySelector=s=>nodes[s];modal.querySelectorAll=s=>s==='.pin-dot'?dots:keys;
 const auth=deferred(),settings=deferred(),events=[];
 const ctx=vm.createContext({localStorage:store(),sessionStorage:store(),document:{createElement:()=>modal,getElementById:()=>null,body:{appendChild(){}}},API:{request:()=>auth.promise,getSettings:()=>settings.promise},window:{dispatchEvent:e=>events.push(e.type)},Event,setTimeout:()=>{}});
 vm.runInContext(source,ctx);vm.runInContext('Auth.showPinModal()',ctx);
 const press=key=>nodes['#pin-pad'].handler({target:{closest:()=>({dataset:{key}})}});
 return {nodes,keys,modal,auth,settings,events,press};
}
test('PIN keypad hides during authentication, stays busy until settings finish, then closes',async()=>{
 const s=setup();for(const k of ['1','2','3'])await s.press(k);const pending=s.press('4');
 assert.ok(s.nodes['#pin-pad'].classList.contains('hidden'));assert.ok(s.keys.every(k=>k.disabled));
 s.auth.resolve({token:'test-session',expiresAt:Date.now()+60000});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(s.nodes['#pin-progress-text'].textContent,/인증 완료/);assert.ok(!s.modal.removed);assert.equal(s.events.length,0);
 s.settings.resolve({settings:{}});await pending;assert.ok(s.modal.removed);assert.deepEqual(s.events,['yr-authenticated']);
});
test('incorrect PIN and network errors restore the keypad for retry',async()=>{
 for(const code of ['INVALID_PIN','NETWORK']){
  const s=setup();for(const k of ['1','2','3'])await s.press(k);const pending=s.press('4');
  s.auth.reject(Object.assign(new Error('try again'),{code}));await pending;
  assert.ok(!s.nodes['#pin-pad'].classList.contains('hidden'));assert.ok(s.keys.every(k=>!k.disabled));assert.equal(s.events.length,0);
 }
});
