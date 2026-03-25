/**
 * Code.gs — 용인 랙 Google Apps Script 백엔드
 * Google Sheets를 DB로 사용하는 웹 앱 API
 *
 * 시트 구조:
 *   단가표: [랙종류, 규격, 단수, 기본단가, 추가시공비, VAT적용, 활성]
 *   견적내역: [견적일시, 견적번호, 고객명, 회사명, 연락처, 주소, 품목상세(JSON), 총액, 진행상태, clientId]
 *   견적요청: [요청일시, 고객명, 연락처, 랙종류, 수량, 메모, 처리상태]
 *   설정: [key, value]
 *   포트폴리오: [날짜, 견적번호, 설명, 사진URL, 장소]
 */

const SPREADSHEET_ID = '1azkq97HM29dyI-d4YC3FamsudWhuUC7FSPB_rGH8aZg';
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
      case 'getEstimate':
        return jsonResponse(getEstimate(e.parameter.id));
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

    // 사진 업로드는 Lock 없이 처리 (Drive 작업이 오래 걸림)
    if (action === 'uploadPhoto') {
      return jsonResponse(uploadPhoto(body));
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
    if (row[6] === '삭제') continue;
    prices.push({
      rowIndex: i + 1,
      type: row[0],
      spec: row[1],
      tier: row[2],
      unitPrice: Number(row[3]) || 0,
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
    Number(body.unitPrice) || 0, Number(body.installFee) || 0,
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
    Number(body.unitPrice) || 0, Number(body.installFee) || 0,
    body.vat || '별도'
  ]]);
  return { result: 'success' };
}

function deletePrice(rowIndex) {
  const sheet = getSheet('단가표');
  const row = Number(rowIndex);
  if (row < 2) return { error: 'Invalid row' };
  sheet.getRange(row, 7).setValue('삭제');
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

  sheet.appendRow([
    dateStr,
    estimateId,
    body.name || '',
    body.company || '',
    body.phone || '',
    body.address || '',
    itemsJson,
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

function getEstimate(estimateId) {
  if (!estimateId) return { error: 'Missing estimateId' };
  const sheet = getSheet('견적내역');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === estimateId) {
      let items = [];
      try { items = JSON.parse(data[i][6]); } catch {}
      return {
        estimateId: data[i][1],
        date: data[i][0],
        customerName: data[i][2],
        company: data[i][3],
        phone: data[i][4],
        address: data[i][5],
        items: items,
        total: Number(data[i][7]),
        status: data[i][8],
      };
    }
  }
  return { error: 'Estimate not found' };
}

function getEstimates() {
  const sheet = getSheet('견적내역');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { estimates: [] };

  const estimates = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    let items = [];
    try { items = JSON.parse(row[6]); } catch {}

    // 품목 요약 생성
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
      sheet.getRange(i + 1, 9).setValue(newStatus);
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

  // 알림 발송
  sendNewRequestNotification(body.name, body.phone, body.rackType, body.memo);

  return { result: 'success' };
}

/**
 * 새 견적 요청 알림 (ntfy.sh 푸시 + 이메일)
 * ntfy.sh 앱 설치 후 'yonginrack-noti' 토픽 구독 필요
 */
function sendNewRequestNotification(name, phone, rackType, memo) {
  var message = '고객: ' + (name || '미입력') + '\n연락처: ' + (phone || '미입력');
  if (rackType) message += '\n랙종류: ' + rackType;
  if (memo) message += '\n메모: ' + memo;

  // 1) ntfy.sh 푸시 알림 (무료, 앱 설치 필요)
  try {
    UrlFetchApp.fetch('https://ntfy.sh/yonginrack-noti', {
      method: 'post',
      payload: message,
      headers: {
        'Title': '새 견적 요청이 도착했습니다',
        'Tags': 'incoming_envelope',
        'Priority': '4'
      },
      muteHttpExceptions: true
    });
  } catch (e) {}

  // 2) 이메일 알림
  try {
    var settingsSheet = getSheet('설정');
    var settingsData = settingsSheet.getDataRange().getValues();
    var adminEmail = '';
    for (var i = 1; i < settingsData.length; i++) {
      if (settingsData[i][0] === 'adminEmail') {
        adminEmail = settingsData[i][1];
        break;
      }
    }
    if (adminEmail) {
      MailApp.sendEmail({
        to: adminEmail,
        subject: '[용인 랙] 새 견적 요청 - ' + (name || '고객'),
        body: message + '\n\n---\n확인: https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID
      });
    }
  } catch (e) {}
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
    '단가표': ['랙종류', '규격', '단수', '기본단가', '추가시공비', 'VAT적용', '활성'],
    '견적내역': ['견적일시', '견적번호', '고객명', '회사명', '연락처', '주소', '품목상세', '총액', '진행상태', 'clientId'],
    '견적요청': ['요청일시', '고객명', '연락처', '랙종류', '수량', '메모', '처리상태'],
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
