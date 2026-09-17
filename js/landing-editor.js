/* A customer sketch editor, not an installation or evacuation design tool. */
const LandingEditor = (() => {
  const shapes={wide:'가로형',long:'세로형',square:'정사각형',ell:'ㄱ자형'};
  const kinds={rack:{name:'선반',w:1.2,h:.5,color:'#2F6BFF'},counter:{name:'계산대',w:1.5,h:.65,color:'#FF6B00'},table:{name:'체험 테이블',w:1.2,h:.8,color:'#318579'},stock:{name:'재고 구역',w:2,h:1.5,color:'#7065AD'},column:{name:'기둥',w:.5,h:.5,color:'#8B95A1'}};
  const copy=o=>JSON.parse(JSON.stringify(o));
  function geometry(py,shape) {
    const area=py*3.3058, ratio=shape==='long'?.55:shape==='wide'?1.8:1;
    const width=Math.sqrt(area*ratio/(shape==='ell'?.75:1)),height=width/ratio;
    return {width,height,cut:shape==='ell'?{x:width/2,y:0,w:width/2,h:height/2}:null};
  }
  function issue(state,item,ignore=item.id) {
    const g=geometry(state.py,state.shape);
    if(item.x<0||item.y<0||item.x+item.w>g.width+1e-8||item.y+item.h>g.height+1e-8) return '매장 경계를 벗어납니다';
    if(g.cut&&LandingPlanner.overlap(item,g.cut)) return 'ㄱ자형의 매장 밖 공간입니다';
    if(LandingPlanner.overlap(item,{x:g.width/2-.6,y:g.height-1.2,w:1.2,h:1.2})) return '입구 앞 1.2m 공간을 비워 주세요';
    if(state.items.some(r=>r.id!==ignore&&LandingPlanner.overlap(r,item))) return '다른 가구 또는 구역과 겹칩니다';
    return '';
  }
  function validate(data) {
    if(!data||data.version!==1||!Number.isInteger(data.py)||data.py<5||data.py>200||!Object.hasOwn(shapes,data.shape)||!Number.isInteger(data.profile)||!LandingPlanner.profiles[data.profile]||!Array.isArray(data.items)||data.items.length>250) throw Error('지원하지 않는 배치 파일입니다');
    const ids=new Set();
    const state={version:1,py:data.py,shape:data.shape,profile:data.profile,items:data.items.map(r=>{
      if(!r||!Object.hasOwn(kinds,r.kind)||!Number.isSafeInteger(r.id)||r.id<1||r.id>1000000||ids.has(r.id)||!['x','y','w','h'].every(k=>Number.isFinite(r[k]))||r.w<.1||r.h<.1||r.w>50||r.h>50) throw Error('가구 정보가 올바르지 않습니다');
      ids.add(r.id); return {id:r.id,kind:r.kind,x:r.x,y:r.y,w:r.w,h:r.h};
    })};
    if(state.items.some(r=>issue(state,r))) throw Error('경계 또는 겹침 문제가 있는 파일입니다');
    return state;
  }
  function mount() {
    const $=s=>document.querySelector(s), svg=$('#plan');
    let state={version:1,py:12,shape:'wide',profile:0,items:[]},selected=null,nextId=1,past=[],future=[],scale=1,ox=0,oy=0,moveMode=false,drag=null;
    const host=document.createElement('div'); host.className='editor-tools';
    host.innerHTML='<div class="editor-heading"><div><small>SPACE STUDIO</small><h3>직접 만드는 내 매장</h3></div><span id="editor-size"></span></div><label>공간 형태 <select id="editor-shape">'+Object.entries(shapes).map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join('')+'</select></label><div class="editor-row"><label>시작 구성 <select id="editor-preset"><option value="browse">둘러보는 매장</option><option value="experience">체험·상담 중심</option><option value="storage">재고·작업 중심</option><option value="empty">빈 공간</option></select></label><button type="button" id="editor-apply">구성 적용</button></div><p class="editor-help">가구를 눌러 선택한 뒤 끌거나, ‘위치 찍기’로 빈 곳을 누르세요. 모바일에서는 아래 이동 버튼도 사용할 수 있습니다.</p><div class="editor-palette">'+Object.entries(kinds).map(([k,v])=>'<button type="button" data-add="'+k+'"><span style="background:'+v.color+'"></span>'+v.name+' 추가</button>').join('')+'</div><div class="editor-row"><button type="button" id="editor-undo">되돌리기</button><button type="button" id="editor-redo">다시 실행</button><label>확대 <select id="editor-zoom"><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label></div>';
    svg.parentNode.insertBefore(host,svg.parentNode.firstChild);
    const viewport=document.createElement('div');viewport.className='editor-viewport';svg.before(viewport);viewport.append(svg);
    svg.setAttribute('role','group');svg.setAttribute('aria-label','직접 편집하는 매장 배치도');
    const panel=document.createElement('div'); panel.className='editor-inspector';
    panel.innerHTML='<p id="editor-status" role="status" aria-live="polite"></p><label>선택 가구 <select id="editor-selection"><option value="">선택 없음</option></select></label><div class="editor-row"><label>가로(m) <input id="editor-w" type="number" min="0.1" max="50" step="0.1"></label><label>세로(m) <input id="editor-h" type="number" min="0.1" max="50" step="0.1"></label><button type="button" id="editor-resize">크기 적용</button></div><div class="editor-row"><button type="button" id="editor-place" aria-pressed="false">위치 찍기</button><button type="button" id="editor-rotate">90° 회전</button><button type="button" id="editor-copy">복제</button><button type="button" id="editor-delete">삭제</button></div><div class="editor-row"><button type="button" data-move="0,-0.25">위로</button><button type="button" data-move="-0.25,0">왼쪽</button><button type="button" data-move="0.25,0">오른쪽</button><button type="button" data-move="0,0.25">아래로</button><small>한 번에 25cm</small></div><div class="editor-row"><button type="button" id="editor-export">배치 파일 저장</button><label class="editor-file">파일 불러오기<input id="editor-import" type="file" accept="application/json,.json"></label></div><p class="editor-help">배치 파일은 내 기기에 저장됩니다. 견적 문의에는 구성 요약만 전달됩니다. 도면 파일은 상담 때 별도로 전달해 주세요.</p>';
    viewport.after(panel);
    panel.lastElementChild.textContent='PNG 이미지 또는 편집용 파일로 저장할 수 있습니다. 이 배치로 견적 요청을 누르면 수량·공간 정보와 배치 이미지가 요청 화면으로 전달됩니다. 실제 제출 전 내용을 확인하세요.';
    const exportRow=document.createElement('div');exportRow.className='editor-row';
    exportRow.innerHTML='<button type="button" id="editor-image">배치 이미지 저장 (PNG)</button><button type="button" id="editor-request">이 배치로 견적 요청</button>';
    panel.append(exportRow);
    const say=t=>$('#editor-status').textContent=t;
    $('#editor-image').onclick=()=>{try{LandingPlanExport.download(state);say('배치 PNG 이미지 다운로드를 요청했습니다. 다운로드 목록을 확인해 주세요.');}catch(e){say(e.message);}};
    function requestLayout(e){e.preventDefault();try{LandingPlanExport.transfer(state);}catch(error){say('견적 요청으로 전달하지 못했습니다: '+error.message+' 배치 이미지를 저장해 직접 첨부할 수 있습니다.');}}
    $('#editor-request').onclick=requestLayout;
    $('#cfg-cta').onclick=requestLayout;
    function remember(){past.push(copy(state));if(past.length>50)past.shift();future=[];}
    function selection(){return state.items.find(r=>r.id===selected);}
    function sync(){
      $('#cfg-range').value=state.py;$('#cfg-area').value=state.py;$('#cfg-py').textContent=state.py+'평';$('#editor-shape').value=state.shape;
      document.querySelectorAll('#cfg-type .chip').forEach((b,i)=>{b.classList.toggle('is-on',i===state.profile);b.setAttribute('aria-pressed',i===state.profile);});
    }
    function render(){
      sync(); const g=geometry(state.py,state.shape);scale=Math.min(520/g.width,330/g.height);ox=(600-g.width*scale)/2;oy=38;
      const rect=(r,a)=>'<rect x="'+(ox+r.x*scale)+'" y="'+(oy+r.y*scale)+'" width="'+r.w*scale+'" height="'+r.h*scale+'" '+a+'/>';
      let s='<defs><pattern id="editor-grid" width="'+scale+'" height="'+scale+'" patternUnits="userSpaceOnUse" x="'+ox+'" y="'+oy+'"><path d="M '+scale+' 0 H 0 V '+scale+'" fill="none" stroke="#FFFFFF" stroke-opacity=".12"/></pattern></defs>';
      s+=rect({x:0,y:0,w:g.width,h:g.height},'fill="#1B2233" stroke="#8B95A1" stroke-width="2"');
      s+=rect({x:0,y:0,w:g.width,h:g.height},'fill="url(#editor-grid)"');
      if(g.cut)s+=rect(g.cut,'fill="#10141F" stroke="#8B95A1" stroke-dasharray="5 4"');
      s+=rect({x:g.width/2-.6,y:g.height-1.2,w:1.2,h:1.2},'fill="#318579" fill-opacity=".35"');
      state.items.forEach((r,i)=>{const bad=issue(state,r);s+='<g class="editor-item" data-id="'+r.id+'" role="button" tabindex="0" aria-label="'+kinds[r.kind].name+' '+r.id+'" aria-pressed="'+(selected===r.id)+'">'+rect(r,'rx="3" fill="'+kinds[r.kind].color+'" stroke="'+(bad?'#FF6B00':'#FFFFFF')+'" stroke-width="'+(selected===r.id?4:bad?3:1)+'"')+'<text pointer-events="none" x="'+(ox+(r.x+r.w/2)*scale)+'" y="'+(oy+(r.y+r.h/2)*scale)+'" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central" font-size="14">'+r.id+'</text></g>';});
      s+='<text x="300" y="410" fill="#FFFFFF" text-anchor="middle" font-size="18">입구 · 초록 영역은 비워 두세요</text>';svg.innerHTML=s;
      const p=LandingPlanner.profiles[state.profile],rackCount=state.items.filter(r=>r.kind==='rack').length;
      $('#cfg-result').innerHTML=Object.entries(kinds).map(([k,v])=>{const n=state.items.filter(r=>r.kind===k).length;return n?'<li>'+v.name+'<b>'+n+'<small>'+(k==='stock'?'구역':k==='rack'?'대':'개')+'</small></b></li>':'';}).join('')||'<li>빈 공간에서 시작해 보세요</li>';
      $('#legend').innerHTML='<span>격자 간격 1m</span><span>흰 테두리: 선택한 가구</span>';
      $('#editor-size').textContent=state.py+'평 · '+shapes[state.shape];
      const bad=state.items.filter(r=>issue(state,r)).length;
      $('#plan-note').textContent='외곽 '+g.width.toFixed(1)+' × '+g.height.toFixed(1)+'m'+(g.cut?' (ㄱ자 빈 영역 제외)':'')+' · 선반 '+rackCount+'대. '+(bad?bad+'개 가구의 겹침·경계를 수정해 주세요. ':'')+'상담용 스케치입니다. 통로 폭·피난·적재 하중·장비 회전·기둥 실측 기준은 검증하지 않습니다.';
      $('#cfg-cta').href='/request.html?rackType='+encodeURIComponent(p.island)+'&memo='+encodeURIComponent(p.name+' '+state.py+'평 '+shapes[state.shape]+', 직접 배치 선반 '+rackCount+'대, 기타 가구·구역 '+(state.items.length-rackCount)+'개. 실측 전 상담용 스케치. 배치 파일 별도 전달 예정.'+(bad?' 겹침·경계 조정 필요.':''));
      $('#editor-selection').innerHTML='<option value="">선택 없음</option>'+state.items.map(r=>'<option value="'+r.id+'">'+r.id+' · '+kinds[r.kind].name+'</option>').join('');$('#editor-selection').value=selected||'';
      const r=selection();$('#editor-w').value=r?r.w.toFixed(2):'';$('#editor-h').value=r?r.h.toFixed(2):'';
      ['resize','place','rotate','copy','delete'].forEach(a=>$('#editor-'+a).disabled=!r);panel.querySelectorAll('[data-move]').forEach(b=>b.disabled=!r);
      $('#editor-undo').disabled=!past.length;$('#editor-redo').disabled=!future.length;$('#editor-place').setAttribute('aria-pressed',moveMode);
    }
    function insert(kind,custom){
      if(state.items.length>=250){say('최대 250개까지 편집할 수 있습니다.');return;}
      const v=kinds[kind],p=LandingPlanner.profiles[state.profile],g=geometry(state.py,state.shape);
      const r={id:nextId,kind,w:custom?custom.w:kind==='rack'?p.bay:v.w,h:custom?custom.h:kind==='rack'?p.depth:v.h,x:0,y:0};
      for(let y=.25;y+r.h<=g.height;y+=.25)for(let x=.25;x+r.w<=g.width;x+=.25){r.x=x;r.y=y;if(!issue(state,r)){remember();nextId++;state.items.push({...r});selected=r.id;render();say(v.name+'을 추가했습니다. 위치와 크기를 조정하세요.');return;}}
      say('이 크기로 추가할 빈 공간이 없습니다. 크기나 배치를 조정해 주세요.');
    }
    function change(patch){const r=selection();if(!r)return;const next={...r,...patch},error=issue(state,next);if(error){say(error);render();return false;}remember();Object.assign(r,next);render();say(kinds[r.kind].name+' 위치·크기를 변경했습니다.');return true;}
    function preset(name){remember();state.items=[];selected=null;nextId=1;const g=geometry(state.py,state.shape),p=LandingPlanner.profiles[state.profile];
      function add(kind,x,y,w,h){const r={id:nextId,kind,x,y,w:w||kinds[kind].w,h:h||kinds[kind].h};if(!issue(state,r)){state.items.push(r);nextId++;}}
      if(name!=='empty'){
        add('counter',.25,g.height-1.9);
        const count=name==='storage'?8:4;
        for(let n=0;n<count;n++){const x=.25+(n%2)*(p.bay+1.4),y=.25+Math.floor(n/2)*(p.depth+1.4);add('rack',x,y,p.bay,p.depth);}
        if(name==='experience'){add('table',g.width*.35,g.height*.48);add('table',g.width*.35,g.height*.7);}
        if(name==='storage')add('stock',g.width-2.25,.25);
      }
      render();say('시작 구성을 적용했습니다. 필요한 가구만 더해 나만의 동선을 만들어 보세요.');
    }
    host.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>insert(b.dataset.add));
    $('#editor-shape').onchange=e=>{remember();state.shape=e.target.value;render();say('공간 형태를 바꿨습니다. 기존 가구는 유지되며 경계 밖 가구는 주황 테두리로 표시합니다.');};
    $('#editor-apply').onclick=()=>preset($('#editor-preset').value);
    $('#editor-selection').onchange=e=>{selected=Number(e.target.value)||null;render();};
    $('#editor-resize').onclick=()=>{const w=Number($('#editor-w').value),h=Number($('#editor-h').value);if(w<.1||h<.1||w>50||h>50||!Number.isFinite(w+h)){say('가로·세로는 0.1~50m로 입력하세요.');return;}change({w,h});};
    $('#editor-rotate').onclick=()=>{const r=selection();if(r)change({w:r.h,h:r.w});};
    $('#editor-copy').onclick=()=>{const r=selection();if(r)insert(r.kind,r);};
    $('#editor-delete').onclick=()=>{remember();state.items=state.items.filter(r=>r.id!==selected);selected=null;render();say('선택한 가구를 삭제했습니다. 되돌리기로 복원할 수 있습니다.');};
    panel.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{const r=selection(),d=b.dataset.move.split(',').map(Number);if(r)change({x:r.x+d[0],y:r.y+d[1]});});
    $('#editor-place').onclick=()=>{moveMode=!moveMode;render();say(moveMode?'배치도에서 가구 중심을 놓을 위치를 누르세요.':'위치 찍기를 종료했습니다.');};
    function history(from,to){if(!from.length)return;to.push(copy(state));state=from.pop();selected=null;nextId=Math.max(0,...state.items.map(r=>r.id))+1;render();say('배치를 복원했습니다.');}
    $('#editor-undo').onclick=()=>history(past,future);$('#editor-redo').onclick=()=>history(future,past);
    $('#editor-zoom').onchange=e=>{svg.style.width=Number(e.target.value)*100+'%';};
    function point(e){const m=svg.getScreenCTM();if(!m)return null;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());return {x:(p.x-ox)/scale,y:(p.y-oy)/scale};}
    svg.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-id]'),p=point(e);if(!p)return;
      if(moveMode&&selection()){const r=selection();if(change({x:Math.round((p.x-r.w/2)*4)/4,y:Math.round((p.y-r.h/2)*4)/4})){moveMode=false;render();}return;}
      if(!b)return;selected=Number(b.dataset.id);const r=selection();drag={start:p,original:{...r},last:p};render();svg.setPointerCapture(e.pointerId);e.preventDefault();
    });
    svg.addEventListener('pointermove',e=>{if(!drag)return;drag.last=point(e)||drag.last;const el=svg.querySelector('[data-id="'+selected+'"]');if(el)el.setAttribute('transform','translate('+((drag.last.x-drag.start.x)*scale)+' '+((drag.last.y-drag.start.y)*scale)+')');});
    svg.addEventListener('pointerup',()=>{if(!drag)return;const d=drag;drag=null;const dx=d.last.x-d.start.x,dy=d.last.y-d.start.y;if(Math.abs(dx)+Math.abs(dy)<.08){render();say('선택했습니다. 이동·회전·크기 변경을 사용할 수 있습니다.');return;}change({x:Math.round((d.original.x+dx)*4)/4,y:Math.round((d.original.y+dy)*4)/4});});
    svg.addEventListener('pointercancel',()=>{drag=null;render();});
    svg.addEventListener('keydown',e=>{const b=e.target.closest('[data-id]');if(!b)return;selected=Number(b.dataset.id);const r=selection(),d={ArrowUp:[0,-.25],ArrowDown:[0,.25],ArrowLeft:[-.25,0],ArrowRight:[.25,0]}[e.key];if(d){e.preventDefault();change({x:r.x+d[0],y:r.y+d[1]});}else if(e.key==='Enter'||e.key===' '){e.preventDefault();render();}else return;svg.querySelector('[data-id="'+selected+'"]')?.focus();});
    $('#editor-export').onclick=()=>{if(state.items.some(r=>issue(state,r))){say('겹침·경계 문제를 수정한 뒤 저장해 주세요.');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='중용랙-매장배치-'+state.py+'평.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('배치 파일을 다운로드했습니다. 같은 화면에서 다시 불러올 수 있습니다.');};
    $('#editor-import').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>100000)throw Error('파일은 100KB 이하여야 합니다');const data=validate(JSON.parse(await f.text()));remember();state=data;selected=null;nextId=Math.max(0,...state.items.map(r=>r.id))+1;render();say('배치 파일을 불러왔습니다.');}catch(error){say('불러오기 실패: '+error.message);}e.target.value='';};
    preset('browse');past=[];render();
    return {update(py,profile){py=Math.max(5,Math.min(200,Math.round(Number(py)||5)));if(py!==state.py||profile!==state.profile){remember();state.py=py;state.profile=profile;render();say('조건을 변경했습니다. 기존 가구는 유지됩니다. 경계를 확인하거나 시작 구성을 다시 적용하세요.');}else render();}};
  }
  return {mount,geometry,issue,validate};
})();
