/**
 * estimate.js — 견적서 미리보기 + 카카오톡 공유 + 이미지 다운로드
 */

const Estimate = (() => {
  function getBranding() {
    try {
      return JSON.parse(localStorage.getItem('yr_branding')) || {};
    } catch { return {}; }
  }

  function renderPreview(data) {
    const brand = getBranding();
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    return `
      <div id="estimate-card" class="bg-white rounded-2xl border border-gray-100 mx-4 my-4 overflow-hidden">
        <!-- 헤더 -->
        <div class="bg-[#1e3a5f] text-white px-5 py-4 text-center">
          <h2 class="text-xl font-extrabold">${brand.companyName || '용인 랙'}</h2>
          ${brand.tagline ? `<p class="text-xs opacity-80 mt-1">${brand.tagline}</p>` : ''}
        </div>

        <div class="p-5">
          <!-- 견적 정보 -->
          <div class="flex justify-between text-xs text-gray-500 mb-4">
            <span>견적일: ${dateStr}</span>
            <span>${data.estimateId || ''}</span>
          </div>

          <!-- 고객 정보 -->
          ${data.customerName ? `
          <div class="bg-gray-50 rounded-xl p-3 mb-4 text-sm">
            <p class="font-bold text-gray-800">${data.customerName}${data.company ? ` (${data.company})` : ''}</p>
            ${data.address ? `<p class="text-gray-500 mt-1">${data.address}</p>` : ''}
          </div>` : ''}

          <!-- 견적 내역 -->
          <div class="border-t border-gray-100 pt-3">
            <div class="flex justify-between py-2 text-sm">
              <span class="text-gray-600">${data.rackType} (${data.spec})</span>
              <span class="text-gray-800">${data.quantity}대</span>
            </div>
            <div class="flex justify-between py-2 text-sm">
              <span class="text-gray-500 pl-3">기본 단가</span>
              <span class="text-gray-600">@${UI.formatNumber(data.unitPrice)}</span>
            </div>
            <div class="flex justify-between py-2 text-sm border-b border-dashed border-gray-200">
              <span class="text-gray-500 pl-3">소계</span>
              <span class="text-gray-700">${UI.formatCurrency(data.subtotal)}</span>
            </div>
            <div class="flex justify-between py-2 text-sm">
              <span class="text-gray-500 pl-3">시공비</span>
              <span class="text-gray-700">${UI.formatCurrency(data.totalInstall)}</span>
            </div>
          </div>

          <!-- 총액 -->
          <div class="flex justify-between pt-3 mt-2 border-t-2 border-[#1e3a5f]">
            <span class="text-base font-extrabold text-[#1e3a5f]">총 견적액</span>
            <span class="text-xl font-extrabold text-[#f97316]">${UI.formatCurrency(data.total)}</span>
          </div>

          <!-- 부가세 안내 -->
          <p class="text-xs text-gray-400 mt-2 text-right">* 부가세 별도</p>
        </div>

        <!-- 푸터 -->
        <div class="bg-gray-50 px-5 py-3 text-center text-xs text-gray-400 border-t border-gray-100">
          ${brand.companyName || '용인 랙'} | ${brand.phone || ''} ${brand.bizNo ? `| 사업자 ${brand.bizNo}` : ''}
        </div>
      </div>
    `;
  }

  // 공유 (Web Share API → 스마트폰 기본 공유 시트에서 카카오톡 선택)
  async function share(data) {
    const brand = getBranding();
    const title = `[${brand.companyName || '용인 랙'}] 견적서`;
    const text = `${data.rackType} ${data.quantity}대 — ${UI.formatCurrency(data.total)} (부가세 별도)`;
    const url = data.viewUrl || window.location.href;

    // Web Share API 지원 시 (모바일)
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        UI.toast('공유 완료', 'success');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // 사용자가 취소
      }
    }

    // 미지원 시 (데스크톱) → 클립보드 복사
    const shareText = `${title}\n${text}\n\n견적서 확인: ${url}`;
    try {
      await navigator.clipboard.writeText(shareText);
      UI.toast('견적 정보가 복사되었습니다. 카카오톡에 붙여넣기 하세요.', 'success', 4000);
    } catch {
      // clipboard API도 실패 시 textarea fallback
      const ta = document.createElement('textarea');
      ta.value = shareText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      UI.toast('견적 정보가 복사되었습니다. 카카오톡에 붙여넣기 하세요.', 'success', 4000);
    }
  }

  // 이미지 다운로드 (html2canvas)
  async function downloadImage() {
    const card = document.getElementById('estimate-card');
    if (!card) return;

    try {
      if (typeof html2canvas === 'undefined') {
        UI.toast('이미지 생성 기능을 로드 중입니다', 'info');
        return;
      }
      const canvas = await html2canvas(card, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
      });
      const link = document.createElement('a');
      link.download = `견적서_${new Date().toISOString().slice(0,10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      UI.toast('이미지가 저장되었습니다', 'success');
    } catch (err) {
      UI.toast('이미지 생성 실패. 스크린샷을 사용하세요.', 'error');
    }
  }

  return { renderPreview, share, downloadImage, getBranding };
})();
