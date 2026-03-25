/**
 * api.js — GAS API 통신 모듈
 * 모든 Google Apps Script 호출을 이 모듈을 통해 수행
 */

const API = (() => {
  // GAS 웹 앱 URL
  const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbwyNb3no3gaqH6nl7LWgyFme_BKsaBqMEa1MUdYNpq8ZkqOJQHHTWchsZ_HlfCe_rjN/exec';
  const BASE_URL = localStorage.getItem('yr_gas_url') || DEFAULT_URL;
  const API_KEY = 'yr-api-key-2026'; // admin 요청 인증용

  async function request(method, params = {}, options = {}) {
    if (!BASE_URL) {
      throw new Error('API URL이 설정되지 않았습니다. 설정에서 GAS URL을 입력하세요.');
    }

    const isAdmin = options.admin !== false;

    try {
      let response;
      if (method === 'GET') {
        const query = new URLSearchParams(params).toString();
        response = await fetch(`${BASE_URL}?${query}`, {
          method: 'GET',
          redirect: 'follow',
        });
      } else {
        // Content-Type: text/plain + no custom headers = no preflight (CORS safe)
        // API key is passed in the body, not headers
        const body = isAdmin
          ? { ...params, apiKey: API_KEY }
          : params;
        response = await fetch(BASE_URL, {
          method: 'POST',
          redirect: 'follow',
          body: JSON.stringify(body),
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

  async function getEstimate(estimateId) {
    return request('GET', { action: 'getEstimate', id: estimateId });
  }

  async function createShareToken(estimateId, hideMargin, docType) {
    return request('POST', { action: 'createShareToken', estimateId, hideMargin: !!hideMargin, docType: docType || 'formal' });
  }

  async function getEstimateByToken(token) {
    return request('GET', { action: 'getEstimateByToken', token });
  }

  async function getEstimates() {
    return request('GET', { action: 'getEstimates' });
  }

  async function getDashboard() {
    return request('GET', { action: 'getDashboard' });
  }

  async function updateEstimate(data) {
    return request('POST', { action: 'updateEstimate', ...data });
  }

  async function deleteEstimate(estimateId) {
    return request('POST', { action: 'deleteEstimate', estimateId });
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

  async function updateRequestStatus(rowIndex, status) {
    return request('POST', { action: 'updateRequestStatus', rowIndex, status });
  }

  async function deleteRequest(rowIndex) {
    return request('POST', { action: 'deleteRequest', rowIndex });
  }

  async function linkEstimateToRequest(rowIndex, estimateId) {
    return request('POST', { action: 'linkEstimateToRequest', rowIndex, estimateId });
  }

  // --- 포트폴리오 ---
  async function uploadPhoto(data) {
    return request('POST', { action: 'uploadPhoto', ...data });
  }

  async function getPortfolio() {
    return request('GET', { action: 'getPortfolio' });
  }

  async function deletePhoto(rowIndex) {
    return request('POST', { action: 'deletePhoto', rowIndex });
  }

  async function getBlogPosts() {
    return request('GET', { action: 'getBlogPosts' });
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
    saveEstimate, updateEstimate, getEstimate, deleteEstimate, createShareToken, getEstimateByToken, getEstimates, getDashboard, updateStatus,
    submitRequest, getRequests, updateRequestStatus, deleteRequest, linkEstimateToRequest,
    uploadPhoto, getPortfolio, deletePhoto, getBlogPosts,
    getSettings, saveSettings,
    get baseUrl() { return BASE_URL; },
  };
})();
