/**
 * Code.gs — 용인 랙 Google Apps Script 백엔드
 * Google Sheets를 DB로 사용하는 웹 앱 API
 *
 * 시트 구조:
 *   단가표: [랙종류, 규격, 단수, 기본단가, 추가시공비, VAT적용, 활성]
 *   견적내역: [견적일시, 견적번호, 고객명, 회사명, 연락처, 주소, 랙종류, 규격, 단수, 수량, 단가, 시공비, 총액, 진행상태]
 *   견적요청: [요청일시, 고객명, 연락처, 랙종류, 수량, 메모, 처리상태]
 *   설정: [key, value]
 *   포트폴리오: [날짜, 견적번호, 설명, 사진URL]
 */

const SPREADSHEET_ID = ''; // 실제 시트 ID로 교체
const API_KEY = 'yr-api-key-2026';

// ============================================================
// doGet — 읽기 요청
// ============================================================
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';

  try {
    switch (action) {
      case 'getPrices':
        return jsonResponse(getPrices());
      case 'getEstimates':
        return jsonResponse(getEstimates());
      case 'getDashboard':
        return jsonResponse(getDashboard());
      case 'getRequests':
        return jsonResponse(getRequests());
      case 'getPortfolio':
        return jsonResponse(getPortfolio());
      case 'getSettings':
        return jsonResponse(getSettings());
      case 'viewEstimate':
        return viewEstimateHtml(e.parameter.id);
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

    // API Key 검증 (고객 요청 제외)
    if (action !== 'submitRequest' && body.apiKey !== API_KEY) {
      return jsonResponse({ error: 'Unauthorized' });
    }

    // LockService로 동시 쓰기 보호
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

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
        case 'uploadPhoto':
          result = uploadPhoto(body);
          break;
        case 'saveSettings':
          result = saveSettings(body);
          break;
        default:
          result = { error: 'Unknown action' };
      }
    } finally {
      lock.releaseLock();
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
// 단가표
// ============================================================
function getPrices() {
  const sheet = getSheet('단가표');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { prices: [] };

  const prices = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[6] === false || row[6] === '삭제') continue; // 비활성/삭제
    prices.push({
      rowIndex: i + 1,
      type: row[0],
      spec: row[1],
      tier: row[2],
      price: Number(row[3]) || 0,
      installFee: Number(row[4]) || 0,
      vat: row[5] || '별도',
    });
  }
  return { prices };
}

function addPrice(body) {
  const sheet = getSheet('단가표');
  sheet.appendRow([
    body.type, body.spec, body.tier,
    Number(body.price) || 0, Number(body.installFee) || 0,
    body.vat || '별도', true
  ]);
  return { result: 'success' };
}

function updatePrice(body) {
  const sheet = getSheet('단가표');
  const row = Number(body.rowIndex);
  if (row < 2) return { error: 'Invalid row' };
  sheet.getRange(row, 1, 1, 6).setValues([[
    body.type, body.spec, body.tier,
    Number(body.price) || 0, Number(body.installFee) || 0,
    body.vat || '별도'
  ]]);
  return { result: 'success' };
}

function deletePrice(rowIndex) {
  const sheet = getSheet('단가표');
  const row = Number(rowIndex);
  if (row < 2) return { error: 'Invalid row' };
  // 소프트 삭제
  sheet.getRange(row, 7).setValue('삭제');
  return { result: 'success' };
}

// ============================================================
// 견적 저장/조회
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
      if (data[i][14] === body.clientId) {
        return { result: 'success', estimateId: data[i][1], duplicate: true };
      }
    }
  }

  sheet.appendRow([
    dateStr,
    estimateId,
    body.name || '',
    body.company || '',
    body.phone || '',
    body.address || '',
    body.rackType || '',
    body.spec || '',
    body.tier || '',
    Number(body.quantity) || 0,
    Number(body.unitPrice) || 0,
    Number(body.totalInstall) || 0,
    Number(body.total) || 0,
    '상담완료',
    body.clientId || ''
  ]);

  return { result: 'success', estimateId: estimateId, row: sheet.getLastRow() };
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

function getEstimates() {
  const sheet = getSheet('견적내역');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { estimates: [] };

  const estimates = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    estimates.push({
      date: row[0],
      estimateId: row[1],
      customerName: row[2],
      company: row[3],
      phone: row[4],
      address: row[5],
      rackType: row[6],
      spec: row[7],
      tier: row[8],
      quantity: Number(row[9]),
      unitPrice: Number(row[10]),
      totalInstall: Number(row[11]),
      total: Number(row[12]),
      status: row[13],
    });
  }
  return { estimates };
}

function updateStatus(estimateId, newStatus) {
  const validStatuses = ['상담완료', '계약', '시공중', '시공완료'];
  if (!validStatuses.includes(newStatus)) return { error: 'Invalid status' };

  const sheet = getSheet('견적내역');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === estimateId) {
      sheet.getRange(i + 1, 14).setValue(newStatus);
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
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const thisMonth = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM');

  let count = 0, totalAmount = 0, contracted = 0;
  const recent = [];

  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const dateStr = String(row[0]);
    if (dateStr.startsWith(thisMonth)) {
      count++;
      totalAmount += Number(row[12]) || 0;
      if (row[13] === '계약' || row[13] === '시공중' || row[13] === '시공완료') {
        contracted++;
      }
    }
    if (recent.length < 5) {
      recent.push({
        date: row[0], estimateId: row[1], customerName: row[2],
        rackType: row[6], total: Number(row[12]), status: row[13],
      });
    }
  }

  return { count, totalAmount, contracted, recent };
}

// ============================================================
// 고객 견적 요청
// ============================================================
function submitRequest(body) {
  // 간단한 rate limiting: 같은 연락처로 1시간 내 5건 제한
  const sheet = getSheet('견적요청');
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
  sheet.appendRow([
    now, body.name || '', body.phone || '',
    body.rackType || '', Number(body.quantity) || 0,
    body.memo || '', '미처리'
  ]);
  return { result: 'success' };
}

function getRequests() {
  const sheet = getSheet('견적요청');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { requests: [] };

  const requests = [];
  for (let i = data.length - 1; i >= 1; i--) {
    requests.push({
      date: data[i][0], name: data[i][1], phone: data[i][2],
      rackType: data[i][3], quantity: Number(data[i][4]),
      memo: data[i][5], status: data[i][6],
    });
  }
  return { requests };
}

// ============================================================
// 포트폴리오
// ============================================================
function uploadPhoto(body) {
  // base64 이미지를 Google Drive에 저장
  const folder = getOrCreateFolder('용인랙_포트폴리오');
  const blob = Utilities.newBlob(
    Utilities.base64Decode(body.base64Data),
    'image/jpeg',
    body.filename || 'photo.jpg'
  );
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = 'https://drive.google.com/uc?id=' + file.getId();

  // 시트에 기록
  const sheet = getSheet('포트폴리오');
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  sheet.appendRow([now, body.estimateId || '', body.description || '', url]);

  return { result: 'success', photoUrl: url };
}

function getPortfolio() {
  const sheet = getSheet('포트폴리오');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { photos: [] };

  const photos = [];
  for (let i = data.length - 1; i >= 1; i--) {
    photos.push({
      date: data[i][0], estimateId: data[i][1],
      description: data[i][2], photoUrl: data[i][3],
    });
  }
  return { photos };
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
  const data = sheet.getDataRange().getValues();
  const keys = Object.keys(body).filter(k => k !== 'action' && k !== 'apiKey');

  keys.forEach(key => {
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(body[key]);
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([key, body[key]]);
    }
  });
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
      est = {
        date: data[i][0], id: data[i][1],
        name: data[i][2], company: data[i][3],
        phone: String(data[i][4]).replace(/(\d{3})(\d{4})(\d{4})/, '$1-****-$3'),
        address: data[i][5], rackType: data[i][6],
        spec: data[i][7], tier: data[i][8],
        quantity: Number(data[i][9]), unitPrice: Number(data[i][10]),
        installFee: Number(data[i][11]), total: Number(data[i][12]),
      };
      break;
    }
  }

  if (!est) {
    return HtmlService.createHtmlOutput('<h1>견적서를 찾을 수 없습니다</h1>')
      .setTitle('용인 랙');
  }

  const subtotal = est.unitPrice * est.quantity;
  const fmt = (n) => Number(n).toLocaleString('ko-KR');

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>[용인 랙] 견적서 - ${est.id}</title>
  <meta property="og:title" content="[용인 랙] 맞춤형 견적서가 도착했습니다">
  <meta property="og:description" content="${est.rackType} ${est.quantity}대 — ${fmt(est.total)}원">
  <meta property="og:type" content="website">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css">
  <style>body{font-family:'Pretendard',sans-serif}</style>
</head>
<body class="bg-gray-50 min-h-screen flex items-start justify-center py-6">
  <div class="bg-white rounded-2xl shadow-sm border border-gray-100 w-full max-w-md mx-4 overflow-hidden">
    <div class="bg-[#1e3a5f] text-white px-5 py-4 text-center">
      <h1 class="text-xl font-extrabold">용인 랙</h1>
      <p class="text-xs opacity-80 mt-1">전문 랙 설치 시공</p>
    </div>
    <div class="p-5">
      <div class="flex justify-between text-xs text-gray-500 mb-4">
        <span>견적일: ${est.date}</span><span>${est.id}</span>
      </div>
      ${est.name ? `<div class="bg-gray-50 rounded-xl p-3 mb-4 text-sm">
        <p class="font-bold text-gray-800">${est.name}${est.company ? ' (' + est.company + ')' : ''}</p>
        ${est.address ? '<p class="text-gray-500 mt-1">' + est.address + '</p>' : ''}
      </div>` : ''}
      <div class="border-t pt-3">
        <div class="flex justify-between py-2 text-sm"><span>${est.rackType} (${est.spec}, ${est.tier})</span><span>${est.quantity}대</span></div>
        <div class="flex justify-between py-2 text-sm text-gray-500"><span class="pl-3">기본 단가</span><span>@${fmt(est.unitPrice)}</span></div>
        <div class="flex justify-between py-2 text-sm border-b border-dashed"><span class="pl-3">소계</span><span>${fmt(subtotal)}원</span></div>
        <div class="flex justify-between py-2 text-sm"><span class="pl-3">시공비</span><span>${fmt(est.installFee)}원</span></div>
      </div>
      <div class="flex justify-between pt-3 mt-2 border-t-2 border-[#1e3a5f]">
        <span class="font-extrabold text-[#1e3a5f]">총 견적액</span>
        <span class="text-xl font-extrabold text-[#f97316]">${fmt(est.total)}원</span>
      </div>
      <p class="text-xs text-gray-400 mt-2 text-right">* 부가세 별도</p>
    </div>
    <div class="bg-gray-50 px-5 py-3 text-center text-xs text-gray-400 border-t">
      용인 랙 | yongin-rack.com
    </div>
  </div>
</body></html>`;

  return HtmlService.createHtmlOutput(html)
    .setTitle('[용인 랙] 견적서')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// 헬퍼
// ============================================================
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    // 헤더 추가
    const headers = {
      '단가표': ['랙종류', '규격', '단수', '기본단가', '추가시공비', 'VAT적용', '활성'],
      '견적내역': ['견적일시', '견적번호', '고객명', '회사명', '연락처', '주소', '랙종류', '규격', '단수', '수량', '단가', '시공비', '총액', '진행상태', 'clientId'],
      '견적요청': ['요청일시', '고객명', '연락처', '랙종류', '수량', '메모', '처리상태'],
      '설정': ['key', 'value'],
      '포트폴리오': ['날짜', '견적번호', '설명', '사진URL'],
    };
    if (headers[name]) {
      sheet.getRange(1, 1, 1, headers[name].length).setValues([headers[name]]);
      sheet.getRange(1, 1, 1, headers[name].length).setFontWeight('bold');
    }
  }
  return sheet;
}
