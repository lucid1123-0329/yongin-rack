import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx={};vm.createContext(ctx);
for(const f of ['landing-planner','landing-editor'])vm.runInContext(fs.readFileSync(new URL('../js/'+f+'.js',import.meta.url),'utf8'),ctx);
const editor=vm.runInContext('LandingEditor',ctx);
const base=()=>({version:1,py:30,profile:0,shape:'wide',items:[{id:1,kind:'rack',x:.25,y:.25,w:1.2,h:.5}]});
test('four room shapes preserve usable area from 5 to 200 pyeong',()=>{
 for(const shape of ['wide','long','square','ell'])for(const py of [5,12,60,100,200]){
 const g=editor.geometry(py,shape);assert.ok(Math.abs(g.width*g.height-(g.cut?g.cut.w*g.cut.h:0)-py*3.3058)<1e-7);
 }
});
test('editor rejects overlap, entrance, cutout and boundary violations',()=>{
 const s=base(),g=editor.geometry(s.py,s.shape);
 assert.equal(editor.issue(s,s.items[0]),'');
 assert.ok(editor.issue(s,{...s.items[0],id:2}));
 assert.ok(editor.issue(s,{...s.items[0],x:-.1}));
 assert.ok(editor.issue(s,{...s.items[0],x:g.width/2,y:g.height-.5}));
 s.shape='ell';const l=editor.geometry(s.py,s.shape);assert.ok(editor.issue(s,{...s.items[0],x:l.width*.75}));
});
test('file roundtrip is canonical and untrusted files cannot inject data or invalid layouts',()=>{
 const s=base();assert.deepEqual(JSON.parse(JSON.stringify(editor.validate(s))),s);
 for(const patch of [{py:201},{shape:'__proto__'},{profile:-1},{version:2},{items:Array(251).fill(s.items[0])}])assert.throws(()=>editor.validate({...s,...patch}));
 for(const patch of [{id:0},{id:1e20},{kind:'constructor'},{x:NaN},{w:Infinity},{h:-1},{kind:'<img onerror=alert(1)>'}])assert.throws(()=>editor.validate({...s,items:[{...s.items[0],...patch}]}));
 assert.throws(()=>editor.validate({...s,items:[s.items[0],s.items[0]]}));
 assert.throws(()=>editor.validate({...s,items:[s.items[0],{...s.items[0],id:2}]}));
 const safe=editor.validate({...s,secret:'discard',items:[{...s.items[0],html:'discard'}]});assert.equal(safe.secret,undefined);assert.equal(safe.items[0].html,undefined);
});
