/* Deterministic drawing of the customer's plan; no external images or AI involved. */
const LandingPlanExport = (() => {
  const labels={rack:'선반',counter:'계산대',table:'체험 테이블',stock:'재고 구역',column:'기둥'};
  const colors={rack:'#2F6BFF',counter:'#FF6B00',table:'#318579',stock:'#7065AD',column:'#8B95A1'};
  const shapes={wide:'가로형',long:'세로형',square:'정사각형',ell:'ㄱ자형'};
  function summary(input){
    const s=LandingEditor.validate(input),g=LandingEditor.geometry(s.py,s.shape),p=LandingPlanner.profiles[s.profile];
    const quantity=s.items.filter(r=>r.kind==='rack').length;
    return {state:s,quantity,rackType:quantity?p.island:'',title:p.name+' '+s.py+'평 '+shapes[s.shape],
      memo:'[직접 배치 상담] '+p.name+' '+s.py+'평 '+shapes[s.shape]+' / 외곽 '+g.width.toFixed(2)+'×'+g.height.toFixed(2)+'m'+(g.cut?' (ㄱ자 제외 영역 있음)':'')+' / 선반 '+quantity+'대. 배치도 이미지를 첨부합니다. 그림의 가로·세로는 바닥 점유 치수이며 회전될 수 있습니다. 랙 종류는 업종 기반 후보이고 높이·단수·하중·규격·설치비는 상담 후 확정합니다. 계산대·테이블·기둥·재고 구역은 선반 견적 수량에서 제외합니다.'};
  }
  function canvas(input){
    const info=summary(input),s=info.state,g=LandingEditor.geometry(s.py,s.shape);
    const c=document.createElement('canvas');c.width=1400;c.height=950+Math.ceil(s.items.length/2)*28;
    const ctx=c.getContext('2d');if(!ctx)throw Error('이 브라우저에서는 이미지 저장을 지원하지 않습니다.');
    ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#191F28';ctx.font='bold 32px sans-serif';ctx.fillText('중용랙 · '+info.title,40,55);
    ctx.font='20px sans-serif';ctx.fillText('상담용 배치도 · 실측 전 가정 / 외곽 '+g.width.toFixed(2)+' × '+g.height.toFixed(2)+'m / 선반 '+info.quantity+'대',40,95);
    const scale=Math.min(1240/g.width,620/g.height),ox=(1400-g.width*scale)/2,oy=130;
    const box=(r,color)=>{ctx.fillStyle=color;ctx.fillRect(ox+r.x*scale,oy+r.y*scale,r.w*scale,r.h*scale);};
    box({x:0,y:0,w:g.width,h:g.height},'#F2F4F6');ctx.strokeStyle='#8B95A1';ctx.strokeRect(ox,oy,g.width*scale,g.height*scale);
    ctx.strokeStyle='#DDE1E6';ctx.lineWidth=1;
    for(let x=0;x<g.width;x++){ctx.beginPath();ctx.moveTo(ox+x*scale,oy);ctx.lineTo(ox+x*scale,oy+g.height*scale);ctx.stroke();}
    for(let y=0;y<g.height;y++){ctx.beginPath();ctx.moveTo(ox,oy+y*scale);ctx.lineTo(ox+g.width*scale,oy+y*scale);ctx.stroke();}
    if(g.cut)box(g.cut,'#FFFFFF');box({x:g.width/2-.6,y:g.height-1.2,w:1.2,h:1.2},'#BFE3D2');
    s.items.forEach(r=>{box(r,colors[r.kind]);ctx.fillStyle='#FFFFFF';ctx.font='bold 18px sans-serif';ctx.textAlign='center';ctx.fillText(String(r.id),ox+(r.x+r.w/2)*scale,oy+(r.y+r.h/2)*scale+6);});
    ctx.textAlign='left';ctx.fillStyle='#191F28';ctx.font='20px sans-serif';
    ctx.fillText('입구: 아래 중앙 초록 영역 / 격자 1m / 좌표 기준: 외곽 왼쪽 위',40,790);
    ctx.fillText('실제 설치·피난·통로·적재 하중 기준을 검증한 도면이 아닙니다.',40,822);
    ctx.fillText('바닥 점유 치수와 위치입니다. 랙 높이·단수·규격·금액은 별도 상담합니다.',40,854);
    ctx.font='bold 20px sans-serif';ctx.fillText('배치 목록 — 번호 / 항목 / 가로×세로(m) / 위치 x,y(m)',40,900);ctx.font='18px sans-serif';
    s.items.forEach((r,i)=>{ctx.fillStyle=colors[r.kind];ctx.fillRect(40+(i%2)*680,925+Math.floor(i/2)*28,12,12);ctx.fillStyle='#191F28';ctx.fillText(r.id+' · '+labels[r.kind]+' · '+r.w.toFixed(2)+'×'+r.h.toFixed(2)+'m · 위치 '+r.x.toFixed(2)+','+r.y.toFixed(2),62+(i%2)*680,938+Math.floor(i/2)*28);});
    return c;
  }
  function download(input){const s=summary(input),a=document.createElement('a');a.download='중용랙-배치도-'+s.state.py+'평.png';a.href=canvas(s.state).toDataURL('image/png');a.click();}
  function transfer(input){const info=summary(input);if(!info.quantity)throw Error('견적 요청할 선반을 먼저 추가해 주세요.');
    const id=crypto.randomUUID();sessionStorage.setItem('yr-plan-'+id,JSON.stringify({createdAt:Date.now(),state:info.state}));
    location.assign('/request.html?layout='+encodeURIComponent(id));
  }
  return {summary,canvas,download,transfer};
})();
