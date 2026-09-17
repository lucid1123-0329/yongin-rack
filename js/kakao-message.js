/** kakao-message.js — 카카오톡용 고정 견적 안내 문구 */
(function (root) {
  'use strict';

  function itemsOf(estimate) {
    var items=estimate&&estimate.items||[];
    if (typeof items==='string') { try { items=JSON.parse(items); } catch (_) { items=[]; } }
    return Array.isArray(items)?items:[];
  }
  function itemSummary(estimate) {
    var items=itemsOf(estimate).filter(function (item) { return item.itemType!=='custom'; });
    if (!items.length) return '견적 품목';
    var totalQty=items.reduce(function (sum,item) { return sum+(Number(item.quantity)||0); },0);
    var first=items[0].type||items[0].name||'랙';
    return items.length>1?first+' 외 '+(items.length-1)+'종 '+totalQty+'대':first+' '+totalQty+'대';
  }
  function estimateTotal(estimate) {
    if (Number.isFinite(Number(estimate&&estimate.total))) return Number(estimate.total);
    if (root.Calc&&typeof root.Calc.calcTotals==='function') return Number(root.Calc.calcTotals(itemsOf(estimate)).total)||0;
    return itemsOf(estimate).reduce(function (sum,item) {
      var qty=Number(item.quantity)||0;
      return sum+((Number(item.unitPrice)||0)+(item.itemType==='custom'?0:(Number(item.installFee)||0)))*qty;
    },0);
  }
  function validUntil(estimate) {
    var raw=estimate&&(estimate.date||estimate.createdAt||estimate.timestamp);
    var date=raw?new Date(raw):new Date();
    if (Number.isNaN(date.getTime())) date=new Date();
    date.setDate(date.getDate()+30);
    return date.getFullYear()+'.'+String(date.getMonth()+1).padStart(2,'0')+'.'+String(date.getDate()).padStart(2,'0');
  }
  function build(estimate,branding) {
    estimate=estimate||{}; branding=branding||{};
    var customer=String(estimate.customerName||estimate.name||'고객').trim()||'고객';
    var total=estimateTotal(estimate).toLocaleString('ko-KR')+'원 (VAT 포함)';
    var phone=String(branding.phone||'').trim()||'담당자 연락처';
    return '안녕하세요, '+customer+'님. 요청하신 '+itemSummary(estimate)+' 견적서를 보내드립니다.\n'+
      '총 견적금액은 '+total+'이며, 견적 유효기간은 '+validUntil(estimate)+'까지입니다.\n'+
      '규격·수량 확인 부탁드리고, 문의는 '+phone+'로 주세요. 감사합니다.';
  }

  root.KakaoMessage={ build:build,itemSummary:itemSummary,validUntil:validUntil };
})(typeof window!=='undefined'?window:globalThis);
