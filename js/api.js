/**
 * api.js — GAS API 통신 모듈
 * 모든 Google Apps Script 호출을 이 모듈을 통해 수행
 */

const API = (() => {
  // GAS 웹 앱 URL — 배포 후 실제 URL로 교체
  const BASE_URL = localStorage.getItem('yr_gas_url') || '';
  const API_KEY = 'yr-api-key-2026'; // admin 요청 인증용

  async function request(method, params = {}, options = {}) {
    if (!BASE_URL) {
      throw new Error('API URL이 설정되지 않았습니다. 설정에서 GAS URL을 입력하세요.');
    }

    const isAdmin = options.admin !== false;
    const headers = {};
    if (isAdmin) {
      headers['X-API-Key'] = API_KEY;
    }

    try {
      let response;
      if (method === 'GET') {
        const query = new URLSearchParams(params).toString();
        response = await fetch(`${BASE_URL}?${query}`, {
          method: 'GET',
          redirect: 'follow',
        });
      } else {
        response = await fetch(BASE_URL, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain', ...headers },
          body: JSON.stringify({ ...params, apiKey: API_KEY }),
        });
      }

      if (!response.ok) {
        throw new Error(`서버 오류 (${response.status})`);
      }

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('응답 파싱 실패');
      }
    } catch (err) {
      if (!navigator.onLine) {
        throw new Error('인터넷 연결이 필요합니다');
      }
      throw err;
    }
  }

  // --- 단가 관련 ---
  async function getPrices() {
    return request('GET', { action: 'getPrices' });
  }

  async function addPrice(data) {
    return request('POST', { action: 'addPrice', ...data });
  }

  async function updatePrice(rowIndex, data) {
    return request('POST', { action: 'updatePrice', rowIndex, ...data });
  }

  async function deletePrice(rowIndex) {
    return request('POST', { action: 'deletePrice', rowIndex });
  }

  // --- 견적 관련 ---
  async function saveEstimate(data) {
    return request('POST', { action: 'saveEstimate', ...data });
  }

  async function getEstimates() {
    return request('GET', { action: 'getEstimates' });
  }

  async function getDashboard() {
    return request('GET', { action: 'getDashboard' });
  }

  async function updateStatus(estimateId, status) {
    return request('POST', { action: 'updateStatus', estimateId, status });
  }

  // --- 고객 요청 (public, no API key) ---
  async function submitRequest(data) {
    return request('POST', { action: 'submitRequest', ...data }, { admin: false });
  }

  async function getRequests() {
    return request('GET', { action: 'getRequests' });
  }

  // --- 포트폴리오 ---
  async function uploadPhoto(base64Data, filename, estimateId) {
    return request('POST', { action: 'uploadPhoto', base64Data, filename, estimateId });
  }

  async function getPortfolio() {
    return request('GET', { action: 'getPortfolio' });
  }

  // --- 설정 ---
  async function getSettings() {
    return request('GET', { action: 'getSettings' });
  }

  async function saveSettings(data) {
    return request('POST', { action: 'saveSettings', ...data });
  }

  return {
    getPrices, addPrice, updatePrice, deletePrice,
    saveEstimate, getEstimates, getDashboard, updateStatus,
    submitRequest, getRequests,
    uploadPhoto, getPortfolio,
    getSettings, saveSettings,
    get baseUrl() { return BASE_URL; },
  };
})();
