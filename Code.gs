/**
 * Code.gs — 용인 랙 Google Apps Script 백엔드
 * Google Sheets를 DB로 사용하는 웹 앱 API
 *
 * 시트 구조:
 *   단가표: [랙종류, 형태, 규격, 단수, 기본단가, 추가시공비, VAT적용, 활성,
 *            가격모델, 선반추가단가, 단당하중, 기둥두께, 선반두께,
 *            배치유형, 후면판유형, 부품카테고리, 부품길이, 부품두께,
 *            세트명, BOM_JSON, 부속품여부, 부속품카테고리]
 *   견적내역: [견적일시, 견적번호, 고객명, 회사명, 연락처, 주소, 품목상세(JSON), 총액, 진행상태, clientId]
 *   견적요청: [요청일시, 고객명, 연락처, 랙종류, 수량, 메모, 처리상태]
 *   설정: [key, value]
 *   포트폴리오: [날짜, 견적번호, 설명, 사진URL, 장소]
 */

const SPREADSHEET_ID = '1azkq97HM29dyI-d4YC3FamsudWhuUC7FSPB_rGH8aZg';

// 서버 PIN 해시 조회 (캐시 — 동일 요청 내 중복 IO 방지)
var _cachedServerPinHash = undefined;
function _getServerPinHash() {
  if (_cachedServerPinHash !== undefined) return _cachedServerPinHash;
  _cachedServerPinHash = '';
  try {
    var sheet = getSheet('설정');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === 'pinHash') {
        _cachedServerPinHash = String(data[i][1]).trim();
        break;
      }
    }
  } catch (e) {}
  return _cachedServerPinHash;
}

function _hasServerPin() {
  return !!_getServerPinHash();
}

function _verifyAuthToken(token) {
  if (!token) return false;
  var serverHash = _getServerPinHash();
  return serverHash && serverHash === String(token).trim();
}

// ============================================================
// doGet — 읽기 요청
// ============================================================
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';

  try {
    switch (action) {
      case 'getPrices':
        return jsonResponse(getPrices());
      case 'getEstimate':
        return jsonResponse(getEstimate(e.parameter.id));
      case 'getEstimateByToken':
        return jsonResponse(getEstimateByToken(e.parameter.token));
      case 'getEstimates':
        return jsonResponse(getEstimates());
      case 'getDashboard':
        return jsonResponse(getDashboard());
      case 'getRequests':
        return jsonResponse(getRequests());
      case 'getPortfolio':
        return jsonResponse(getPortfolio());
      case 'getBlogPosts':
        return jsonResponse(getBlogPosts());
      case 'getSettings':
        return jsonResponse(getSettings());
      case 'viewEstimate':
        return viewEstimateHtml(e.parameter.id);
      case 'testGemini':
        return jsonResponse(_callGemini('한국어로 "안녕하세요"라고 인사해주세요. JSON으로 {"greeting":"인사말"} 형식으로 응답하세요.', {}));
      default:
        return jsonResponse({ error: 'Unknown action' });
    }
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ============================================================
// doPost — 쓰기 요청
// ============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';

    // 인증: PIN 해시 토큰 검증 (고객 요청 제외)
    if (action === 'submitRequest') {
      // 공개 요청 — 인증 불필요
    } else if (action === 'saveSettings' && !_hasServerPin()) {
      // 최초 온보딩 — 서버에 PIN이 없으므로 인증 불필요
    } else if (!_verifyAuthToken(body.authToken)) {
      return jsonResponse({ error: 'Unauthorized' });
    }

    // 사진 업로드는 Lock 없이 처리 (Drive 작업이 오래 걸림)
    if (action === 'uploadPhoto') {
      return jsonResponse(uploadPhoto(body));
    }

    // AI 분석은 Lock 없이 처리 (Gemini API 호출이 오래 걸릴 수 있음)
    if (action === 'analyzeRequest') {
      return jsonResponse(analyzeRequest(body));
    }
    if (action === 'analyzePhoto') {
      return jsonResponse(analyzePhoto(body));
    }

    // 나머지 쓰기 작업은 LockService로 동시 쓰기 보호
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);

    let result;
    try {
      switch (action) {
        case 'saveEstimate':
          result = saveEstimate(body);
          break;
        case 'updateStatus':
          result = updateStatus(body.estimateId, body.status);
          break;
        case 'addPrice':
          result = addPrice(body);
          break;
        case 'updatePrice':
          result = updatePrice(body);
          break;
        case 'deletePrice':
          result = deletePrice(body.rowIndex);
          break;
        case 'submitRequest':
          result = submitRequest(body);
          break;
        case 'saveSettings':
          result = saveSettings(body);
          break;
        case 'deletePhoto':
          result = deletePhoto(body.rowIndex);
          break;
        case 'updateRequestStatus':
          result = updateRequestStatus(body.rowIndex, body.status);
          break;
        case 'deleteRequest':
          result = deleteRequest(body.rowIndex);
          break;
        case 'createShareToken':
          result = createShareToken(body);
          break;
        case 'linkEstimateToRequest':
          result = linkEstimateToRequest(body);
          break;
        case 'updateEstimate':
          result = updateEstimate(body);
          break;
        case 'deleteEstimate':
          result = deleteEstimate(body.estimateId);
          break;
        default:
          result = { error: 'Unknown action' };
      }
    } finally {
      lock.releaseLock();
    }

    // OneSignal 푸시 알림 발송 (서버에서 직접)
    if (action === 'submitRequest' && result && !result.error) {
      sendNewRequestNotification(body.name, body.phone, body.rackType, body.memo);
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ============================================================
// JSON 응답 헬퍼
// ============================================================
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 견적 행 검색 헬퍼 (getEstimate, updateEstimate, deleteEstimate 공통)
// ============================================================
// --- CacheService 헬퍼 ---
function _getCache(key) {
  try {
    var cached = CacheService.getScriptCache().get(key);
    return cached ? JSON.parse(cached) : null;
  } catch(e) { return null; }
}

function _setCache(key, data, ttl) {
  try {
    var json = JSON.stringify(data);
    // CacheService 최대 100KB 제한, 초과 시 캐시 스킵
    if (json.length < 100000) {
      CacheService.getScriptCache().put(key, json, ttl);
    }
  } catch(e) {}
}

function _clearCache(key) {
  try { CacheService.getScriptCache().remove(key); } catch(e) {}
}

function findEstimateRow(sheet, estimateId) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === estimateId) return { row: i + 1, data: data[i], allData: data };
  }
  return null;
}

// ============================================================
// 단가표 — 확장 스키마 (v2: 4가지 가격 모델 지원)
// 열 구조: [랙종류(1), 형태(2), 규격(3), 단수(4), 기본단가(5), 추가시공비(6), VAT적용(7), 활성(8),
//           가격모델(9), 선반추가단가(10), 단당하중(11), 기둥두께(12), 선반두께(13),
//           배치유형(14), 후면판유형(15), 부품카테고리(16), 부품길이(17), 부품두께(18),
//           세트명(19), BOM_JSON(20), 부속품여부(21), 부속품카테고리(22)]
// ============================================================

// 랙 종류 → 가격 모델 자동 매핑
function _getPricingModel(type) {
  if (!type) return '';
  var t = type.trim();
  // 모델 A: 매트릭스형 (경량/중량 계열)
  if (['고급경량랙', 'MD경량랙', '경량랙', '아연랙', 'MD중량랙', 'KD중량랙', '중량랙', '파렛트랙'].indexOf(t) >= 0) return 'A';
  // 모델 B: 진열대형 (하이퍼)
  if (t === '하이퍼 진열대' || t.indexOf('하이퍼') >= 0) return 'B';
  // 모델 D: 세트 조합형 (곤도라)
  if (t === '곤도라 진열대' || t.indexOf('곤도라') >= 0) return 'D';
  // 모델 C: 부품 조합형 (무볼트앵글)
  if (t === '무볼트앵글' || t.indexOf('앵글') >= 0) return 'C';
  // 기타: 기본 매트릭스형 (클라이언트와 동일)
  return 'A';
}

// 단가 행 → JSON 객체 변환 (공통)
function _priceRowToObj(row, rowIndex) {
  return {
    rowIndex: rowIndex,
    // 기존 필드 (1~7)
    type: row[0] || '',
    form: row[1] || '',
    spec: row[2] || '',
    tier: row[3],
    unitPrice: Number(row[4]) || 0,
    installFee: Number(row[5]) || 0,
    vat: row[6] || '별도',
    // 확장 필드 (9~22) — 빈 값이면 생략하지 않고 포함 (클라이언트 호환)
    pricingModel: row[8] || '',
    shelfAddonPrice: Number(row[9]) || 0,
    loadCapacity: row[10] || '',
    pillarThickness: row[11] || '',
    shelfThickness: row[12] || '',
    layoutType: row[13] || '',
    panelType: row[14] || '',
    partCategory: row[15] || '',
    partLength: row[16] ? Number(row[16]) : 0,
    partThickness: row[17] || '',
    setName: row[18] || '',
    bomJson: row[19] || '',
    isAccessory: row[20] === true || row[20] === 'true' || row[20] === 'TRUE',
    accessoryCategory: row[21] || '',
  };
}

// JSON 객체 → 단가 행 배열 변환 (addPrice/updatePrice 공통)
function _priceObjToRow(body) {
  var model = body.pricingModel || _getPricingModel(body.type);
  return [
    body.type || '',                          // 1: 랙종류
    body.form || '',                          // 2: 형태
    body.spec || '',                          // 3: 규격
    body.tier || '',                          // 4: 단수
    Number(body.unitPrice) || 0,              // 5: 기본단가
    Number(body.installFee) || 0,             // 6: 추가시공비
    body.vat || '별도',                       // 7: VAT적용
    true,                                     // 8: 활성
    model,                                    // 9: 가격모델
    Number(body.shelfAddonPrice) || 0,        // 10: 선반추가단가
    body.loadCapacity || '',                  // 11: 단당하중
    body.pillarThickness || '',               // 12: 기둥두께
    body.shelfThickness || '',                // 13: 선반두께
    body.layoutType || '',                    // 14: 배치유형
    body.panelType || '',                     // 15: 후면판유형
    body.partCategory || '',                  // 16: 부품카테고리
    body.partLength ? Number(body.partLength) : '',  // 17: 부품길이
    body.partThickness || '',                 // 18: 부품두께
    body.setName || '',                       // 19: 세트명
    body.bomJson || '',                       // 20: BOM_JSON
    body.isAccessory ? 'true' : '',           // 21: 부속품여부
    body.accessoryCategory || '',             // 22: 부속품카테고리
  ];
}

function getPrices() {
  var cached = _getCache('cache_prices');
  if (cached) return cached;

  const sheet = getSheet('단가표');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { prices: [] };

  const prices = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[7] === '삭제') continue;
    prices.push(_priceRowToObj(row, i + 1));
  }
  var result = { prices };
  _setCache('cache_prices', result, 300);
  return result;
}

function addPrice(body) {
  const sheet = getSheet('단가표');
  var rowData = _priceObjToRow(body);
  sheet.appendRow(rowData);
  _clearCache('cache_prices');
  return { result: 'success' };
}

function updatePrice(body) {
  const sheet = getSheet('단가표');
  const row = Number(body.rowIndex);
  if (row < 2) return { error: 'Invalid row' };
  var rowData = _priceObjToRow(body);
  // 활성 필드(col 8)는 업데이트 시 건드리지 않음 — 1~7 + 9~22 업데이트
  var updateData = rowData.slice(0, 7).concat(rowData.slice(8)); // col 1~7, 9~22 (활성 제외)
  sheet.getRange(row, 1, 1, 7).setValues([updateData.slice(0, 7)]);
  sheet.getRange(row, 9, 1, 14).setValues([updateData.slice(7, 21)]);
  _clearCache('cache_prices');
  return { result: 'success' };
}

function deletePrice(rowIndex) {
  const sheet = getSheet('단가표');
  const row = Number(rowIndex);
  if (row < 2) return { error: 'Invalid row' };
  sheet.getRange(row, 8).setValue('삭제');
  _clearCache('cache_prices');
  return { result: 'success' };
}

// ============================================================
// 견적 저장/조회 (복수 품목)
// 열 구조: [견적일시, 견적번호, 고객명, 회사명, 연락처, 주소, 품목상세JSON, 총액, 진행상태, clientId]
// ============================================================
function saveEstimate(body) {
  const sheet = getSheet('견적내역');
  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const estimateId = generateEstimateId(sheet, now);

  // 중복 체크 (idempotency)
  if (body.clientId) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][9] === body.clientId) {
        return { result: 'success', estimateId: data[i][1], duplicate: true };
      }
    }
  }

  // 품목 배열을 JSON 문자열로 저장
  const itemsJson = JSON.stringify(body.items || []);

  var supplyTotal = Number(body.supplyTotal) || Number(body.total) || 0;
  var vat = Number(body.vat) || 0;
  var grandTotal = supplyTotal + vat;

  sheet.appendRow([
    dateStr,
    estimateId,
    body.name || '',
    body.company || '',
    body.phone || '',
    body.address || '',
    itemsJson,
    grandTotal,
    '상담완료',
    body.clientId || '',
    supplyTotal,
    vat,
    body.bizNumber || '',
    body.bizType || '',
    body.bizItem || ''
  ]);

  _clearCache('cache_estimates');
  return { result: 'success', estimateId: estimateId, row: sheet.getLastRow() };
}

function updateEstimate(body) {
  if (!body.estimateId) return { error: 'Missing estimateId' };
  var sheet = getSheet('견적내역');
  var found = findEstimateRow(sheet, body.estimateId);
  if (!found) return { error: 'Estimate not found' };

  var itemsJson = JSON.stringify(body.items || []);
  var supplyTotal = Number(body.supplyTotal) || Number(body.total) || 0;
  var vat = Number(body.vat) || 0;
  var grandTotal = supplyTotal + vat;
  var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  // 기존 행 덮어쓰기 (상태와 clientId는 유지)
  var currentStatus = found.data[8] || '상담완료';
  var currentClientId = found.data[9] || '';
  sheet.getRange(found.row, 1, 1, 15).setValues([[
    now,
    body.estimateId,
    body.name || '',
    body.company || '',
    body.phone || '',
    body.address || '',
    itemsJson,
    grandTotal,
    currentStatus,
    currentClientId,
    supplyTotal,
    vat,
    body.bizNumber || '',
    body.bizType || '',
    body.bizItem || ''
  ]]);
  _clearCache('cache_estimates');
  return { result: 'success', estimateId: body.estimateId };
}

function deleteEstimate(estimateId) {
  if (!estimateId) return { error: 'Missing estimateId' };
  var sheet = getSheet('견적내역');
  var found = findEstimateRow(sheet, estimateId);
  if (!found) return { error: 'Estimate not found' };

  sheet.deleteRow(found.row);
  _clearCache('cache_estimates');

  // 견적요청 시트에서 연결된 estimateId 클리어
  try {
    var reqSheet = getSheet('견적요청');
    // NOTE: 대규모 데이터셋에서는 getDataRange 대신 특정 열만 읽는 최적화 가능
    var reqData = reqSheet.getDataRange().getValues();
    for (var j = 1; j < reqData.length; j++) {
      if (reqData[j][12] === estimateId) {
        reqSheet.getRange(j + 1, 13).setValue('');
        break;
      }
    }
  } catch(e) {}

  // 공유토큰 시트에서 해당 estimateId 토큰 삭제
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var tokenSheet = ss.getSheetByName('공유토큰');
    if (tokenSheet) {
      var tokenData = tokenSheet.getDataRange().getValues();
      // 역순으로 삭제 (행 번호 변동 방지)
      for (var k = tokenData.length - 1; k >= 1; k--) {
        if (tokenData[k][1] === estimateId) {
          tokenSheet.deleteRow(k + 1);
        }
      }
    }
  } catch(e) {}

  return { result: 'success' };
}

function generateEstimateId(sheet, date) {
  const prefix = 'YR-' + Utilities.formatDate(date, 'Asia/Seoul', 'yyyyMMdd');
  const data = sheet.getDataRange().getValues();
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][1]);
    if (id.startsWith(prefix)) {
      const num = parseInt(id.split('-')[2]) || 0;
      if (num > maxNum) maxNum = num;
    }
  }
  return prefix + '-' + String(maxNum + 1).padStart(3, '0');
}

function getEstimate(estimateId) {
  if (!estimateId) return { error: 'Missing estimateId' };
  const sheet = getSheet('견적내역');
  var found = findEstimateRow(sheet, estimateId);
  if (!found) return { error: 'Estimate not found' };

  var row = found.data;
  let items = [];
  try { items = JSON.parse(row[6]); } catch {}
  return {
    estimateId: row[1],
    date: row[0],
    customerName: row[2],
    company: row[3],
    phone: row[4],
    address: row[5],
    items: items,
    total: Number(row[7]),
    status: row[8],
    supplyTotal: Number(row[10]) || Number(row[7]) || 0,
    vat: Number(row[11]) || 0,
    bizNumber: row[12] || '',
    bizType: row[13] || '',
    bizItem: row[14] || '',
  };
}

// ============================================================
// 공유 토큰 (시트: 공유토큰)
// 열 구조: [token, estimateId, hideMargin, docType, createdAt]
// ============================================================
function generateShareToken() {
  // UUID 기반 URL-safe 랜덤 토큰 (하이픈 제거, 32자)
  return Utilities.getUuid().replace(/-/g, '');
}

var SHARE_TOKEN_EXPIRY_DAYS = 30; // 공유 토큰 만료 기간

function createShareToken(body) {
  if (!body.estimateId) return { error: 'Missing estimateId' };
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('공유토큰');
  if (!sheet) {
    sheet = ss.insertSheet('공유토큰');
    sheet.appendRow(['token', 'estimateId', 'hideMargin', 'docType', 'createdAt']);
  }

  var now = new Date();
  // 동일 조건 토큰이 이미 있으면 재사용 (만료되지 않은 경우만)
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === body.estimateId &&
        String(data[i][2]) === String(!!body.hideMargin) &&
        String(data[i][3]) === String(body.docType || 'formal')) {
      // 만료 확인
      var created = new Date(data[i][4]);
      if (isNaN(created.getTime())) {
        // 날짜 파싱 실패 → 만료 처리
        sheet.deleteRow(i + 1);
        break;
      }
      var diffDays = (now - created) / (1000 * 60 * 60 * 24);
      if (diffDays < SHARE_TOKEN_EXPIRY_DAYS) {
        return { result: 'success', token: data[i][0] };
      }
      // 만료된 토큰 → 행 삭제 후 새로 생성
      sheet.deleteRow(i + 1);
      break;
    }
  }

  var token = generateShareToken();
  var nowStr = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([token, body.estimateId, !!body.hideMargin, body.docType || 'formal', nowStr]);
  return { result: 'success', token: token };
}

function getEstimateByToken(token) {
  if (!token) return { error: 'Missing token' };
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('공유토큰');
  if (!sheet) return { error: 'Token not found' };

  var data = sheet.getDataRange().getValues();
  var now = new Date();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      // 만료 확인
      var created = new Date(data[i][4]);
      if (isNaN(created.getTime())) {
        return { error: '공유 링크가 만료되었습니다. 새 링크를 요청하세요.' };
      }
      var diffDays = (now - created) / (1000 * 60 * 60 * 24);
      if (diffDays >= SHARE_TOKEN_EXPIRY_DAYS) {
        return { error: '공유 링크가 만료되었습니다. 새 링크를 요청하세요.' };
      }
      var estimateId = data[i][1];
      var hideMargin = data[i][2] === true || data[i][2] === 'true';
      var docType = data[i][3] || 'formal';
      var estimate = getEstimate(estimateId);
      if (estimate.error) return estimate;
      estimate.hideMargin = hideMargin;
      estimate.docType = docType;
      return estimate;
    }
  }
  return { error: 'Token not found' };
}

function getEstimates() {
  var cached = _getCache('cache_estimates');
  if (cached) return cached;

  const sheet = getSheet('견적내역');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { estimates: [] };

  const estimates = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    let items = [];
    try { items = JSON.parse(row[6]); } catch {}

    const totalQty = items.reduce(function(sum, item) { return sum + (Number(item.quantity) || 0); }, 0);
    const summary = items.length > 1
      ? items[0].type + ' 외 ' + (items.length - 1) + '종'
      : (items[0] ? items[0].type : '');

    estimates.push({
      date: row[0],
      estimateId: row[1],
      customerName: row[2],
      company: row[3],
      phone: row[4],
      address: row[5],
      items: items,
      itemSummary: summary,
      totalQuantity: totalQty,
      total: Number(row[7]),
      status: row[8],
      bizNumber: row[12] || '',
      bizType: row[13] || '',
      bizItem: row[14] || '',
      statusChangedAt: row[15] || row[0],
    });
  }
  var result = { estimates };
  _setCache('cache_estimates', result, 120);
  return result;
}

function updateStatus(estimateId, newStatus) {
  const validStatuses = ['상담완료', '계약', '시공중', '시공완료'];
  if (!validStatuses.includes(newStatus)) return { error: 'Invalid status' };

  const sheet = getSheet('견적내역');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === estimateId) {
      sheet.getRange(i + 1, 9).setValue(newStatus);
      sheet.getRange(i + 1, 16).setValue(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'));
      _clearCache('cache_estimates');
      return { result: 'success' };
    }
  }
  return { error: 'Estimate not found' };
}

// ============================================================
// 대시보드
// ============================================================
function getDashboard() {
  const sheet = getSheet('견적내역');
  // NOTE: 대규모 데이터셋에서는 getDataRange 대신 특정 범위만 읽는 최적화 가능
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const thisMonth = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM');

  let count = 0, totalAmount = 0, contracted = 0;
  const recent = [];

  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    // Date 객체든 문자열이든 yyyy-MM 형식으로 변환
    var rowMonth;
    try {
      var d = row[0] instanceof Date ? row[0] : new Date(row[0]);
      rowMonth = Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM');
    } catch (e) {
      rowMonth = String(row[0]).substring(0, 7);
    }
    if (rowMonth === thisMonth) {
      count++;
      totalAmount += Number(row[7]) || 0;
      if (row[8] === '계약' || row[8] === '시공중' || row[8] === '시공완료') {
        contracted++;
      }
    }
    if (recent.length < 5) {
      let items = [];
      try { items = JSON.parse(row[6]); } catch {}
      const totalQty = items.reduce(function(sum, item) { return sum + (Number(item.quantity) || 0); }, 0);
      const summary = items.length > 1
        ? items[0].type + ' 외 ' + (items.length - 1) + '종'
        : (items[0] ? items[0].type : '');

      recent.push({
        date: row[0],
        estimateId: row[1],
        customerName: row[2],
        itemSummary: summary,
        totalQuantity: totalQty,
        total: Number(row[7]),
        status: row[8],
      });
    }
  }

  return { count, totalAmount, contracted, recent };
}

// ============================================================
// 고객 견적 요청
// ============================================================
function submitRequest(body) {
  const sheet = getSheet('견적요청');
  // NOTE: 대규모 데이터셋에서는 getDataRange 대신 특정 범위만 읽는 최적화 가능
  const data = sheet.getDataRange().getValues();
  const oneHourAgo = new Date(Date.now() - 3600000);
  let recentCount = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === body.phone && new Date(data[i][0]) > oneHourAgo) {
      recentCount++;
    }
  }
  if (recentCount >= 5) return { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' };

  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');

  // 사진 → Google Drive 저장
  var photoUrls = '';
  try {
    var images = [];
    if (body.images && body.images.length > 0) {
      images = body.images;
    } else if (body.imageBase64) {
      images = [{ base64: body.imageBase64, mimeType: body.imageMimeType || 'image/jpeg' }];
    }
    if (images.length > 0) {
      var mainFolder = DriveApp.getFolderById('1xAU_HedTcFk_HiZiq415a8UzqEXZRwxg');
      var subFolders = mainFolder.getFoldersByName('견적요청_사진');
      var folder = subFolders.hasNext() ? subFolders.next() : mainFolder.createFolder('견적요청_사진');
      var urls = [];
      for (var pi = 0; pi < images.length; pi++) {
        var blob = Utilities.newBlob(Utilities.base64Decode(images[pi].base64), images[pi].mimeType || 'image/jpeg',
          (body.name || 'photo') + '_' + now.replace(/[:\s]/g, '') + '_' + (pi + 1) + '.jpg');
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        urls.push('https://drive.google.com/uc?id=' + file.getId());
      }
      photoUrls = urls.join(',');
    }
  } catch (e) {
    // 사진 저장 실패해도 요청은 저장
  }

  sheet.appendRow([
    now, body.name || '', body.phone || '',
    body.rackType || '', Number(body.quantity) || 0,
    body.memo || '', '미처리',
    body.bizNumber || '', body.bizType || '', body.bizItem || '',
    body.company || '', body.address || '',
    '',  // estimateId (12번 컬럼)
    body.spaceWidth || '', body.spaceDepth || '', body.spaceHeight || '',
    body.spacePurpose || '', body.cargoType || '', body.cargoWeight || '',
    photoUrls  // 사진 URL들
  ]);

  return { result: 'success' };
}

/**
 * 새 견적 요청 알림 (OneSignal 푸시)
 * admin-push.html에서 관리자 기기 등록 필요
 */
function sendNewRequestNotification(name, phone, rackType, memo) {
  // 설정 시트에서 OneSignal 키를 한 번에 읽기 (GitHub에 노출 방지)
  var settingsData = getSheet('설정').getDataRange().getValues();
  var ONESIGNAL_APP_ID = '';
  var ONESIGNAL_API_KEY = '';
  for (var s = 1; s < settingsData.length; s++) {
    var key = settingsData[s][0];
    if (key === 'onesignalAppId') ONESIGNAL_APP_ID = String(settingsData[s][1]).trim();
    else if (key === 'onesignalApiKey') ONESIGNAL_API_KEY = String(settingsData[s][1]).trim();
    if (ONESIGNAL_APP_ID && ONESIGNAL_API_KEY) break; // 두 키 모두 찾으면 조기 종료
  }
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return;

  var message = '고객: ' + (name || '미입력') + '\n연락처: ' + (phone || '미입력');
  if (rackType) message += '\n랙종류: ' + rackType;
  if (memo) message += '\n메모: ' + memo;

  try {
    UrlFetchApp.fetch('https://onesignal.com/api/v1/notifications', {
      method: 'post',
      headers: {
        'Authorization': 'Basic ' + ONESIGNAL_API_KEY,
        'Content-Type': 'application/json; charset=utf-8'
      },
      payload: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        filters: [{ field: 'tag', key: 'role', relation: '=', value: 'admin' }],
        headings: { en: '새 견적 요청이 도착했습니다' },
        contents: { en: message },
        url: 'https://yongin-rack.com/requests.html'
      }),
      muteHttpExceptions: true
    });
  } catch (e) {
    // OneSignal 전송 실패 시 요청 처리에 영향 없도록 무시
  }
}

function getRequests() {
  var cached = _getCache('cache_requests');
  if (cached) return cached;

  const sheet = getSheet('견적요청');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { requests: [] };

  const requests = [];
  for (let i = data.length - 1; i >= 1; i--) {
    requests.push({
      rowIndex: i + 1,
      date: data[i][0], name: data[i][1], phone: String(data[i][2]),
      rackType: data[i][3], quantity: Number(data[i][4]),
      memo: data[i][5], status: data[i][6],
      bizNumber: data[i][7] || '', bizType: data[i][8] || '', bizItem: data[i][9] || '',
      company: data[i][10] || '', address: data[i][11] || '',
      estimateId: data[i][12] || '',
      spaceWidth: data[i][13] || '', spaceDepth: data[i][14] || '', spaceHeight: data[i][15] || '',
      spacePurpose: data[i][16] || '', cargoType: data[i][17] || '', cargoWeight: data[i][18] || '',
      photoUrls: data[i][19] || '',
    });
  }
  var result = { requests };
  _setCache('cache_requests', result, 60);
  return result;
}

// ============================================================
// 포트폴리오
// ============================================================
function uploadPhoto(body) {
  try {
    var mainFolder = DriveApp.getFolderById('1xAU_HedTcFk_HiZiq415a8UzqEXZRwxg');

    // 폴더명이 지정되면 하위 폴더에 저장
    var folder = mainFolder;
    if (body.folderName) {
      var subFolders = mainFolder.getFoldersByName(body.folderName);
      if (subFolders.hasNext()) {
        folder = subFolders.next();
      } else {
        folder = mainFolder.createFolder(body.folderName);
        try {
          folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (shareErr) {
          // 공유 설정 실패해도 업로드는 계속 진행
        }
      }
    }

    var blob = Utilities.newBlob(
      Utilities.base64Decode(body.base64Data),
      'image/jpeg',
      body.filename || 'photo.jpg'
    );
    var file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      // 공유 설정 실패해도 업로드는 계속 진행
    }
    var url = 'https://lh3.googleusercontent.com/d/' + file.getId();

    var sheet = getSheet('포트폴리오');
    var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    sheet.appendRow([now, body.estimateId || '', body.description || '', url, body.location || '']);

    return { result: 'success', photoUrl: url };
  } catch (err) {
    return { error: err.message || '사진 업로드 실패' };
  }
}

function getPortfolio() {
  const sheet = getSheet('포트폴리오');
  // NOTE: 대규모 데이터셋에서는 getDataRange 대신 특정 범위만 읽는 최적화 가능
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { photos: [] };

  const photos = [];
  for (let i = data.length - 1; i >= 1; i--) {
    photos.push({
      rowIndex: i + 1,
      date: data[i][0], estimateId: data[i][1],
      description: data[i][2], photoUrl: data[i][3],
      location: data[i][4] || '',
    });
  }
  return { photos };
}

// ============================================================
// 블로그 포스트 (네이버 블로그 RSS)
// ============================================================
function getBlogPosts() {
  try {
    var response = UrlFetchApp.fetch('https://rss.blog.naver.com/yongin_rack.xml', { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return { posts: [] };

    var xml = XmlService.parse(response.getContentText());
    var root = xml.getRootElement();
    var channel = root.getChild('channel');
    var items = channel.getChildren('item');

    var posts = [];
    for (var i = 0; i < Math.min(items.length, 20); i++) {
      var item = items[i];
      var desc = item.getChildText('description') || '';

      // HTML에서 첫 번째 이미지 추출
      var imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
      var thumbnail = imgMatch ? imgMatch[1] : '';

      // HTML 태그 제거하여 텍스트 추출
      var text = desc.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (text.length > 100) text = text.substring(0, 100) + '...';

      posts.push({
        title: item.getChildText('title') || '',
        link: item.getChildText('link') || '',
        description: text,
        thumbnail: thumbnail,
        pubDate: item.getChildText('pubDate') || '',
        category: item.getChildText('category') || '',
      });
    }
    return { posts: posts };
  } catch (err) {
    return { posts: [], error: err.message };
  }
}

function updateRequestStatus(rowIndex, newStatus) {
  var row = Number(rowIndex);
  if (row < 2) return { error: 'Invalid row' };
  var sheet = getSheet('견적요청');
  sheet.getRange(row, 7).setValue(newStatus);
  _clearCache('cache_requests');
  return { result: 'success' };
}

function linkEstimateToRequest(body) {
  var row = Number(body.rowIndex);
  if (row < 2 || !body.estimateId) return { error: 'Invalid params' };
  var sheet = getSheet('견적요청');
  sheet.getRange(row, 13).setValue(body.estimateId);
  _clearCache('cache_requests');
  return { result: 'success' };
}

function deleteRequest(rowIndex) {
  var row = Number(rowIndex);
  if (row < 2) return { error: 'Invalid row' };
  var sheet = getSheet('견적요청');
  sheet.deleteRow(row);
  _clearCache('cache_requests');
  return { result: 'success' };
}

function deletePhoto(rowIndex) {
  var row = Number(rowIndex);
  if (row < 2) return { error: 'Invalid row' };
  var sheet = getSheet('포트폴리오');
  sheet.deleteRow(row);
  return { result: 'success' };
}

function getOrCreateFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

// ============================================================
// 설정
// ============================================================
function getSettings() {
  const sheet = getSheet('설정');
  const data = sheet.getDataRange().getValues();
  const settings = {};
  for (let i = 1; i < data.length; i++) {
    settings[data[i][0]] = data[i][1];
  }
  return { settings };
}

function saveSettings(body) {
  const sheet = getSheet('설정');
  // NOTE: 대규모 데이터셋에서는 getDataRange 대신 특정 열만 읽는 최적화 가능
  const data = sheet.getDataRange().getValues();
  const keys = Object.keys(body).filter(k => k !== 'action' && k !== 'authToken');

  // 메모리에서 업데이트할 행과 새로 추가할 행을 분류
  var updates = []; // { row, value }
  var appends = []; // [key, value]

  keys.forEach(key => {
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        updates.push({ row: i + 1, value: body[key] });
        found = true;
        break;
      }
    }
    if (!found) {
      appends.push([key, body[key]]);
    }
  });

  // 기존 행 일괄 업데이트
  updates.forEach(u => {
    sheet.getRange(u.row, 2).setValue(u.value);
  });

  // 새 행 일괄 추가
  if (appends.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, 2).setValues(appends);
  }

  return { result: 'success' };
}

// ============================================================
// 견적서 HTML 뷰 (고객용, 동적 OG 태그)
// ============================================================
function viewEstimateHtml(estimateId) {
  const sheet = getSheet('견적내역');
  const data = sheet.getDataRange().getValues();
  let est = null;

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === estimateId) {
      let items = [];
      try { items = JSON.parse(data[i][6]); } catch {}
      est = {
        date: data[i][0],
        id: data[i][1],
        name: data[i][2],
        company: data[i][3],
        phone: String(data[i][4]).replace(/(\d{3})(\d{4})(\d{4})/, '$1-****-$3'),
        address: data[i][5],
        items: items,
        total: Number(data[i][7]),
      };
      break;
    }
  }

  if (!est) {
    return HtmlService.createHtmlOutput('<h1>견적서를 찾을 수 없습니다</h1>')
      .setTitle('용인 랙');
  }

  const fmt = (n) => Number(n).toLocaleString('ko-KR');

  // 품목 요약
  const totalQty = est.items.reduce(function(sum, item) { return sum + (Number(item.quantity) || 0); }, 0);
  const ogDesc = est.items.length > 1
    ? est.items[0].type + ' 외 ' + (est.items.length - 1) + '종 ' + totalQty + '대 — ' + fmt(est.total) + '원'
    : (est.items[0] ? est.items[0].type + ' ' + totalQty + '대 — ' + fmt(est.total) + '원' : fmt(est.total) + '원');

  // 품목 HTML 생성
  let itemsHtml = '';
  let totalSubtotal = 0;
  let totalInstall = 0;
  est.items.forEach(function(item, i) {
    const qty = Number(item.quantity) || 0;
    const uPrice = Number(item.unitPrice) || 0;
    const iFee = Number(item.installFee) || 0;
    const sub = uPrice * qty;
    const inst = iFee * qty;
    totalSubtotal += sub;
    totalInstall += inst;
    itemsHtml += '<div class="' + (i > 0 ? 'border-t border-dashed pt-2 mt-2' : '') + '">' +
      '<div class="flex justify-between text-sm"><span class="font-semibold">' + (item.type || '') + ' ' + (item.spec || '') + ' ' + (item.tier || '') + '단</span><span>' + qty + '대</span></div>' +
      '<div class="flex justify-between text-xs text-gray-500 mt-1"><span class="pl-2">@' + fmt(uPrice) + '</span><span>' + fmt(sub) + '원</span></div>' +
      (iFee > 0 ? '<div class="flex justify-between text-xs text-gray-500"><span class="pl-2">시공비 @' + fmt(iFee) + '</span><span>' + fmt(inst) + '원</span></div>' : '') +
      '</div>';
  });

  const html = '<!DOCTYPE html>' +
'<html lang="ko">' +
'<head>' +
'  <meta charset="UTF-8">' +
'  <meta name="viewport" content="width=device-width,initial-scale=1">' +
'  <title>[용인 랙] 견적서 - ' + est.id + '</title>' +
'  <meta property="og:title" content="[용인 랙] 맞춤형 견적서가 도착했습니다">' +
'  <meta property="og:description" content="' + ogDesc + '">' +
'  <meta property="og:type" content="website">' +
'  <script src="https://cdn.tailwindcss.com"><\/script>' +
'  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css">' +
'  <style>body{font-family:"Pretendard",sans-serif}</style>' +
'</head>' +
'<body class="bg-gray-50 min-h-screen flex items-start justify-center py-6">' +
'  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 w-full max-w-md mx-4 overflow-hidden">' +
'    <div class="bg-[#1e3a5f] text-white px-5 py-4 text-center">' +
'      <h1 class="text-xl font-extrabold">용인 랙</h1>' +
'      <p class="text-xs opacity-80 mt-1">전문 랙 설치 시공</p>' +
'    </div>' +
'    <div class="p-5">' +
'      <div class="flex justify-between text-xs text-gray-500 mb-4">' +
'        <span>견적일: ' + est.date + '</span><span>' + est.id + '</span>' +
'      </div>' +
(est.name ? '<div class="bg-gray-50 rounded-xl p-3 mb-4 text-sm"><p class="font-bold text-gray-800">' + est.name + (est.company ? ' (' + est.company + ')' : '') + '</p>' + (est.address ? '<p class="text-gray-500 mt-1">' + est.address + '</p>' : '') + '</div>' : '') +
'      <div class="border-t pt-3">' +
'        <p class="text-xs font-bold text-gray-500 mb-2">품목 내역</p>' +
itemsHtml +
'      </div>' +
'      <div class="border-t pt-2 mt-3 text-sm">' +
'        <div class="flex justify-between py-1 text-gray-500"><span>제품 소계</span><span>' + fmt(totalSubtotal) + '원</span></div>' +
'        <div class="flex justify-between py-1 text-gray-500"><span>시공비 합계</span><span>' + fmt(totalInstall) + '원</span></div>' +
'      </div>' +
'      <div class="flex justify-between pt-3 mt-2 border-t-2 border-[#1e3a5f]">' +
'        <span class="font-extrabold text-[#1e3a5f]">총 견적액</span>' +
'        <span class="text-xl font-extrabold text-[#f97316]">' + fmt(est.total) + '원</span>' +
'      </div>' +
'      <p class="text-xs text-gray-400 mt-2 text-right">* 부가세 별도</p>' +
'    </div>' +
'    <div class="bg-gray-50 px-5 py-3 text-center text-xs text-gray-400 border-t">' +
'      용인 랙 | yongin-rack.com' +
'    </div>' +
'  </div>' +
'</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('[용인 랙] 견적서')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// 헬퍼
// ============================================================

/**
 * GAS 에디터에서 직접 실행 — 모든 시트 탭 초기화
 */
function initAllSheets() {
  ['단가표', '견적내역', '견적요청', '설정', '포트폴리오'].forEach(name => {
    getSheet(name);
  });
  Logger.log('모든 시트가 초기화되었습니다.');
}

function getSheet(name) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(name);
  var headers = {
    '단가표': ['랙종류', '형태', '규격', '단수', '기본단가', '추가시공비', 'VAT적용', '활성',
                '가격모델', '선반추가단가', '단당하중', '기둥두께', '선반두께',
                '배치유형', '후면판유형', '부품카테고리', '부품길이', '부품두께',
                '세트명', 'BOM_JSON', '부속품여부', '부속품카테고리'],
    '견적내역': ['견적일시', '견적번호', '고객명', '회사명', '연락처', '주소', '품목상세', '총액', '진행상태', 'clientId', '공급가액', '세액'],
    '견적요청': ['요청일시', '고객명', '연락처', '랙종류', '수량', '메모', '처리상태', '사업자번호', '업태', '종목', '회사명', '주소', '견적번호', '가로', '세로', '높이', '용도', '보관물', '무게', '사진URL'],
    '설정': ['key', 'value'],
    '포트폴리오': ['날짜', '견적번호', '설명', '사진URL', '장소'],
  };

  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  // 헤더가 비어있으면 자동 추가
  if (headers[name]) {
    var firstCell = sheet.getRange(1, 1).getValue();
    if (!firstCell || firstCell === '') {
      sheet.getRange(1, 1, 1, headers[name].length).setValues([headers[name]]);
      sheet.getRange(1, 1, 1, headers[name].length).setFontWeight('bold');
    }
  }

  return sheet;
}

// ============================================================
// 임시: 단가표 데이터 조회 (clasp run 용)
// ============================================================
function _debugGetPricesSummary() {
  var sheet = getSheet('단가표');
  var data = sheet.getDataRange().getValues();
  var summary = { totalRows: data.length - 1, byType: {} };
  for (var i = 1; i < data.length; i++) {
    var type = data[i][0] || '(빈값)';
    var active = data[i][7];
    if (active === '삭제') continue;
    if (!summary.byType[type]) summary.byType[type] = 0;
    summary.byType[type]++;
  }
  return summary;
}

// ============================================================
// 단가 데이터 시딩 (GAS 에디터 또는 clasp run으로 실행)
// 4번 MD중량Rack 제외, 나머지 7개 단가표 입력
// ============================================================
function seedPriceData() {
  var sheet = getSheet('단가표');
  var allRows = [];

  // 헬퍼: 매트릭스형 행 생성 (경량/중량/아연 계열 공통)
  function gridRows(type, model, specs, heights, shelfAddon, load, pillar, shelfT) {
    var rows = [];
    for (var s = 0; s < specs.length; s++) {
      var spec = specs[s][0]; // 규격명
      var addon = specs[s][specs[s].length - 1]; // 선반추가단가 (마지막 값)
      var priceIdx = 1; // 가격 시작 인덱스
      for (var h = 0; h < heights.length; h++) {
        var hName = heights[h];
        // 연결형
        rows.push([type, '연결형', spec, hName, specs[s][priceIdx], 0, '별도', true, model, addon, load, pillar, shelfT, '', '', '', '', '', '', '', '', '']);
        priceIdx++;
        // 독립형
        rows.push([type, '독립형', spec, hName, specs[s][priceIdx], 0, '별도', true, model, addon, load, pillar, shelfT, '', '', '', '', '', '', '', '', '']);
        priceIdx++;
      }
    }
    return rows;
  }

  // ─── 1. 고급형 경량Rack ───
  var t1Heights = ['1200(4단)', '1500(4단)', '1800(5단)', '2100(5단)', '2400(5단)'];
  // [규격, 1200연결, 1200독립, 1500연결, 1500독립, 1800연결, 1800독립, 2100연결, 2100독립, 2400연결, 2400독립, 선반추가]
  // 1200과 1500은 동일 가격이므로 복제
  var t1Specs = [
    ['450*900',  66900,79300, 66900,79300, 79700,94000, 81700,98000, 83900,102500, 10800],
    ['450*1200', 81700,94000, 81700,94000, 94700,109000, 96700,113000, 98900,117500, 13300],
    ['450*1500', 101700,114000, 101700,114000, 118700,133000, 120700,137000, 122900,141500, 17300],
    ['600*900',  80900,93300, 80900,93300, 97200,111500, 99200,115500, 101400,120000, 14300],
    ['600*1200', 97400,109800, 97400,109800, 117200,131500, 119200,135500, 121400,140000, 17800],
    ['300*900',  54400,66800, 54400,66800, 64000,78400, 66000,82400, 68300,86900, 7700],
    ['300*1200', 62900,75300, 62900,75300, 74000,88400, 76000,92400, 78300,96900, 9200],
  ];
  allRows = allRows.concat(gridRows('고급경량랙', 'A', t1Specs, t1Heights, 0, '150Kg', '1.8T', '0.8T'));

  // 고급경량랙 철망
  var t1Mesh = [
    ['900*1500', 12700], ['900*1800', 16200], ['900*2100', 17500], ['900*2400', 21800],
    ['1200*1500', 15600], ['1200*1800', 20000], ['1200*2100', 22800], ['1200*2400', 27800],
  ];
  for (var i = 0; i < t1Mesh.length; i++) {
    allRows.push(['고급경량랙', '', t1Mesh[i][0], '', t1Mesh[i][1], 0, '별도', true, 'A', 0, '', '', '', '', '', '', '', '', '', '', 'true', '철망']);
  }

  // 고급경량랙 가격표시기(라벨홀더)
  allRows.push(['고급경량랙', '', '840(900용)', '', 600, 0, '별도', true, 'A', 0, '', '', '', '', '', '', '', '', '', '', 'true', '가격표시기']);
  allRows.push(['고급경량랙', '', '1140(1200용)', '', 800, 0, '별도', true, 'A', 0, '', '', '', '', '', '', '', '', '', '', 'true', '가격표시기']);

  // ─── 2. KD하이퍼 (중선반380) ───
  // 추가선반(받침포함)
  var t2Shelves = [
    ['1000*380', 10700], ['1200*380', 12300],
    ['1000*450', 13600], ['1200*450', 15300],
    ['1000*540', 16800], ['1200*540', 19600],
  ];
  for (var i = 0; i < t2Shelves.length; i++) {
    allRows.push(['하이퍼 진열대', '', t2Shelves[i][0], '', t2Shelves[i][1], 0, '별도', true, 'B', 0, '', '', '', '', '', '', '', '', '', '', 'true', '추가선반']);
  }

  // 하이퍼 품목별 단가표
  // heights: 975(3단), 1250(4단), 1360(4단), 1530(5단), 1800(5단), 2080(5단), 2350(5단)
  var t2Heights = ['975(3단)', '1250(4단)', '1360(4단)', '1530(5단)', '1800(5단)', '2080(5단)', '2350(5단)'];
  // [규격기준, 배치유형, 후면판유형, 형태, prices...]
  var t2Items = [
    // 1000*500 / 1000*1000 계열
    ['1000', '벽면', '후면판단면', '독립형', 81100,98700,105100,117500,125600,133700,143100],
    ['1000', '벽면', '후면판단면', '연결형', 66900,83200,87800,100100,106300,112600,119500],
    ['1000', '앤드', '후면판양면', '독립형', 89900,111800,121000,135000,147500,160000,173700],
    ['1000', '앤드', '후면판양면', '연결형', 75600,96300,103600,117600,128200,138800,150100],
    ['1000', '중앙', '후면판양면', '독립형', 135700,168300,177500,202100,214600,227100,240900],
    ['1000', '중앙', '후면판양면', '연결형', 115400,146700,154000,178600,189200,199900,211100],
    // 1200*500 / 1200*1000 계열
    ['1200', '벽면', '후면판단면', '독립형', 89500,109500,116400,130600,139500,148400,158500],
    ['1200', '벽면', '후면판단면', '연결형', 75300,94000,99000,113200,120200,127200,134900],
    ['1200', '앤드', '후면판양면', '독립형', 99800,124800,135000,151100,165100,179100,194400],
    ['1200', '앤드', '후면판양면', '연결형', 85500,109300,117600,133700,145900,158000,170700],
    ['1200', '중앙', '후면판양면', '독립형', 150900,188200,198400,226800,240800,254800,270100],
    ['1200', '중앙', '후면판양면', '연결형', 130500,166600,174900,203300,215400,227600,240300],
    // 1000*600 / 1000*1200 계열
    ['1000(깊이600)', '벽면', '후면판단면', '독립형', 85400,102900,109400,121700,129800,138000,147300],
    ['1000(깊이600)', '벽면', '후면판단면', '연결형', 70100,86400,91000,103300,109600,115800,122700],
    ['1000(깊이600)', '앤드', '후면판양면', '독립형', 94100,116000,125200,139200,151700,164200,178000],
    ['1000(깊이600)', '앤드', '후면판양면', '연결형', 78900,99500,106800,120800,131500,142100,153300],
    ['1000(깊이600)', '중앙', '후면판양면', '독립형', 144200,176800,186000,210600,223100,235600,249400],
    ['1000(깊이600)', '중앙', '후면판양면', '연결형', 121900,153200,160500,185100,195700,206400,217600],
    // 1200*600 / 1200*1200 계열
    ['1200(깊이600)', '벽면', '후면판단면', '독립형', 94800,114700,121700,135900,144700,153600,163700],
    ['1200(깊이600)', '벽면', '후면판단면', '연결형', 79500,98200,103300,117500,124500,131500,139100],
    ['1200(깊이600)', '앤드', '후면판양면', '독립형', 105000,130100,140200,156400,170400,184400,199600],
    ['1200(깊이600)', '앤드', '후면판양면', '연결형', 89800,113600,121900,138000,150100,162200,175000],
    ['1200(깊이600)', '중앙', '후면판양면', '독립형', 161400,198700,208900,237300,251300,265300,280600],
    ['1200(깊이600)', '중앙', '후면판양면', '연결형', 139000,175100,183400,211800,223900,236100,248800],
    // 1000*800 프로
    ['1000(깊이800)', '프로', '후면판양면', '독립형', 101500,112800,122600,125300,137800,150300,164000],
  ];
  for (var i = 0; i < t2Items.length; i++) {
    var item = t2Items[i];
    for (var h = 0; h < t2Heights.length; h++) {
      allRows.push(['하이퍼 진열대', item[3], item[0], t2Heights[h], item[4 + h], 0, '별도', true, 'B', 0, '', '', '', item[1], item[2], '', '', '', '', '', '', '']);
    }
  }

  // 하이퍼 소품
  var t2Acc = [
    ['STOPPER', '1000', 1600], ['STOPPER', '1200', 1900],
    ['DIVIDER', '380', 1850], ['DIVIDER', '450', 1850],
    ['HOOK BAR', '1000', 4800], ['HOOK BAR', '1200', 5200],
    ['점블박스', '1000*400', 23000], ['점블박스', '1200*400', 26000],
  ];
  for (var i = 0; i < t2Acc.length; i++) {
    allRows.push(['하이퍼 진열대', '', t2Acc[i][1], '', t2Acc[i][2], 0, '별도', true, 'B', 0, '', '', '', '', '', t2Acc[i][0], '', '', '', '', 'true', '소품']);
  }

  // ─── 3. 신형곤도라 ───
  // 부품 단가
  var t3Parts = [
    ['기둥', 1980, 12500], ['기둥', 1880, 11800], ['기둥', 1580, 10300],
    ['기둥', 1380, 9400], ['기둥', 1180, 8500],
    ['상연결대', 900, 2200], ['하연결대', 900, 2900],
    ['앞장', 900, 2300],
    ['옆장', 450, 4500], ['옆장', 400, 4500], ['옆장', 350, 4500], ['옆장', 320, 4500],
    ['선반', '900*450', 8200], ['선반', '900*400', 6800], ['선반', '900*350', 6300], ['선반', '900*320', 5800],
    ['중앙', 1245, 11600], ['철망', 1445, 13500], ['철망', 1745, 16200], ['철망', 1845, 17500],
    ['받침', 450, 1000], ['받침', 350, 750], ['받침', 320, 650],
    ['STOPPER', '', 1450], ['DIVIDER', '', 1750], ['HOOK BAR', '', 6500], ['라벨홀더', '', 600],
  ];
  for (var i = 0; i < t3Parts.length; i++) {
    var p = t3Parts[i];
    allRows.push(['곤도라 진열대', '', String(p[1]), '', p[2], 0, '별도', true, 'D', 0, '', '', '', '', '', p[0], p[1] ? Number(p[1]) || '' : '', '', '', '', '', '']);
  }

  // 곤도라 세트 조합 (BOM)
  var t3Sets = [
    ['앤드(900*450*1380*4s)', '독립형', 78700, '{"기둥(1380)":2,"상연결대(900)":1,"하연결대(900)":1,"앞장(900)":1,"옆장(450)":2,"선반(900*450)":1,"선반(900*320)":3,"중앙(1245)":1,"320받침":6,"라벨홀더":4}'],
    ['앤드(900*450*1380*4s)', '연결형', 64800, '{"기둥(1380)":1,"상연결대(900)":1,"하연결대(900)":1,"앞장(900)":1,"옆장(450)":1,"선반(900*450)":1,"선반(900*320)":3,"중앙(1245)":1,"320받침":6,"라벨홀더":4}'],
    ['벽대(900*450*1880*5s)', '독립형', 95800, '{"기둥(1880)":2,"상연결대(900)":1,"하연결대(900)":1,"앞장(900)":1,"옆장(450)":2,"선반(900*450)":1,"선반(900*320)":4,"철망(1745)":1,"320받침":8,"라벨홀더":5}'],
    ['벽대(900*450*1880*5s)', '연결형', 79500, '{"기둥(1880)":1,"상연결대(900)":1,"하연결대(900)":1,"앞장(900)":1,"옆장(450)":1,"선반(900*450)":1,"선반(900*320)":4,"철망(1745)":1,"320받침":8,"라벨홀더":5}'],
    ['중대(900*900*1380*4s)', '독립형', 121900, '{"기둥(1380)":2,"상연결대(900)":1,"하연결대(900)":1,"앞장(900)":2,"옆장(450)":4,"선반(900*320)":6,"중앙(1245)":1,"320받침":12,"라벨홀더":8}'],
    ['중대(900*900*1380*4s)', '연결형', 103500, '{"기둥(1380)":1,"상연결대(900)":1,"하연결대(900)":1,"앞장(900)":2,"옆장(450)":2,"선반(900*320)":6,"중앙(1245)":1,"320받침":12,"라벨홀더":8}'],
  ];
  for (var i = 0; i < t3Sets.length; i++) {
    var s = t3Sets[i];
    allRows.push(['곤도라 진열대', s[1], s[0], '', s[2], 0, '별도', true, 'D', 0, '', '', '', '', '', '', '', '', s[0], s[3], '', '']);
  }

  // ─── 5. KD 중량Rack ───
  var t5Heights = ['1500(4단)', '1800(4단)', '2100(4단)', '2400(4단)'];
  // [규격, 1500연결, 1500독립, 1800연결, 1800독립, 2100연결, 2100독립, 2400연결, 2400독립, 선반추가]
  var t5Specs = [
    ['450*900',  84000,99500, 86500,104500, 89300,110000, 92000,115500, 13400],
    ['450*1200', 100500,116000, 103000,121000, 105800,126500, 108500,132000, 16400],
    ['450*1500', 118500,134000, 121000,139000, 123800,144500, 126500,150000, 19800],
    ['450*1800', 136500,152000, 139000,157000, 141800,162500, 144500,168000, 23000],
    ['600*900',  101500,117000, 104000,122000, 106800,127500, 109500,133000, 17800],
    ['600*1200', 123500,139000, 126000,144000, 128800,149500, 131500,155000, 22200],
    ['600*1500', 146500,162000, 149000,167000, 151800,172500, 154500,178000, 26800],
    ['600*1800', 170500,186000, 173000,191000, 175800,196500, 178500,202000, 31500],
    ['900*900',  136500,152000, 139000,157000, 141800,162500, 144500,168000, 26500],
    ['900*1200', 165000,180500, 167500,185500, 170300,191000, 173000,196500, 32500],
    ['900*1500', 196500,212000, 199000,217000, 201800,222500, 204500,228000, 39300],
    ['900*1800', 227500,243000, 230000,248000, 232800,253500, 235500,259000, 45800],
  ];
  allRows = allRows.concat(gridRows('KD중량랙', 'A', t5Specs, t5Heights, 0, '300Kg', '2.0T', '1.0T'));

  // ─── 6. KD신형 MD 경량Rack ───
  var t6Heights = ['1200(4단)', '1500(4단)', '1800(5단)', '2100(5단)', '2400(5단)'];
  var t6Specs = [
    ['450*900',  59400,71500, 59400,71500, 70700,85000, 72800,89200, 75000,93600, 9200],
    ['450*1200', 71000,83100, 71000,83100, 84400,98700, 86500,102900, 88700,107200, 11200],
    ['450*1500', 84800,96900, 84800,96900, 100600,114900, 102700,119100, 104800,123400, 13700],
    ['600*900',  72500,84600, 72500,84600, 87100,101400, 89200,105600, 91400,110000, 12500],
    ['600*1200', 87300,99400, 87300,99400, 104700,119000, 106800,123200, 109000,127600, 15300],
    ['300*900',  51600,63700, 51600,63700, 61000,75300, 63100,79500, 65300,83800, 7200],
    ['300*1200', 61300,73400, 61300,73400, 72300,86600, 74400,90800, 76500,95100, 8800],
  ];
  allRows = allRows.concat(gridRows('MD경량랙', 'A', t6Specs, t6Heights, 0, '100Kg', '1.6T', '0.65T'));

  // MD경량랙 철망
  var t6Mesh = [
    ['900*1500', 12700], ['900*1800', 16200], ['900*2100', 17500], ['900*2400', 21800],
    ['1200*1500', 15600], ['1200*1800', 20000], ['1200*2100', 22800], ['1200*2400', 27800],
  ];
  for (var i = 0; i < t6Mesh.length; i++) {
    allRows.push(['MD경량랙', '', t6Mesh[i][0], '', t6Mesh[i][1], 0, '별도', true, 'A', 0, '', '', '', '', '', '', '', '', '', '', 'true', '철망']);
  }

  // ─── 7. 아연Rack ───
  var t7Heights = ['1200(4단)', '1500(4단)', '1800(5단)', '2100(5단)', '2400(5단)'];
  var t7Specs = [
    ['450*900',  49600,59000, 49600,59000, 59000,69900, 60900,73700, 63500,78900, 8000],
    ['450*1200', 62800,72100, 62800,72100, 72800,83700, 74700,87400, 77300,92700, 10100],
    ['600*900',  61300,70700, 61300,70700, 73700,84500, 75500,88300, 78200,93500, 10900],
    ['600*1200', 75300,84700, 75300,84700, 90400,101300, 92300,105000, 94900,110300, 13600],
    ['300*900',  43400,52700, 43400,52700, 51000,61900, 52900,65700, 55500,70900, 6200],
    ['300*1200', 53900,63200, 53900,63200, 63400,74300, 65300,78000, 67900,83300, 8100],
  ];
  allRows = allRows.concat(gridRows('아연랙', 'A', t7Specs, t7Heights, 0, '150Kg', '1.6T', '0.8T'));

  // ─── 8. 스마트 앵글랙(무볼트앵글) ───
  // 기둥 (1.8t)
  var t8Pillars = [[900,1800],[1200,2400],[1500,3000],[1800,3600],[2100,4200],[2400,4800]];
  for (var i = 0; i < t8Pillars.length; i++) {
    allRows.push(['무볼트앵글', '', String(t8Pillars[i][0]), '', t8Pillars[i][1], 0, '별도', true, 'C', 0, '', '1.8T', '', '', '', '기둥', t8Pillars[i][0], '1.8T', '', '', '', '']);
  }
  // 안전좌
  allRows.push(['무볼트앵글', '', '안전좌', '', 80, 0, '별도', true, 'C', 0, '', '', '', '', '', '안전좌', '', '', '', '', 'true', '부속품']);

  // 받침 (1.8t)
  var t8Shelf18 = [[300,600],[400,800],[450,900],[500,1000],[600,1200],[700,1400],[800,1600],[900,1800],[1000,2000],[1100,2200],[1200,2400]];
  for (var i = 0; i < t8Shelf18.length; i++) {
    allRows.push(['무볼트앵글', '', String(t8Shelf18[i][0]), '', t8Shelf18[i][1], 0, '별도', true, 'C', 0, '', '', '', '', '', '받침', t8Shelf18[i][0], '1.8T', '', '', '', '']);
  }

  // 받침 (2.0t)
  allRows.push(['무볼트앵글', '', '1500', '', 3220, 0, '별도', true, 'C', 0, '', '', '', '', '', '받침', 1500, '2.0T', '', '', '', '']);

  // 연결형 받침 (1.8t)
  var t8ConnShelf = [[300,1000],[400,1200],[450,1300],[500,1400],[600,1600],[700,1800],[800,2000],[900,2200]];
  for (var i = 0; i < t8ConnShelf.length; i++) {
    allRows.push(['무볼트앵글', '연결형', String(t8ConnShelf[i][0]), '', t8ConnShelf[i][1], 0, '별도', true, 'C', 0, '', '', '', '', '', '연결형받침', t8ConnShelf[i][0], '1.8T', '', '', '', '']);
  }

  // 보강대 (백색)
  var t8Brace = [[400,1550],[500,1650],[600,1750],[700,1950],[800,2150],[900,2350],[1000,2550]];
  for (var i = 0; i < t8Brace.length; i++) {
    allRows.push(['무볼트앵글', '', String(t8Brace[i][0]), '', t8Brace[i][1], 0, '별도', true, 'C', 0, '', '', '', '', '', '보강대', t8Brace[i][0], '', '', '', '', '']);
  }

  // 바퀴형브라켓
  allRows.push(['무볼트앵글', '', '바퀴형브라켓', '', 6000, 0, '별도', true, 'C', 0, '', '', '', '', '', '바퀴형브라켓', '', '', '', '', 'true', '부속품']);

  // 바퀴 (적색 우레탄)
  allRows.push(['무볼트앵글', '', '2.5 BK회전', '', 3300, 0, '별도', true, 'C', 0, '', '', '', '', '', '바퀴', '', '', '', '', 'true', '부속품']);
  allRows.push(['무볼트앵글', '', '2.5 일반회전', '', 3000, 0, '별도', true, 'C', 0, '', '', '', '', '', '바퀴', '', '', '', '', 'true', '부속품']);

  // ─── 일괄 쓰기 ───
  if (allRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, allRows.length, 22).setValues(allRows);
  }

  _clearCache('cache_prices');
  return { result: 'success', rowsInserted: allRows.length };
}

// ============================================================
// Gemini API 연동
// ============================================================

function _getGeminiApiKey() {
  var data = getSheet('설정').getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === 'geminiApiKey') return String(data[i][1]).trim();
  }
  return '';
}

function _callGemini(prompt, options) {
  var apiKey = _getGeminiApiKey();
  if (!apiKey) return { error: 'Gemini API 키가 설정되지 않았습니다. 설정 페이지에서 입력하세요.' };

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=' + apiKey;

  var parts = [];
  if (options && options.imageBase64) {
    parts.push({
      inlineData: {
        mimeType: options.imageMimeType || 'image/jpeg',
        data: options.imageBase64
      }
    });
  }
  parts.push({ text: prompt });

  var genConfig = {
    responseMimeType: 'application/json',
    temperature: 0.3,
    maxOutputTokens: 2048
  };

  if (options && options.schema) {
    genConfig.responseSchema = options.schema;
  }

  var body = {
    contents: [{ parts: parts }],
    generationConfig: genConfig
  };

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    var raw = response.getContentText();
    var json = JSON.parse(raw);
    if (json.error) return { error: json.error.message };
    if (!json.candidates || !json.candidates[0]) return { error: '응답이 비어있습니다', _raw: raw.substring(0, 500) };

    // Gemini 3 응답에서 text 파트 찾기 (thinking 파트 건너뛰기)
    var contentParts = json.candidates[0].content.parts || [];
    var text = '';
    for (var p = 0; p < contentParts.length; p++) {
      if (contentParts[p].text) {
        text = contentParts[p].text;
      }
    }
    if (!text) return { error: '텍스트 응답이 비어있습니다', _raw: raw.substring(0, 500) };

    // 마크다운 코드블록 제거 (```json ... ```)
    text = text.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    try { return JSON.parse(text); }
    catch(e) {
      // 잘린 JSON 복구 시도: 부족한 중괄호/대괄호 닫기
      var open = (text.match(/\{/g) || []).length;
      var close = (text.match(/\}/g) || []).length;
      var openArr = (text.match(/\[/g) || []).length;
      var closeArr = (text.match(/\]/g) || []).length;
      var fixed = text;
      // 마지막 불완전 키-값 제거
      fixed = fixed.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, '');
      for (var a = 0; a < openArr - closeArr; a++) fixed += ']';
      for (var b = 0; b < open - close; b++) fixed += '}';
      try { return JSON.parse(fixed); }
      catch(e2) { return { rawText: text }; }
    }
  } catch (e) {
    return { error: 'Gemini API 호출 실패: ' + e.message };
  }
}

// ─── 견적 요청 AI 분석 ───
function analyzeRequest(body) {
  var memo = body.memo || '';
  var rackType = body.rackType || '';
  var quantity = body.quantity || 0;

  // 단가표에서 랙 종류 목록과 대표 가격 추출
  var prices = getPrices();
  var typeMap = {};
  (prices.prices || []).forEach(function(p) {
    if (p.isAccessory) return;
    if (!typeMap[p.type]) typeMap[p.type] = [];
    if (typeMap[p.type].length < 3) {
      typeMap[p.type].push(p.form + ' ' + p.spec + ' ' + p.tier + ' = ' + p.unitPrice + '원');
    }
  });
  var priceContext = Object.keys(typeMap).map(function(t) {
    return t + ':\n  ' + typeMap[t].join('\n  ');
  }).join('\n');

  var prompt = '당신은 산업용 랙(선반) 설치 전문 견적 컨설턴트입니다.\n' +
    '고객이 견적 요청 시 남긴 정보를 분석하여 최적의 랙을 추천하세요.\n\n' +
    '【고객 요청 정보】\n' +
    '- 선택한 랙종류: ' + (rackType || '미선택') + '\n' +
    '- 예상 수량: ' + (quantity || '미정') + '\n' +
    '- 메모: ' + (memo || '없음') + '\n\n' +
    '【현재 취급 랙 종류 및 대표 가격】\n' + priceContext + '\n\n' +
    '위 정보를 바탕으로 분석 결과를 아래 JSON 형식으로 반환하세요:\n' +
    '{"analysis":"메모 분석 요약","recommendedType":"추천 랙종류(단가표의 정확한 이름)","recommendedForm":"연결형 또는 독립형","recommendedSpec":"추천 규격(예: 450*900)","recommendedQty":수량숫자,"estimatedPriceRange":"예상 가격 범위","reasoning":"추천 이유","confidence":"high/medium/low"}';

  // schema는 더 이상 API에 전달하지 않고 프롬프트에서 형식 지정
  var schema = {
    type: 'object',
    properties: {
      analysis: { type: 'string' },
      recommendedType: { type: 'string' },
      recommendedForm: { type: 'string' },
      recommendedSpec: { type: 'string' },
      recommendedQty: { type: 'integer' },
      estimatedPriceRange: { type: 'string' },
      reasoning: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
    },
    required: ['analysis', 'recommendedType', 'recommendedQty', 'confidence']
  };

  return _callGemini(prompt, { schema: schema });
}

// ─── 사진 + 치수 AI 분석 ───
function analyzePhoto(body) {
  var width = body.width || 0;
  var depth = body.depth || 0;
  var height = body.height || 0;
  var purpose = body.purpose || '';
  var cargoType = body.cargoType || '';
  var cargoWeight = body.cargoWeight || '';
  var memo = body.memo || '';
  var imageBase64 = body.imageBase64 || '';

  if (!imageBase64) return { error: '사진이 필요합니다' };

  var prices = getPrices();
  var typeList = [];
  var seen = {};
  (prices.prices || []).forEach(function(p) {
    if (!p.isAccessory && !seen[p.type]) {
      typeList.push(p.type + ' (내하중: ' + (p.loadCapacity || '미정') + ')');
      seen[p.type] = true;
    }
  });

  var prompt = '당신은 창고/물류센터 랙 설치 전문가입니다.\n' +
    '첨부된 현장 사진과 공간 정보를 분석하여 랙 설치를 추천하세요.\n\n' +
    '【공간 치수】\n' +
    '- 가로: ' + width + 'm / 세로: ' + depth + 'm / 높이: ' + height + 'm\n' +
    (purpose ? '- 용도/환경: ' + purpose + '\n' : '') +
    (cargoType ? '- 보관물: ' + cargoType + '\n' : '') +
    (cargoWeight ? '- 보관물 무게: ' + cargoWeight + '\n' : '') +
    (memo ? '- 요구사항: ' + memo + '\n' : '') +
    '\n【취급 랙 종류】\n' + typeList.join(', ') + '\n\n' +
    '사진에서 다음을 분석하세요:\n' +
    '1. 바닥 유형 (콘크리트, 에폭시 등)\n' +
    '2. 기존 랙/설비 유무\n' +
    '3. 장애물 (기둥, 배관 등)\n' +
    '4. 환경 (일반 창고, 냉동/냉장 등)\n\n' +
    '분석 결과를 아래 JSON 형식으로 반환하세요:\n' +
    '{"photoAnalysis":{"floorType":"바닥유형","existingRacks":"기존랙유무","obstacles":"장애물","environment":"환경유형"},"recommendation":{"rackType":"추천 랙종류(단가표의 정확한 이름)","layout":"배치 설명","estimatedQty":수량숫자,"reasoning":"추천 이유"},"warnings":["주의사항1","주의사항2"]}';

  var schema = {
    type: 'object',
    properties: {
      photoAnalysis: {
        type: 'object',
        properties: {
          floorType: { type: 'string' },
          existingRacks: { type: 'string' },
          obstacles: { type: 'string' },
          environment: { type: 'string' }
        }
      },
      recommendation: {
        type: 'object',
        properties: {
          rackType: { type: 'string' },
          layout: { type: 'string' },
          estimatedQty: { type: 'integer' },
          reasoning: { type: 'string' }
        }
      },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };

  return _callGemini(prompt, {
    imageBase64: imageBase64,
    imageMimeType: body.imageMimeType || 'image/jpeg',
    schema: schema
  });
}
