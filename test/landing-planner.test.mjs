import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url), c={};
vm.createContext(c);
vm.runInContext(fs.readFileSync(new URL('js/landing-planner.js',root),'utf8')+'\nthis.planner=LandingPlanner;',c);
vm.runInContext(fs.readFileSync(new URL('js/landing-showrooms.js',root),'utf8')+'\nthis.rooms=LandingShowrooms;',c);
test('all 12 profiles: 5–200 pyeong have exact counts, bounded racks and clear reserved aisles',()=>{
  for(let p=0;p<c.planner.profiles.length;p++) for(const area of [5,12,30,60,100,150,200]) {
    const l=c.planner.createLayout(area,p);
    assert.equal(l.total,l.counts.reduce((n,r)=>n+r.count,0));
    assert.ok(Math.abs(l.width*l.height-area*3.3058)<1e-8);
    for(let i=0;i<l.racks.length;i++) {
      const r=l.racks[i];
      assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=l.width&&r.y+r.h<=l.height);
      assert.ok(l.aisles.every(a=>!c.planner.overlap(a,r)),`${p}/${area}: aisle blocked`);
      for(let j=i+1;j<l.racks.length;j++) assert.equal(c.planner.overlap(r,l.racks[j]),false,`${p}/${area}: rack overlap`);
    }
  }
});
test('input clamping and deterministic layout',()=>{
  assert.equal(c.planner.createLayout(201).py,200);
  assert.equal(c.planner.createLayout(-5).py,5);
  assert.equal(c.planner.createLayout('bad').py,5);
  assert.deepEqual(c.planner.createLayout(200),c.planner.createLayout(200));
  assert.ok(c.planner.createLayout(200).total>c.planner.createLayout(60).total);
});
test('showrooms use existing images, attributed records and normalized photo coordinates',()=>{
  assert.equal(c.rooms.length,11);
  for(const r of c.rooms) {
    assert.match(r.source,/^\d{12}$/);
    assert.ok(fs.existsSync(new URL('assets/landing/'+r.img,root)));
    assert.ok(r.kit.length>0);
    for(const s of r.spots) assert.ok(s[0]>=0&&s[0]<=100&&s[1]>=0&&s[1]<=100);
  }
  const mart=c.rooms.find(r=>r.id==='mart');
  assert.equal(mart.kit[0][0],'하이퍼 진열대');
  assert.equal(c.rooms.find(r=>r.id==='pharmacy').kit[0][0],'곤도라 진열대');
  assert.equal(c.rooms.find(r=>r.id==='pharmacy').generated,true);
  assert.ok(!c.rooms.some(r=>r.img==='paju-starfield.jpg'||r.img==='iksan-pharmacy.jpg'||r.img==='okjeong-stationery.jpg'));
});
test('landing connects a single model to counts, drawing and inquiry and preserves image coordinates',()=>{
  const html=fs.readFileSync(new URL('index.html',root),'utf8');
  assert.match(html,/id="cfg-range" min="5" max="200"/);
  assert.match(html,/LandingEditor\.mount/);
  assert.match(html,/editor\.update/);
  assert.match(html,/object-fit:contain/);
  assert.match(html,/stage\.clientWidth\/im\.naturalWidth/);
  assert.doesNotMatch(html,/Math\.min\(360, py \* 6\)/);
});
