/**
 * calc.js — 견적 금액 계산 공통 모듈
 * app.js와 estimate.js에서 공유하여 계산 로직 불일치 방지
 */

const Calc = (() => {
  'use strict';

  /**
   * 견적 항목 배열로부터 공급가액, 부가세, 합계를 계산
   * @param {Array} items - 견적 항목 배열
   * @returns {{ supplyTotal, vat, total, dcTotal, items }}
   */
  function calcTotals(items) {
    if (!items || items.length === 0) {
      return { supplyTotal: 0, vat: 0, total: 0, dcTotal: 0, items: [] };
    }

    var supply = 0;
    var dcTotal = 0; // D/C 합산 (음수, VAT포함 총액 기준)

    var itemDetails = items.map(function (item) {
      var isCustom = item.itemType === 'custom';
      var isDC = isCustom && (item.name || '').indexOf('D/C') !== -1;

      if (isDC) {
        var amount = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);
        dcTotal += amount; // 음수값 합산
        return assign(item, { itemTotal: amount });
      } else if (isCustom) {
        var amt = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);
        supply += amt;
        return assign(item, { itemTotal: amt });
      } else {
        var subtotal = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0);
        var installTotal = (Number(item.installFee) || 0) * (Number(item.quantity) || 0);
        var itemTotal = subtotal + installTotal;
        supply += itemTotal;
        return assign(item, { subtotal: subtotal, installTotal: installTotal, itemTotal: itemTotal });
      }
    });

    // D/C는 총액(VAT포함) 기준 → 공급가액/세액 역산 분리
    var dcSupply = Math.round(dcTotal * 10 / 11);
    var dcVat = dcTotal - dcSupply;
    var supplyTotal = supply + dcSupply;
    var vat = Math.round(supply * 0.1) + dcVat;
    var total = supplyTotal + vat;

    return { supplyTotal: supplyTotal, vat: vat, total: total, dcTotal: dcTotal, items: itemDetails };
  }

  // Object.assign 폴리필 대용 (간단한 shallow merge)
  function assign(target, src) {
    var obj = {};
    for (var k in target) { if (target.hasOwnProperty(k)) obj[k] = target[k]; }
    for (var k2 in src) { if (src.hasOwnProperty(k2)) obj[k2] = src[k2]; }
    return obj;
  }

  return { calcTotals: calcTotals };
})();
