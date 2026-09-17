/** precheck.js — 견적 저장/공유 전 규칙 검사 */
(function (root) {
  function appRef() { try { if (typeof App!=='undefined' && App) return App; } catch (_) {} return null; }
  function wizardRef() { try { if (typeof EstimateWizard!=='undefined' && EstimateWizard) return EstimateWizard; } catch (_) {} return null; }
  function uiRef() { try { if (typeof UI!=='undefined' && UI) return UI; } catch (_) {} return null; }
  'use strict';

  function array(value) {
    if (Array.isArray(value)) return value;
    if (typeof value==='string') { try { return JSON.parse(value); } catch (_) { return []; } }
    return [];
  }
  function amount(item) {
    return (Number(item.unitPrice)||0)*(Number(item.quantity)||0)+(item.itemType==='custom'?0:(Number(item.installFee)||0)*(Number(item.quantity)||0));
  }
  function samePriceRow(item,row) {
    if (!row||Number(row.unitPrice)<=0) return false;
    if (String(row.type||'')!==String(item.type||'')||String(row.form||'')!==String(item.form||'')) return false;
    if (String(row.spec||'')!==String(item.spec||'')||String(row.tier||'')!==String(item.tier||'')) return false;
    return ['layoutType','setName','partCategory'].every(function (key) { return !item[key]||String(row[key]||'')===String(item[key]||''); });
  }
  function customerHistory(history,customer) {
    var estimates=Array.isArray(history)?history:array(history&&history.estimates);
    var name=String(customer&&customer.name||'').trim();
    var phone=String(customer&&customer.phone||'').replace(/\D/g,'');
    return estimates.filter(function (estimate) {
      var estimateName=String(estimate.customerName||estimate.name||'').trim();
      var estimatePhone=String(estimate.phone||'').replace(/\D/g,'');
      return (name&&estimateName===name)||(phone&&estimatePhone===phone);
    });
  }
  function reprice(items, prices) {
    var changed = 0;
    var result = array(items).map(function(item) {
      if (item.itemType === 'custom') return Object.assign({}, item);
      var matches = array(prices).filter(function(row) { return samePriceRow(item, row); });
      if (matches.length !== 1) throw new Error('현재 단가표에서 품목을 하나로 확정할 수 없습니다: ' + (item.type || '') + ' ' + (item.spec || ''));
      var row = matches[0];
      if (Number(item.unitPrice) !== Number(row.unitPrice) || Number(item.installFee || 0) !== Number(row.installFee || 0)) changed++;
      return Object.assign({}, item, { unitPrice: Number(row.unitPrice), installFee: Number(row.installFee) || 0, vat: row.vat || item.vat });
    });
    return { items: result, changed: changed };
  }
  function historyQuantity(estimate) {
    if (Number(estimate.totalQuantity)>0) return Number(estimate.totalQuantity);
    return array(estimate.items).filter(function (item) { return item.itemType!=='custom'; })
      .reduce(function (sum,item) { return sum+(Number(item.quantity)||0); },0);
  }
  function duplicateKey(item) {
    return [item.type||'',item.form||'',item.spec||'',item.tier||'',item.layoutType||'',item.setName||'',item.partCategory||''].join('|');
  }
  function issue(code,message,step,extra) {
    return Object.assign({ code:code,message:message,step:step },extra||{});
  }

  function run(items,customer,totals,history) {
    items=array(items); customer=customer||{}; totals=totals||{};
    var blocks=[],warns=[];
    var priceData=array(history&&history.priceData);
    if (!priceData.length&&appRef()) priceData=array(appRef().priceData);
    var unpriced=items.filter(function (item) { return item.unitPrice==null||item.unitPrice===''||Number(item.unitPrice)===0; });
    if (unpriced.length) blocks.push(issue('unpriced','단가가 0원이거나 입력되지 않은 품목이 있습니다',1,{indices:unpriced.map(function (item) { return items.indexOf(item); })}));
    var unmatched=items.filter(function (item) {
      return item.itemType!=='custom'&&priceData.length&&!priceData.some(function (row) { return samePriceRow(item,row); });
    });
    if (unmatched.length) blocks.push(issue('unmatched','단가표와 정확히 일치하지 않는 품목이 있습니다',1,{indices:unmatched.map(function (item) { return items.indexOf(item); })}));
    var outdated = items.filter(function(item) {
      return item.itemType !== 'custom' && priceData.some(function(row) { return samePriceRow(item,row) && (Number(row.unitPrice) !== Number(item.unitPrice) || Number(row.installFee || 0) !== Number(item.installFee || 0)); });
    });
    if (outdated.length) warns.push(issue('price_changed','현재 단가표와 금액이 다른 품목이 있습니다. 기존 계약 단가인지 확인하세요.',6));
    var badQty=items.filter(function (item) { return !Number.isFinite(Number(item.quantity))||Number(item.quantity)<=0; });
    if (badQty.length) blocks.push(issue('quantity','수량이 0 이하인 품목이 있습니다',3,{indices:badQty.map(function (item) { return items.indexOf(item); })}));
    var missingSpec=items.filter(function (item) { return item.itemType!=='custom'&&!String(item.spec||item.setName||'').trim(); });
    if (missingSpec.length) blocks.push(issue('dimensions','치수가 누락된 품목이 있습니다',2,{indices:missingSpec.map(function (item) { return items.indexOf(item); })}));
    var discounts=items.filter(function (item) { return item.itemType==='custom'&&Number(item.unitPrice)<0; }).reduce(function (sum,item) { return sum+Math.abs(amount(item)); },0);
    var total=Number(totals.total);
    if (!Number.isFinite(total)) total=items.reduce(function (sum,item) { return sum+amount(item); },0);
    if (total<0||discounts>total+discounts) blocks.push(issue('discount','할인이 할인 전 총액을 초과했거나 총액이 음수입니다',4));
    var margins=items.filter(function (item) { return item.itemType==='custom'&&String(item.name||'').indexOf('마진')>=0; });
    if (margins.length>=2) blocks.push(issue('margin_duplicate','마진 항목이 두 번 이상 적용되었습니다',4,{indices:margins.map(function (item) { return items.indexOf(item); })}));

    var rackItems=items.filter(function (item) { return item.itemType!=='custom'; });
    var linkedTypes={};
    rackItems.forEach(function (item) { if (String(item.form||'').indexOf('연결')>=0) linkedTypes[item.type]=true; });
    var linkedOnly=Object.keys(linkedTypes).filter(function (type) { return !rackItems.some(function (item) { return item.type===type&&String(item.form||'').indexOf('독립')>=0; }); });
    if (linkedOnly.length) warns.push(issue('linked_only','연결형만 있고 독립형이 없는 종류가 있습니다: '+linkedOnly.join(', '),1));
    var past=customerHistory(history,customer);
    var pastQty=past.map(historyQuantity).filter(function (value) { return value>0; });
    var avgQty=pastQty.length?pastQty.reduce(function (a,b) { return a+b; },0)/pastQty.length:0;
    var unusualQty=rackItems.filter(function (item) { return Number(item.quantity)>100||(avgQty>0&&Number(item.quantity)>avgQty*10); });
    if (unusualQty.length) warns.push(issue('quantity_outlier','100대를 초과하거나 같은 고객의 평소 수량보다 10배 큰 품목이 있습니다',3));
    var pastTotals=past.map(function (estimate) { return Number(estimate.total); }).filter(function (value) { return value>0; });
    var avgTotal=pastTotals.length?pastTotals.reduce(function (a,b) { return a+b; },0)/pastTotals.length:0;
    if (avgTotal>0&&total>avgTotal*5) warns.push(issue('total_outlier','총액이 같은 고객의 과거 평균보다 5배 큽니다',6));
    var groups={};
    rackItems.forEach(function (item) { var key=duplicateKey(item); (groups[key]||(groups[key]=[])).push(items.indexOf(item)); });
    Object.keys(groups).filter(function (key) { return groups[key].length>1; }).forEach(function (key) {
      warns.push(issue('duplicate','같은 종류·형태·규격의 중복 행이 있습니다',6,{key:key,indices:groups[key],action:'merge'}));
    });
    if (margins.length) {
      var marginTotal=margins.reduce(function (sum,item) { return sum+amount(item); },0);
      var base=items.filter(function (item) { return margins.indexOf(item)<0&&Number(item.unitPrice)>0; }).reduce(function (sum,item) { return sum+amount(item); },0);
      var rate=base>0?marginTotal/base*100:0;
      if (rate<5||rate>45) warns.push(issue('margin_rate','마진율이 5% 미만이거나 45%를 초과합니다',4,{rate:rate}));
    }
    if (!String(customer.name||'').trim()) warns.push(issue('customer_name','고객명이 입력되지 않았습니다',5));
    return { blocks:blocks,warns:warns };
  }

  function mergeDuplicates(items,key) {
    var result=array(items).map(function (item) { return Object.assign({},item); });
    var indexes=[];
    result.forEach(function (item,index) { if (duplicateKey(item)===key) indexes.push(index); });
    if (indexes.length<2) return result;
    result[indexes[0]].quantity=indexes.reduce(function (sum,index) { return sum+(Number(result[index].quantity)||0); },0);
    return result.filter(function (_,index) { return indexes.slice(1).indexOf(index)<0; });
  }

  root.Precheck={ run:run,mergeDuplicates:mergeDuplicates,duplicateKey:duplicateKey,reprice:reprice };
})(typeof window!=='undefined'?window:globalThis);
