/**
 * blog-draft.js — 네이버 블로그 시공 후기 초안 생성기
 * 같은 입력에는 항상 같은 결과를 반환한다.
 */
const BlogDraft = (() => {
  const DEFAULT_BRANDING = { company: '중용랙', phone: '010-3776-1230' };

  const RACK_ADVANTAGES = {
    '경량랙': [
      ['💡', '80~100kg 하중을 든든하게', '선반 한 단에 약 80~100kg까지 적재할 수 있어 매장 상품과 사무용품을 안정적으로 정리할 수 있습니다.'],
      ['🛠️', '볼트 없이 빠른 조립', '볼트리스 구조라 조립이 빠르고 현장 상황에 맞춰 선반을 추가하거나 구성을 바꾸기 편합니다.'],
      ['📏', '필요에 맞춘 높이 조절', '보관할 물건의 크기에 따라 선반 높이를 촘촘하게 조절해 남는 공간을 줄였습니다.'],
      ['💰', '실용적인 비용과 높은 활용도', '합리적인 비용으로 깔끔한 수납 공간을 만들 수 있어 매장과 소형 창고에 가성비가 좋습니다.'],
    ],
    '중량랙': [
      ['💪', '200~300kg 고하중 적재', '선반 한 단에 약 200~300kg을 견디도록 구성해 무거운 자재와 박스도 든든하게 보관합니다.'],
      ['🧱', '고강도 강판으로 탄탄하게', '두꺼운 고강도 강판과 견고한 프레임을 사용해 반복적인 상하차에도 안정적인 구조를 유지합니다.'],
      ['📦', '창고형 보관에 최적화', '부피가 큰 재고와 다품종 박스를 구역별로 나눠 창고의 적재 효율을 높일 수 있습니다.'],
      ['🛡️', '흔들림을 줄인 안정성', '현장 바닥과 적재 조건을 확인해 수평과 간격을 맞추므로 무거운 물품도 안심하고 정리할 수 있습니다.'],
    ],
    '파렛트랙': [
      ['🏗️', '톤 단위 하중을 받는 구조', '파렛트 단위의 무거운 화물을 보관하도록 설계해 대형 물류와 산업 현장에 적합합니다.'],
      ['🚜', '지게차 작업이 편한 동선', '지게차가 안전하게 진입하고 상하차할 수 있도록 베이 간격과 통로 폭을 현장에 맞췄습니다.'],
      ['📐', '높은 층고까지 알차게 활용', '바닥에 쌓던 화물을 수직으로 배치해 창고의 층고와 전체 적재 면적을 효율적으로 사용합니다.'],
      ['🔩', '앙카 고정으로 안전하게', '기둥을 바닥에 앙카로 단단히 고정하고 수평을 맞춰 대형 하중에도 흔들림을 줄였습니다.'],
    ],
    '하이퍼 진열대': [
      ['↔️', '양면 진열로 공간 활용', '중앙 진열대는 양쪽 면을 모두 활용할 수 있어 같은 면적에서도 더 많은 상품을 보기 좋게 배치합니다.'],
      ['🧩', '후면판으로 깔끔한 구성', '후면판이 상품 뒤를 정돈해 진열이 흐트러져 보이지 않고 매장 분위기도 한층 단정해집니다.'],
      ['🏷️', '라벨홀더로 가격 안내', '라벨홀더를 함께 구성하면 상품명과 가격을 일정하게 표시해 고객이 정보를 빠르게 확인할 수 있습니다.'],
      ['🚶', '매장 동선을 고려한 배치', '입구와 계산대, 고객 이동 방향을 살펴 진열대를 배치해 쇼핑 흐름과 상품 접근성을 높였습니다.'],
    ],
    '곤도라 진열대': [
      ['🧱', '벽면·중앙·앤드 조합', '벽면형과 중앙형, 앤드 진열대를 매장 구조에 맞게 조합해 빈 공간 없이 진열 면을 확보합니다.'],
      ['🧰', '다양한 부속품 활용', '선반과 후크, 바구니 등 상품에 맞는 부속품을 골라 크기와 형태가 다른 제품도 유연하게 진열합니다.'],
      ['👀', '상품 노출을 높이는 구성', '고객 눈높이와 주력 상품 위치를 고려해 진열 단수를 정리하므로 상품이 더 또렷하게 보입니다.'],
      ['🔄', '변경하기 쉬운 모듈 구조', '계절 상품이나 매장 운영 변화에 따라 선반 위치와 부속 구성을 손쉽게 바꿀 수 있습니다.'],
    ],
    '무볼트앵글': [
      ['🛠️', '공구 없이 간편한 조립', '볼트와 너트를 일일이 조이지 않는 끼움 방식이라 설치가 빠르고 분해와 재조립도 편합니다.'],
      ['📐', '현장 맞춤 규격 구성', '폭과 깊이, 높이, 선반 단수를 보관 물품과 설치 공간에 맞춰 자유롭게 구성할 수 있습니다.'],
      ['🚚', '이동과 재배치가 편리', '구조가 단순해 공간을 바꾸거나 확장할 때 분해해서 옮기고 다시 설치하기 좋습니다.'],
      ['📦', '작은 공간까지 알찬 수납', '베란다와 사무실, 소형 창고처럼 자투리 공간에도 맞춤 선반을 만들어 수납 효율을 높입니다.'],
    ],
    '아연랙': [
      ['🛡️', '아연 도금으로 뛰어난 방청', '표면의 아연 도금층이 녹과 부식을 줄여 장기간 깔끔하게 사용할 수 있습니다.'],
      ['💧', '습기에 강한 선반', '물기와 습기가 잦은 창고나 작업 공간에서도 일반 철제 선반보다 관리가 편합니다.'],
      ['💪', '튼튼한 적재 성능', '견고한 프레임과 선반으로 박스, 공구, 각종 자재를 안정적으로 보관할 수 있습니다.'],
      ['🧹', '관리하기 쉬운 실용성', '오염을 닦아내기 쉽고 다양한 현장에 적용할 수 있어 유지 관리 부담을 줄여줍니다.'],
    ],
  };

  const SITE_INTROS = {
    '매장': '{지역}에 자리한 {매장명} 매장의 진열과 수납 동선을 정리했습니다. 손님을 맞이할 공간을 차근차근 준비하며 가장 먼저 진행된 작업이 바로 {랙종류} 설치였습니다.',
    '약국': '{지역} {매장명} 약국의 많은 의약품과 생활용품을 한눈에 정리할 수 있도록 진열 공간을 구성했습니다. 효율적인 운영을 위해 가장 먼저 진행된 작업이 바로 {랙종류} 설치였습니다.',
    '문구점': '{지역} {매장명} 문구점의 크고 작은 상품을 종류별로 깔끔하게 보여줄 수 있도록 공간을 정리했습니다. 매장 준비에서 가장 먼저 진행된 작업이 바로 {랙종류} 설치였습니다.',
    '뷰티매장': '{지역}에 새롭게 준비한 {매장명} 뷰티매장이 제품을 더 돋보이게 보여줄 수 있도록 진열 동선을 잡았습니다. 오픈 준비 중 가장 먼저 진행된 작업이 바로 {랙종류} 설치였습니다.',
    '창고·물류': '{지역} {매장명} 현장의 입출고와 재고 관리를 더 빠르게 만들기 위해 적재 공간을 다시 설계했습니다. 물류 효율을 높이기 위해 가장 먼저 진행된 작업이 바로 {랙종류} 설치였습니다.',
    '공장': '{지역} {매장명} 공장의 자재와 공구를 안전하게 구분 보관할 수 있도록 작업 공간을 정돈했습니다. 안정적인 생산 환경을 위해 가장 먼저 진행된 작업이 바로 {랙종류} 설치였습니다.',
    '사무실': '{지역} {매장명} 사무실의 서류와 비품을 찾기 쉽고 깔끔하게 보관할 수 있도록 수납 공간을 마련했습니다. 업무 공간 정리에서 가장 먼저 진행된 작업이 바로 {랙종류} 설치였습니다.',
    '낚시매장': '{지역} {매장명} 낚시매장의 다양한 장비와 소품이 고객 눈에 잘 들어오도록 진열 구성을 정리했습니다. 매장 동선을 살리기 위해 가장 먼저 진행된 작업이 바로 {랙종류} 설치였습니다.',
    '기타': '{지역} {매장명} 현장의 쓰임과 보관 물품을 꼼꼼히 확인해 공간에 꼭 맞는 수납 구성을 준비했습니다. 공간 활용을 높이기 위해 가장 먼저 진행된 작업이 바로 {랙종류} 설치였습니다.',
  };

  const SITE_EMOJI = {
    '매장': '🛍️', '약국': '🏥', '문구점': '✏️', '뷰티매장': '💄',
    '창고·물류': '📦', '공장': '🏭', '사무실': '🏢', '낚시매장': '🎣', '기타': '🔧',
  };

  function clean(value, fallback = '') {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text || fallback;
  }

  function formatDate(value) {
    const matched = clean(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (matched) return `${matched[1]}년 ${Number(matched[2])}월${Number(matched[3])}일`;
    return clean(value, '날짜 미정');
  }

  function locationParts(location) {
    const tokens = clean(location, '용인').split(' ').filter(Boolean);
    const stripRegion = token => token.replace(/(특별자치시|특별자치도|특별시|광역시|자치시|자치도)$/, '').replace(/(시|도)$/, '') || token;
    const stripDistrict = token => token.replace(/(구|군|읍|면|동|리)$/, '') || token;
    const region = stripRegion(tokens[0] || '용인');
    const district = tokens.slice(1).find(token => /(구|군|읍|면|동)$/.test(token));
    const neighborhood = tokens.find(token => /(동|읍|면|리)$/.test(token)) || tokens[tokens.length - 1] || region;
    const label = district ? `${region} ${stripDistrict(district)}` : region;
    return { region, neighborhood, label };
  }

  function fillTemplate(template, values) {
    return template.replaceAll('{지역}', values.location).replaceAll('{매장명}', values.storeName).replaceAll('{랙종류}', values.rackType);
  }

  function hashtagToken(value) {
    return clean(value).replace(/[^0-9A-Za-z가-힣]/g, '');
  }

  function buildHashtags(values) {
    const { region, neighborhood } = locationParts(values.location);
    const r = hashtagToken(region);
    const n = hashtagToken(neighborhood);
    const store = hashtagToken(values.storeName);
    const rack = hashtagToken(values.rackType);
    const site = hashtagToken(values.siteType);
    const candidates = [
      r + rack, n + rack, r + store, n + store, r + site,
      rack, rack + '시공', rack + '설치', r + '경량랙', r + '중량랙', r + '앵글',
      r + '핫플', r + '매장인테리어', '매장진열대', '진열랙', '창고랙',
      '조립식앵글', '맞춤랙', r + '인테리어', '공간활용', '매장정리', '선반설치', '진열대시공',
    ];
    const result = [];
    candidates.forEach(value => {
      const token = hashtagToken(value);
      if (token && !result.includes('#' + token)) result.push('#' + token);
    });
    return result.slice(0, 20);
  }

  function normalizeBranding(branding) {
    const source = branding && typeof branding === 'object' ? branding : {};
    return {
      company: clean(source.company || source.name, DEFAULT_BRANDING.company),
      phone: clean(source.phone, DEFAULT_BRANDING.phone),
    };
  }

  function build(input, branding) {
    const source = input && typeof input === 'object' ? input : {};
    const values = {
      storeName: clean(source.storeName || source.name || source.siteName, '시공 현장'),
      location: clean(source.location || source.address, '용인'),
      date: clean(source.date),
      rackType: RACK_ADVANTAGES[source.rackType] ? source.rackType : '경량랙',
      siteType: SITE_INTROS[source.siteType] ? source.siteType : '기타',
      note: clean(source.note),
    };
    const brand = normalizeBranding(branding);
    const { region, label } = locationParts(values.location);
    const intro = fillTemplate(SITE_INTROS[values.siteType], values);
    const noteParagraph = values.note ? `\n\n이번 현장의 핵심 요청은 '${values.note}'였습니다. 현장 여건을 확인해 안전성과 사용 편의성을 함께 챙겼습니다.` : '';
    const advantages = RACK_ADVANTAGES[values.rackType].map((item, index) => `${item[0]} ${index + 1}. ${item[1]}\n${item[2]}`).join('\n\n');
    const inquiry = `📞 문의 안내: ${brand.company}\n설치 장소와 사용 목적을 알려주시면 방문 상담 및 시공 가능 여부를 안내합니다.\n현장 확인 후 견적과 일정을 협의합니다.\n전화 문의: ${brand.phone}\n카카오톡 채널: https://pf.kakao.com/_PbpFn`;
    const body = `✔️ 시공 개요\n시공 날짜: ${formatDate(values.date)}\n시공 장소: ${values.location}\n주요 랙 종류: ${values.rackType}\n\n${intro}${noteParagraph}\n\n${advantages}\n\n${inquiry}`;
    const titles = [
      `[${label}] ${values.storeName} OPEN! ✨ ${values.rackType} 시공 완료 💪`,
      `[시공 사례] ${label} ${values.storeName} ${values.rackType} 설치 완료! ${SITE_EMOJI[values.siteType]}`,
      `${label} ${values.siteType}의 정석, ${values.storeName} & 중용랙 ${values.rackType} 시공 후기 ✨`,
    ];
    return { titles, body, hashtags: buildHashtags(values) };
  }

  return { build, rackTypes: Object.keys(RACK_ADVANTAGES), siteTypes: Object.keys(SITE_INTROS) };
})();
