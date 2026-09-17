const RequestLayout = (() => {
  let attachment=null,blocked=false;
  const id=new URLSearchParams(location.search).get('layout');
  if(!id)return {photo:()=>null,blocked:()=>false,clear:()=>{}};
  const panel=document.createElement('section');panel.className='bg-white rounded-xl p-5 mb-5';panel.setAttribute('aria-label','전달된 매장 배치');
  const title=document.createElement('h2');title.className='text-lg font-bold';title.textContent='배치도로 견적 요청';panel.append(title);
  const status=document.createElement('p');status.className='text-sm mt-2';panel.append(status);
  const image=document.createElement('img');image.alt='견적 요청에 함께 첨부할 상담용 배치도';image.className='mt-3';image.hidden=true;panel.append(image);
  const remove=document.createElement('button');remove.type='button';remove.className='mt-3 underline text-sm';remove.textContent='배치 첨부 없이 직접 작성';panel.append(remove);
  document.getElementById('request-form').before(panel);
  const clear=()=>{try{sessionStorage.removeItem('yr-plan-'+id);}catch{}};
  remove.onclick=()=>{attachment=null;blocked=false;clear();image.hidden=true;status.textContent='배치 이미지 첨부를 제외했습니다. 자동 입력된 수량과 요청사항은 필요에 맞게 수정하세요.';remove.hidden=true;};
  try{
    if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('배치 링크가 올바르지 않습니다.');
    const raw=sessionStorage.getItem('yr-plan-'+id);if(!raw||raw.length>100000)throw Error('이 탭에 전달된 배치가 없습니다. 매장 편집기에서 다시 이동해 주세요.');
    const data=JSON.parse(raw);if(!Number.isFinite(data.createdAt)||Date.now()-data.createdAt>86400000||data.createdAt>Date.now()+60000)throw Error('배치 전달 시간이 만료되었습니다. 편집기에서 다시 이동해 주세요.');
    const info=LandingPlanExport.summary(data.state),url=LandingPlanExport.canvas(info.state).toDataURL('image/jpeg',.88),base64=url.split(',')[1];
    if(base64.length>2000000)throw Error('배치 이미지가 너무 큽니다. PNG로 저장한 뒤 별도 전달해 주세요.');
    attachment={data:base64,mimeType:'image/jpeg'};image.src=url;image.hidden=false;
    document.getElementById('req-rack').value=info.rackType;
    document.getElementById('req-qty').value=info.quantity||'';
    document.getElementById('req-memo').value=info.memo;
    status.textContent=info.title+' · 선반 '+info.quantity+'대. 배치 이미지 1장이 함께 제출됩니다. 추가 현장 사진은 최대 4장입니다. 성함·연락처·현장 정보를 확인하고 제출해 주세요. 높이·단수·제품 규격과 금액은 상담 후 확정됩니다.';
  }catch(e){blocked=true;status.textContent=e.message+' 배치 없이 진행하려면 아래 버튼을 눌러 주세요.';}
  return {photo:()=>attachment,blocked:()=>blocked,clear};
})();
