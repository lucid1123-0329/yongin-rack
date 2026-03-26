/**
 * estimate.js — 견적서 + 거래명세표 렌더링/공유/다운로드
 * - renderPreview: 간편 견적서 (카드 스타일)
 * - renderFormalQuotation: 정식 견적서 (한국 표준 테이블)
 * - renderTransactionStatement: 거래명세표 (공급받는자/공급자 양식)
 */

const Estimate = (() => {

  let _brandingCache = null;
  let _brandingCacheTs = 0;
  const BRANDING_CACHE_TTL = 60000; // 1 minute

  function getBranding() {
    const now = Date.now();
    if (_brandingCache && (now - _brandingCacheTs < BRANDING_CACHE_TTL)) return _brandingCache;
    try {
      _brandingCache = JSON.parse(localStorage.getItem('yr_branding')) || {};
    } catch {
      _brandingCache = {};
    }
    _brandingCacheTs = now;
    return _brandingCache;
  }

  // ---------- 공통 유틸 ----------
  function fmt(n) { return UI.formatNumber(n); }
  function fmtW(n) { return UI.formatCurrency(n); }
  function parseItems(data) {
    let items = data.items || [];
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch { items = []; }
    }
    return items;
  }

  function calcTotals(items, data) {
    let supply = 0;
    let dcTotal = 0; // D/C 총액 (음수, VAT 포함 기준)
    items.forEach(item => {
      const isCustom = item.itemType === 'custom';
      const isDC = isCustom && (item.name || '').includes('D/C');
      if (isDC) {
        dcTotal += (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);
      } else if (isCustom) {
        supply += (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);
      } else {
        supply += ((Number(item.unitPrice) || 0) + (Number(item.installFee) || 0)) * (Number(item.quantity) || 0);
      }
    });
    // D/C는 총액(VAT포함) 기준 → 공급가액/세액 역산 분리
    const dcSupply = Math.round(dcTotal * 10 / 11);
    const dcVat = dcTotal - dcSupply;
    const supplyTotal = supply + dcSupply;
    const vat = Math.round(supply * 0.1) + dcVat;
    const total = supplyTotal + vat;
    return { supplyTotal, vat, total, dcTotal };
  }

  function formatDateKr(dateStr) {
    if (!dateStr) {
      const d = new Date();
      return `${d.getFullYear()}년 ${String(d.getMonth()+1).padStart(2,'0')}월 ${String(d.getDate()).padStart(2,'0')}일`;
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getFullYear()}년 ${String(d.getMonth()+1).padStart(2,'0')}월 ${String(d.getDate()).padStart(2,'0')}일`;
  }

  function getItemName(item) {
    if (item.itemType === 'custom') return item.name || '';
    return `${item.type || ''}${item.form ? `(${item.form})` : ''}`;
  }

  function getItemSpec(item) {
    if (item.itemType === 'custom') return '';
    const spec = item.spec || '';
    const tierStr = item.tier ? `*${item.tier}s` : '';
    return spec + tierStr;
  }

  function getItemUnit(item) {
    if (item.itemType === 'custom') return '식';
    return '대';
  }

  // ---------- 마진 단가 배분 ----------
  // 마진 항목을 제거하고, 마진 금액을 랙 항목 단가에 비례 배분
  function applyMarginToUnitPrices(items) {
    // 마진 항목 찾기
    const marginItems = items.filter(i => i.itemType === 'custom' && (i.name || '').includes('마진'));
    if (marginItems.length === 0) return items;

    const totalMargin = marginItems.reduce((sum, i) => sum + (Number(i.unitPrice) || 0) * (Number(i.quantity) || 1), 0);
    if (totalMargin <= 0) return items;

    // 랙 항목만 추출
    const rackItems = items.filter(i => i.itemType !== 'custom');
    const otherCustom = items.filter(i => i.itemType === 'custom' && !(i.name || '').includes('마진'));

    // 랙 소계 (배분 비율 기준)
    const rackTotal = rackItems.reduce((sum, i) => {
      return sum + ((Number(i.unitPrice) || 0) + (Number(i.installFee) || 0)) * (Number(i.quantity) || 0);
    }, 0);

    if (rackTotal <= 0) return items;

    // 각 랙 항목에 마진 비례 배분
    let distributed = 0;
    const adjustedRacks = rackItems.map((item, idx) => {
      const itemTotal = ((Number(item.unitPrice) || 0) + (Number(item.installFee) || 0)) * (Number(item.quantity) || 0);
      const ratio = itemTotal / rackTotal;
      const qty = Number(item.quantity) || 1;

      // 마지막 항목은 잔여분 할당 (반올림 오차 보정)
      let marginShare;
      if (idx === rackItems.length - 1) {
        marginShare = totalMargin - distributed;
      } else {
        marginShare = Math.round(totalMargin * ratio);
        distributed += marginShare;
      }

      // 단가에 마진 배분 (대당)
      const perUnit = Math.round(marginShare / qty);
      return {
        ...item,
        unitPrice: (Number(item.unitPrice) || 0) + perUnit,
      };
    });

    return [...adjustedRacks, ...otherCustom];
  }

  // 테이블 공통 스타일 (인라인 — html2canvas 호환)
  // 셀 내부 flex 컨테이너로 강제 수직 중앙 (html2canvas 호환)
  const fc = 'display:flex;align-items:center;justify-content:center;min-height:30px;';
  const fcL = 'display:flex;align-items:center;min-height:30px;';
  const fcR = 'display:flex;align-items:center;justify-content:flex-end;min-height:30px;';
  const fcSm = 'display:flex;align-items:center;justify-content:center;min-height:26px;';
  const fcSmL = 'display:flex;align-items:center;min-height:26px;';

  function w(text, style) { return `<div style="${style || fc}">${text}</div>`; }

  const S = {
    table: 'width:100%;border-collapse:collapse;font-size:12px;',
    // item 테이블: padding 0 + flex 래퍼(w함수)로 수직 중앙
    th: 'border:1px solid #333;padding:0 8px;background:#f5f5f5;font-weight:bold;text-align:center;font-size:11px;',
    td: 'border:1px solid #333;padding:0 8px;',
    tdL: 'border:1px solid #333;padding:0 8px;',
    tdR: 'border:1px solid #333;padding:0 8px;',
    // info 섹션: padding + vertical-align:middle (html2canvas-pro에서 정상 지원)
    thHeader: 'border:1px solid #333;padding:6px 8px;background:#e8e8e8;font-weight:bold;text-align:center;font-size:13px;vertical-align:middle;',
    infoTd: 'border:1px solid #333;padding:6px 8px;font-size:12px;vertical-align:middle;word-break:keep-all;',
    infoTh: 'border:1px solid #333;padding:6px 8px;background:#f0f0f0;font-weight:bold;font-size:11px;text-align:center;width:70px;white-space:nowrap;vertical-align:middle;',
  };

  // ========== 정식 견적서 ==========
  function renderFormalQuotation(data, options) {
    const brand = getBranding();
    let items = parseItems(data);
    if (options && options.hideMargin) items = applyMarginToUnitPrices(items);
    const { supplyTotal, vat, total } = calcTotals(items, { ...data, supplyTotal: 0, vat: 0, total: 0 });
    const dateKr = formatDateKr(data.date);
    const koreanAmount = UI.numberToKorean ? `일금 ${UI.numberToKorean(total)}원정` : '';

    // 빈 행 채우기 (최소 15행 — A4 비율에 맞춤)
    const minRows = 15;
    const emptyRows = Math.max(0, minRows - items.length);

    let unitPriceSum = 0; // 단가 합계
    let itemRows = items.map((item, i) => {
      const isCustom = item.itemType === 'custom';
      const qty = Number(item.quantity) || (isCustom ? 1 : 0);
      const uPrice = Number(item.unitPrice) || 0;
      const iFee = Number(item.installFee) || 0;
      const displayPrice = isCustom ? uPrice : uPrice + iFee;
      const lineAmount = displayPrice * qty;
      unitPriceSum += lineAmount;

      return `<tr>
        <td style="${S.td}">${w(i+1)}</td>
        <td style="${S.tdL}">${w(getItemName(item), fcL)}</td>
        <td style="${S.td}">${w(getItemSpec(item))}</td>
        <td style="${S.td}">${w(qty)}</td>
        <td style="${S.tdR}">${w(fmt(displayPrice), fcR)}</td>
        <td style="${S.tdR}">${w(fmt(lineAmount), fcR)}</td>
      </tr>`;
    }).join('');

    for (let i = 0; i < emptyRows; i++) {
      itemRows += `<tr>
        <td style="${S.td}">${w('&nbsp;')}</td><td style="${S.tdL}">${w('&nbsp;',fcL)}</td><td style="${S.td}">${w('&nbsp;')}</td>
        <td style="${S.td}">${w('&nbsp;')}</td><td style="${S.tdR}">${w('&nbsp;',fcR)}</td><td style="${S.tdR}">${w('&nbsp;',fcR)}</td>
      </tr>`;
    }

    return `
    <div id="estimate-card" style="background:#fff;max-width:700px;margin:0 auto;padding:16px;font-family:'Malgun Gothic','맑은 고딕',sans-serif;">
      <!-- 제목 -->
      <h1 style="text-align:center;font-size:28px;font-weight:bold;letter-spacing:16px;margin:0 0 16px;">견 적 서</h1>

      <!-- 상단 정보 -->
      <table style="${S.table}border:none;">
        <tr>
          <td style="border:none;vertical-align:top;width:50%;padding:0 8px 0 0;">
            <!-- 수신 + 금액 -->
            <p style="font-size:13px;margin:0 0 6px;">${dateKr}</p>
            <table style="${S.table}">
              <tr>
                <td style="${S.infoTd};padding:8px 10px;" colspan="2">
                  <strong style="font-size:14px;">${data.customerName || data.name || ''}</strong>
                  ${data.company ? ` (${data.company})` : ''} 귀하
                </td>
              </tr>
              ${data.address ? `<tr><td style="${S.infoTd};padding:8px 10px;" colspan="2"><span style="font-size:11px;color:#666;">현장: ${data.address}</span></td></tr>` : ''}
            </table>
            <p style="font-size:12px;margin:8px 0 2px;">아래와 같이 견적합니다.</p>
            <table style="${S.table}">
              <tr>
                <td style="${S.infoTh}">합계금액</td>
                <td style="${S.infoTd};font-size:14px;font-weight:bold;text-align:right;">
                  ₩ ${fmt(total)}
                </td>
              </tr>
            </table>
            ${koreanAmount ? `<p style="font-size:10px;color:#666;margin:2px 0;">(${koreanAmount})</p>` : ''}
          </td>
          <td style="border:none;vertical-align:top;width:50%;padding:0 0 0 8px;">
            <!-- 공급자 정보 -->
            <table style="${S.table}">
              <tr><td style="${S.thHeader}" colspan="4">공 급 자</td></tr>
              <tr>
                <td style="${S.infoTh}">등록번호</td>
                <td style="${S.infoTd}" colspan="3">${brand.bizNumber || '135-09-53960'}</td>
              </tr>
              <tr>
                <td style="${S.infoTh}">상 호</td>
                <td style="${S.infoTd}">${brand.company || '중용'}</td>
                <td style="${S.infoTh}">성 명</td>
                <td style="${S.infoTd};position:relative;">${brand.representative || '김영준'}<img src="assets/sign_rack.png" style="position:absolute;top:50%;right:2px;transform:translateY(-50%);width:48px;height:48px;opacity:0.85;" crossorigin="anonymous"></td>
              </tr>
              <tr>
                <td style="${S.infoTh}">주 소</td>
                <td style="${S.infoTd}" colspan="3">${brand.address || '경기도 용인시 처인구 백옥대로 1117'}</td>
              </tr>
              <tr>
                <td style="${S.infoTh}">업 태</td>
                <td style="${S.infoTd}">${(brand.bizType || '도매 및 소매').split('/')[0] || '도매 및 소매'}</td>
                <td style="${S.infoTh}">종 목</td>
                <td style="${S.infoTd}">${(brand.bizType || '/조립식 진열대').split('/')[1] || '조립식 진열대'}</td>
              </tr>
              <tr>
                <td style="${S.infoTh}">전 화</td>
                <td style="${S.infoTd}" colspan="3">${brand.phone || '010-3776-1230'}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- 품목 테이블 -->
      <table style="${S.table}margin-top:12px;">
        <thead>
          <tr>
            <th style="${S.th};width:30px;">${w('No')}</th>
            <th style="${S.th};min-width:100px;">${w('품 명')}</th>
            <th style="${S.th};min-width:80px;">${w('규 격')}</th>
            <th style="${S.th};width:40px;">${w('수량')}</th>
            <th style="${S.th};width:70px;">${w('단 가')}</th>
            <th style="${S.th};width:90px;">${w('금 액')}</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
        <tfoot>
          <tr>
            <td style="${S.th}" colspan="2">${w('합 계')}</td>
            <td style="${S.tdR};font-weight:bold;" colspan="2">${w(fmt(unitPriceSum), fcR)}</td>
            <td style="${S.th}">${w('공급가액')}</td>
            <td style="${S.tdR};font-weight:bold;">${w(fmt(supplyTotal), fcR)}</td>
          </tr>
          <tr>
            <td style="${S.th}" colspan="2">${w('세 액')}</td>
            <td style="${S.tdR};font-weight:bold;" colspan="2">${w(fmt(vat), fcR)}</td>
            <td style="${S.th}">${w('총 견적액')}</td>
            <td style="${S.tdR};font-weight:bold;font-size:13px;">${w(fmt(total), fcR)}</td>
          </tr>
        </tfoot>
      </table>

      <!-- 안내사항 -->
      <div style="margin-top:12px;border:1px solid #333;padding:10px;font-size:11px;">
        <table style="width:100%;border:none;font-size:11px;">
          <tr><td style="border:none;padding:2px 0;width:60px;font-weight:bold;">안내사항</td><td style="border:none;padding:2px 0;">
            1. 부가세 포함 금액입니다.<br>
            2. 담당: ${brand.representative || '김영준'} (${brand.phone || '010-3776-1230'})<br>
            3. 납기: 발주 후 3~5일<br>
            4. 입금계좌: ${brand.bankAccount || '국민은행 218101-04-044846 (예금주: 김영준)'}<br>
            ${items.length > 0 ? `5. 견적 유효기간: 견적일로부터 30일` : ''}
          </td></tr>
        </table>
      </div>

      <!-- 푸터 -->
      <div style="margin-top:8px;text-align:center;font-size:10px;color:#666;border-top:1px solid #ccc;padding-top:6px;">
        https://blog.naver.com/yongin_rack ${brand.adminEmail ? `| ${brand.adminEmail}` : '| musso9617@naver.com'}
      </div>

      ${data.estimateId ? `<p style="text-align:right;font-size:9px;color:#999;margin-top:4px;">${data.estimateId}</p>` : ''}
    </div>`;
  }

  // ========== 거래명세표 ==========
  function renderTransactionStatement(data, options) {
    const brand = getBranding();
    let items = parseItems(data);
    if (options && options.hideMargin) items = applyMarginToUnitPrices(items);
    const { supplyTotal, vat, total } = calcTotals(items, { ...data, supplyTotal: 0, vat: 0, total: 0 });
    const dateKr = formatDateKr(data.date);

    const minRows = 15;
    const emptyRows = Math.max(0, minRows - items.length);

    let itemRows = items.map((item, i) => {
      const isCustom = item.itemType === 'custom';
      const qty = Number(item.quantity) || (isCustom ? 1 : 0);
      const uPrice = Number(item.unitPrice) || 0;
      const iFee = Number(item.installFee) || 0;
      const amount = isCustom ? uPrice * qty : (uPrice + iFee) * qty;
      const d = data.date ? new Date(data.date) : new Date();
      const monthDay = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;

      return `<tr>
        <td style="${S.td}">${w(i+1)}</td>
        <td style="${S.td}">${w(monthDay)}</td>
        <td style="${S.tdL}">${w(getItemName(item), fcL)}</td>
        <td style="${S.td}">${w(getItemSpec(item))}</td>
        <td style="${S.td}">${w(getItemUnit(item))}</td>
        <td style="${S.td}">${w(qty)}</td>
        <td style="${S.tdR}">${w(fmt(uPrice + (isCustom ? 0 : iFee)), fcR)}</td>
        <td style="${S.tdR}">${w(fmt(amount), fcR)}</td>
        <td style="${S.td}"></td>
      </tr>`;
    }).join('');

    for (let i = 0; i < emptyRows; i++) {
      itemRows += `<tr>
        <td style="${S.td}">${w('&nbsp;')}</td><td style="${S.td}">${w('&nbsp;')}</td><td style="${S.tdL}">${w('&nbsp;',fcL)}</td>
        <td style="${S.td}">${w('&nbsp;')}</td><td style="${S.td}">${w('&nbsp;')}</td><td style="${S.td}">${w('&nbsp;')}</td>
        <td style="${S.tdR}">${w('&nbsp;',fcR)}</td><td style="${S.tdR}">${w('&nbsp;',fcR)}</td><td style="${S.td}">${w('&nbsp;')}</td>
      </tr>`;
    }

    return `
    <div id="estimate-card" style="background:#fff;max-width:750px;margin:0 auto;padding:16px;font-family:'Malgun Gothic','맑은 고딕',sans-serif;">
      <!-- 제목 + 번호 -->
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:4px;">
        <span style="font-size:10px;color:#666;">증빙번호: ${data.estimateId || ''}</span>
        <span style="font-size:10px;color:#666;">(공급받는자 보관용)</span>
      </div>
      <h1 style="text-align:center;font-size:26px;font-weight:bold;letter-spacing:14px;margin:0 0 10px;">거 래 명 세 표</h1>
      <p style="text-align:right;font-size:12px;margin:0 0 8px;">${dateKr}</p>

      <!-- 공급받는자 + 공급자 정보 -->
      <table style="${S.table}">
        <tr>
          <!-- 공급받는자 -->
          <td style="border:1px solid #333;vertical-align:top;width:50%;padding:0;">
            <table style="${S.table}">
              <tr><td style="${S.thHeader}" colspan="4">공 급 받 는 자</td></tr>
              <tr>
                <td style="${S.infoTh}">등록번호</td>
                <td style="${S.infoTd}" colspan="3">${data.bizNumber || ''}</td>
              </tr>
              <tr>
                <td style="${S.infoTh}">상 호</td>
                <td style="${S.infoTd}">${data.company || data.customerName || data.name || ''}</td>
                <td style="${S.infoTh}">성 명</td>
                <td style="${S.infoTd}">${data.customerName || data.name || ''}</td>
              </tr>
              <tr>
                <td style="${S.infoTh}">주 소</td>
                <td style="${S.infoTd}" colspan="3">${data.address || ''}</td>
              </tr>
              <tr>
                <td style="${S.infoTh}">업 태</td>
                <td style="${S.infoTd}">${data.bizType || ''}</td>
                <td style="${S.infoTh}">종 목</td>
                <td style="${S.infoTd}">${data.bizItem || ''}</td>
              </tr>
            </table>
          </td>
          <!-- 공급자 -->
          <td style="border:1px solid #333;vertical-align:top;width:50%;padding:0;">
            <table style="${S.table}">
              <tr><td style="${S.thHeader}" colspan="4">공 급 자</td></tr>
              <tr>
                <td style="${S.infoTh}">등록번호</td>
                <td style="${S.infoTd}" colspan="3">${brand.bizNumber || '135-09-53960'}</td>
              </tr>
              <tr>
                <td style="${S.infoTh}">상 호</td>
                <td style="${S.infoTd}">${brand.company || '중용'}</td>
                <td style="${S.infoTh}">성 명</td>
                <td style="${S.infoTd};position:relative;">${brand.representative || '김영준'}<img src="assets/sign_rack.png" style="position:absolute;top:50%;right:2px;transform:translateY(-50%);width:48px;height:48px;opacity:0.85;" crossorigin="anonymous"></td>
              </tr>
              <tr>
                <td style="${S.infoTh}">주 소</td>
                <td style="${S.infoTd}" colspan="3">${brand.address || '경기도 용인시 처인구 백옥대로 1117'}</td>
              </tr>
              <tr>
                <td style="${S.infoTh}">업 태</td>
                <td style="${S.infoTd}">${(brand.bizType || '도매 및 소매').split('/')[0] || '도매 및 소매'}</td>
                <td style="${S.infoTh}">종 목</td>
                <td style="${S.infoTd}">${(brand.bizType || '/조립식 진열대').split('/')[1] || '조립식 진열대'}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- 품목 테이블 -->
      <table style="${S.table}margin-top:8px;">
        <thead>
          <tr>
            <th style="${S.th};width:28px;">${w('순번')}</th>
            <th style="${S.th};width:42px;">${w('월일')}</th>
            <th style="${S.th};min-width:90px;">${w('품 목')}</th>
            <th style="${S.th};min-width:70px;">${w('규 격')}</th>
            <th style="${S.th};width:32px;">${w('단위')}</th>
            <th style="${S.th};width:38px;">${w('수량')}</th>
            <th style="${S.th};width:68px;">${w('단 가')}</th>
            <th style="${S.th};width:78px;">${w('금 액')}</th>
            <th style="${S.th};width:42px;">${w('비고')}</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <!-- 하단 합계 -->
      <table style="${S.table}margin-top:-1px;">
        <tr>
          <td style="${S.infoTh};width:80px;">합계금액</td>
          <td style="${S.infoTd};text-align:right;font-weight:bold;font-size:13px;" colspan="2">₩ ${fmt(total)}</td>
          <td style="${S.infoTh};width:60px;">공급가액</td>
          <td style="${S.infoTd};text-align:right;">${fmt(supplyTotal)}</td>
          <td style="${S.infoTh};width:50px;">세 액</td>
          <td style="${S.infoTd};text-align:right;">${fmt(vat)}</td>
        </tr>
      </table>

      <!-- 입금/미수 + 인수자 -->
      <table style="${S.table}margin-top:-1px;">
        <tr>
          <td style="${S.infoTh};width:60px;">입금액</td>
          <td style="${S.infoTd};text-align:right;width:100px;"></td>
          <td style="${S.infoTh};width:60px;">미수액</td>
          <td style="${S.infoTd};text-align:right;width:100px;"></td>
          <td style="${S.infoTh};width:60px;">인수자</td>
          <td style="${S.infoTd};text-align:center;width:80px;">(인)</td>
        </tr>
      </table>

      <!-- 담당자 + 연락처 -->
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:#666;">
        <span>담당자: ${brand.representative || '김영준'} (${brand.phone || '010-3776-1230'})</span>
        <span>${data.estimateId || ''}</span>
      </div>
    </div>`;
  }

  // ========== 간편 견적서 (기존) ==========
  function renderPreview(data, options) {
    const brand = getBranding();
    let items = parseItems(data);
    if (options && options.hideMargin) items = applyMarginToUnitPrices(items);
    const { supplyTotal, vat, total } = calcTotals(items, { ...data, supplyTotal: 0, vat: 0, total: 0 });
    const hasVat = Number(data.vat) > 0 || Number(data.supplyTotal) > 0;

    return `
      <div id="estimate-card" class="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div class="bg-[#1e3a5f] text-white px-5 py-4 text-center">
          <h2 class="text-xl font-extrabold">${brand.company || '중용'}</h2>
          ${brand.tagline ? `<p class="text-xs opacity-80 mt-1">${brand.tagline}</p>` : ''}
        </div>
        <div class="p-5">
          <div class="flex justify-between text-xs text-gray-500 mb-4">
            <span>견적일: ${formatDateKr(data.date)}</span>
            <span>${data.estimateId || ''}</span>
          </div>
          ${data.customerName || data.name ? `
          <div class="bg-gray-50 rounded-xl p-3 mb-4 text-sm">
            <p class="font-bold text-gray-800">${data.customerName || data.name || ''}${data.company ? ` (${data.company})` : ''}</p>
            ${data.address ? `<p class="text-gray-500 mt-1">${data.address}</p>` : ''}
          </div>` : ''}
          <div class="border-t border-gray-100 pt-3">
            <p class="text-xs font-bold text-gray-500 mb-2">품목 내역</p>
            ${items.map((item, i) => {
              const isCustom = item.itemType === 'custom';
              const qty = Number(item.quantity) || (isCustom ? 1 : 0);
              const uPrice = Number(item.unitPrice) || 0;
              const iFee = Number(item.installFee) || 0;
              const sub = isCustom ? uPrice * qty : uPrice * qty;
              const inst = isCustom ? 0 : iFee * qty;
              const isNeg = (sub + inst) < 0;
              return `
                <div class="mb-3 ${i > 0 ? 'border-t border-dashed border-gray-200 pt-3' : ''}">
                  <div class="flex justify-between text-sm">
                    <span class="font-semibold ${isNeg ? 'text-red-600' : 'text-gray-800'}">${isCustom ? item.name : `${item.type} ${item.spec} ${item.tier}단`}</span>
                    <span class="text-gray-600">${isCustom ? (qty > 1 ? qty+'식' : '') : qty+'대'}</span>
                  </div>
                  <div class="flex justify-between text-xs text-gray-500 mt-1">
                    <span class="pl-2">단가 @${fmt(uPrice)}</span>
                    <span class="${isNeg ? 'text-red-600' : ''}">${fmtW(sub)}</span>
                  </div>
                  ${!isCustom && iFee > 0 ? `
                  <div class="flex justify-between text-xs text-gray-500 mt-0.5">
                    <span class="pl-2">시공비 @${fmt(iFee)}</span>
                    <span>${fmtW(inst)}</span>
                  </div>` : ''}
                </div>`;
            }).join('')}
          </div>
          <div class="border-t border-gray-200 pt-2 mt-2 text-sm">
            <div class="flex justify-between py-1">
              <span class="text-gray-500">공급가액</span>
              <span class="text-gray-700">${fmtW(supplyTotal)}</span>
            </div>
            <div class="flex justify-between py-1">
              <span class="text-gray-500">세액 (10%)</span>
              <span class="text-gray-700">${fmtW(vat)}</span>
            </div>
          </div>
          <div class="flex justify-between pt-3 mt-2 border-t-2 border-[#1e3a5f]">
            <span class="text-base font-extrabold text-[#1e3a5f]">총 견적액</span>
            <span class="text-xl font-extrabold text-[#f97316]">${fmtW(total)}</span>
          </div>
          <p class="text-xs text-gray-400 mt-2 text-right">* 부가세 포함</p>
        </div>
        <div class="bg-gray-50 px-5 py-3 text-center text-xs text-gray-400 border-t border-gray-100">
          ${brand.company || '중용'} | ${brand.phone || '010-3776-1230'} ${brand.bizNumber ? `| ${brand.bizNumber}` : ''}
        </div>
      </div>`;
  }

  // ========== 공유 URL 헬퍼 ==========
  function _buildFallbackUrl(estimateId, docType) {
    const docParam = docType === 'transaction' ? '&doc=transaction' : '';
    return `${location.origin}/view.html?id=${estimateId}${docParam}`;
  }

  async function _buildShareUrl(data, docType, options) {
    if (!data.estimateId) return window.location.href;
    try {
      const hideMargin = !!(options && options.hideMargin);
      const tokenRes = await API.createShareToken(data.estimateId, hideMargin, docType || 'formal');
      if (tokenRes && tokenRes.token) {
        return `${location.origin}/view.html?token=${tokenRes.token}`;
      }
    } catch {}
    return _buildFallbackUrl(data.estimateId, docType);
  }

  // ========== 공유 ==========
  async function share(data, docType, options) {
    const brand = getBranding();
    const docName = docType === 'transaction' ? '거래명세표' : '견적서';
    const title = `[${brand.company || '중용'}] ${docName}`;
    const items = parseItems(data);
    const { total } = calcTotals(items, data);

    const rackItems = items.filter(i => i.itemType !== 'custom');
    const totalQty = rackItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const itemSummary = rackItems.length > 1
      ? `${rackItems[0]?.type || '랙'} 외 ${rackItems.length - 1}종 ${totalQty}대`
      : rackItems.length === 1
        ? `${rackItems[0].type} ${totalQty}대`
        : `${items[0]?.name || '견적'}`;

    const text = `${itemSummary} — ${fmtW(total)} (VAT포함)`;

    const url = await _buildShareUrl(data, docType, options);

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        UI.toast('공유 완료', 'success');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    const shareText = `${title}\n${text}\n\n견적서 확인: ${url}`;
    try {
      await navigator.clipboard.writeText(shareText);
      UI.toast('견적 정보가 복사되었습니다.', 'success', 4000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = shareText; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      UI.toast('견적 정보가 복사되었습니다.', 'success', 4000);
    }
  }

  // ========== 이미지 다운로드 ==========
  async function downloadImage(docType) {
    const card = document.getElementById('estimate-card');
    if (!card) return;
    try {
      if (typeof html2canvas === 'undefined') {
        UI.toast('이미지 생성 기능을 로드 중입니다', 'info'); return;
      }

      UI.toast('이미지 생성 중...', 'info', 2000);

      // A4 비율: 210mm × 297mm → 794px × 1123px @96dpi
      const A4_W = 794;
      const A4_H = 1123;
      const MARGIN_H = 32; // 좌우 여백
      const MARGIN_V = 36; // 상하 여백

      // A4 래퍼 생성 (인쇄 여백 포함)
      const a4Wrapper = document.createElement('div');
      a4Wrapper.style.cssText = `position:fixed;left:-9999px;top:0;width:${A4_W}px;min-height:${A4_H}px;background:#fff;padding:${MARGIN_V}px ${MARGIN_H}px;box-sizing:border-box;z-index:-1;`;

      const clone = card.cloneNode(true);
      clone.id = 'estimate-card-clone';
      clone.style.cssText = `width:100%;transform:none;margin:0;padding:8px;box-sizing:border-box;`;
      a4Wrapper.appendChild(clone);
      document.body.appendChild(a4Wrapper);

      await new Promise(r => setTimeout(r, 150));

      // html2canvas with retry (up to 2 attempts)
      let canvas;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          canvas = await html2canvas(a4Wrapper, {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true,
            width: A4_W,
            windowWidth: A4_W,
          });
          break; // success
        } catch (canvasErr) {
          if (attempt === 1) throw canvasErr;
          await new Promise(r => setTimeout(r, 300)); // wait before retry
        }
      }

      document.body.removeChild(a4Wrapper);

      const link = document.createElement('a');
      const prefix = docType === 'transaction' ? '거래명세표' : '견적서';
      link.download = `${prefix}_${new Date().toISOString().slice(0,10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      UI.toast('이미지가 저장되었습니다', 'success');
    } catch (err) {
      UI.toast('이미지 생성 실패. 스크린샷을 사용하세요.', 'error');
    }
  }

  return {
    renderPreview, renderFormalQuotation, renderTransactionStatement,
    applyMarginToUnitPrices, share, downloadImage, getBranding,
    calcTotals: (data) => {
      const items = parseItems(data);
      return calcTotals(items, { supplyTotal: 0, vat: 0, total: 0 });
    },
  };
})();
