import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=f=>fs.readFileSync(new URL('../js/'+f+'.js',import.meta.url),'utf8');
const plan=()=>({version:1,py:12,shape:'wide',profile:0,items:[{id:1,kind:'rack',x:.25,y:.25,w:1.2,h:.45},{id:2,kind:'counter',x:3,y:.25,w:1.5,h:.65}]});
function env(){
 const elements={},stored=new Map(),drawn=[];
 function element(){return {children:[],value:'',textContent:'',append(...nodes){this.children.push(...nodes);},before(){},setAttribute(){},click(){this.clicked=true;},getContext(){return new Proxy({fillText(t){drawn.push(t);}},{get:(o,k)=>o[k]||(()=>{})});},toDataURL(type){return 'data:'+type+';base64,'+(type==='image/jpeg'?'/9j/AAA=':'AAAA');}};}
 const c={URLSearchParams,Date,document:{createElement:element,getElementById:id=>elements[id]||(elements[id]=element())},location:{search:'',assign(url){this.assigned=url;}},sessionStorage:{setItem:(k,v)=>stored.set(k,v),getItem:k=>stored.get(k),removeItem:k=>stored.delete(k)},crypto:{randomUUID:()=>'12345678-1234-1234-1234-123456789abc'}};
 vm.createContext(c);for(const f of ['landing-planner','landing-editor','landing-plan-export'])vm.runInContext(source(f),c);
 return {c,stored,elements,drawn,api:vm.runInContext('LandingPlanExport',c)};
}
test('summary counts only racks; image includes dimensions, IDs and caveats',()=>{
 const e=env(),s=e.api.summary(plan());assert.equal(s.quantity,1);assert.ok(s.memo.length<=500);assert.match(s.memo,/높이·단수/);
 const canvas=e.api.canvas(plan());assert.equal(canvas.width,1400);assert.ok(canvas.height>=950);assert.ok(e.drawn.some(t=>t.includes('계산대')));assert.ok(e.drawn.some(t=>t.includes('실제 설치')));
 assert.throws(()=>e.api.canvas({...plan(),items:[{...plan().items[0],x:-1}]}));
});
test('handoff is explicit, excludes empty quote and fails without navigating if storage fails',()=>{
 const e=env();e.api.transfer(plan());assert.match(e.c.location.assigned,/^\/request.html\?layout=/);assert.equal(e.stored.size,1);
 const f=env();assert.throws(()=>f.api.transfer({...plan(),items:[]}));assert.equal(f.c.location.assigned,undefined);
 f.c.sessionStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>f.api.transfer(plan()));assert.equal(f.c.location.assigned,undefined);
});
test('request bridge reconstructs JPEG, prefills fields, preserves retry and blocks missing/expired drafts',()=>{
 const e=env();e.api.transfer(plan());e.c.location.search=e.c.location.assigned.slice('/request.html'.length);vm.runInContext(source('request-layout'),e.c);
 const bridge=vm.runInContext('RequestLayout',e.c);assert.equal(bridge.blocked(),false);assert.equal(bridge.photo().mimeType,'image/jpeg');assert.equal(e.elements['req-qty'].value,1);assert.equal(e.elements['req-rack'].value,'경량랙');assert.equal(e.stored.size,1);bridge.clear();assert.equal(e.stored.size,0);
 for(const expired of [false,true]){const f=env();f.c.location.search='?layout=12345678-1234-1234-1234-123456789abc';if(expired)f.stored.set('yr-plan-12345678-1234-1234-1234-123456789abc',JSON.stringify({createdAt:0,state:plan()}));vm.runInContext(source('request-layout'),f.c);assert.equal(vm.runInContext('RequestLayout.blocked()',f.c),true);assert.equal(vm.runInContext('RequestLayout.photo()',f.c),null);}
});
test('request submission includes layout in five-photo limit and existing server attachment format',()=>{
 const html=fs.readFileSync(new URL('../request.html',import.meta.url),'utf8');assert.match(html,/selectedFiles.length \+ \(layoutPhoto \? 1 : 0\) > 5/);assert.match(html,/const photos = layoutPhoto \? \[layoutPhoto\] : \[\]/);assert.match(html,/RequestLayout.blocked\(\)/);assert.match(html,/RequestLayout.clear\(\)/);
});
