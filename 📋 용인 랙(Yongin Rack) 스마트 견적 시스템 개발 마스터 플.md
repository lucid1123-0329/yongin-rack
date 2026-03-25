📋 용인 랙(Yongin Rack) 스마트 견적 시스템 개발 마스터 플랜1. 프로젝트 개요프로젝트명: 용인 랙 스마트 견적 및 고객 관리 시스템목적: 현장에서 스마트폰을 이용해 즉각적인 랙(Rack) 설치 견적을 산출하고, 고객에게 카카오톡/문자로 프로페셔널하게 공유하며, 모든 내역을 구글 시트에 자동 저장하는 사내용/고객용 하이브리드 웹앱 구축.기술 스택:Frontend: HTML5, CSS3 (Tailwind CSS CDN), Vanilla JavaScriptBackend (API): Google Apps Script (GAS)Database: Google SheetsHosting: GitHub PagesDomain & DNS: Cloudflare (사용자 맞춤형 도메인, HTTPS 기본 적용)Libraries: html2canvas / jsPDF (견적서 다운로드), Kakao SDK (카카오톡 공유)2. 시스템 아키텍처 (System Architecture)[사용자/아버지 (Mobile/PC)] 
        │
        ▼ (HTTPS)
[Cloudflare (DNS/CDN/보안)] ──▶ [GitHub Pages (정적 웹 호스팅: HTML/CSS/JS)]
                                        │
                                        ▼ (AJAX / Fetch API)
                                [Google Apps Script (웹 앱 API)]
                                        │
                                        ▼ (SpreadsheetApp API)
                                [Google Sheets (데이터베이스)]
3. 데이터베이스 설계 (Google Sheets)총 2개의 시트(Sheet)를 운영하여 데이터 무결성과 관리 편의성을 확보합니다.3.1. 시트명: 단가표 (읽기 전용 DB)아버지가 직접 단가를 수정하는 시트. (GAS를 통해 프론트엔드 로드 시 JSON으로 가져옴)A열 (랙 종류)B열 (규격: 가로x세로x높이)C열 (단수)D열 (기본 단가)E열 (추가 시공비)경량랙900x450x18004단85,00010,000중량랙1200x450x21005단120,00015,000설계 포인트: 규격이 다양할 수 있으므로, 웹에서 Select Box(드롭다운)로 선택할 수 있도록 옵션화 데이터를 제공.3.2. 시트명: 견적내역 (쓰기 전용 DB)웹에서 산출된 견적을 저장하는 메인 DB.A열 (견적일시)B열 (고객명/상호)C열 (연락처)D열 (현장주소)E열 (랙 종류/규격)F열 (수량)G열 (총 견적액)H열 (진행상태)2026-03-25 11:30홍길동(우리물류)010-1234-5678용인시 처인구...중량랙/1200x...101,350,000상담완료설계 포인트: 진행상태의 기본값은 '상담완료'로 세팅하고, 추후 아버지가 시트에서 '계약', '시공완료' 등으로 변경하며 고객 관리.4. 백엔드 API 설계 (Google Apps Script)코드.gs 파일에 작성될 핵심 비즈니스 로직입니다. (CORS 문제 해결이 핵심)4.1. doGet(e) - 단가 데이터 호출기능: 웹페이지 로드 시 단가표 시트의 데이터를 JSON 배열 형태로 반환.응답 헤더: 크로스 도메인 요청(CORS)을 허용하기 위해 ContentService.MimeType.JSON 사용 및 JSONP 방식으로 우회하거나, GAS 자체의 허용 특성 이용.4.2. doPost(e) - 견적 데이터 저장기능: 프론트엔드에서 전송한 JSON(고객정보, 견적내용)을 파싱하여 견적내역 시트의 마지막 행(appendRow)에 추가.보안/검증: 필수 값(고객명, 연락처, 총액) 누락 시 에러 반환 로직 추가.성공 응답: {"result": "success", "row": 15} 형태의 JSON 반환.5. 프론트엔드 개발 가이드 (로컬 환경)VS Code 등의 에디터에서 index.html, style.css, app.js로 분리하여 로컬 개발을 진행합니다.5.1. UI/UX 디자인 (Mobile-First)Tailwind CSS 사용: 스마트폰(가로 해상도 360px~430px)에서 버튼과 폼이 꽉 차고 누르기 편하도록 w-full, p-4, text-lg 등의 유틸리티 클래스 적극 활용.입력 폼 최소화: 타자 치기 힘든 모바일 환경을 고려하여, 랙 종류 및 규격은 무조건 드롭다운(Select) 형태나 버튼 탭 형태로 구현.실시간 계산기 (Reactive): 수량(Input)이 변경될 때마다 즉시 하단에 "예상 견적: 000,000원"이 애니메이션과 함께 업데이트.5.2. 핵심 기능 구현 (app.js)로딩 스피너 (Loading Spinner): GAS API 호출 시(단가 불러올 때, 견적 저장할 때) 화면 중앙에 로딩 바를 띄워 중복 클릭(따닥) 방지.견적서 이미지 다운로드: html2canvas 라이브러리를 사용해, 견적서 영역 DOM을 Canvas로 변환 후 .png로 다운로드하게 하여 폰 갤러리에 저장.카카오톡 공유 API (Kakao Link): 카카오 디벨로퍼스 앱 생성 후 JavaScript 키 발급.공유 버튼 클릭 시, 고객에게 [깔끔한 견적 요약 카드 + 상세 보기 링크] 전송.6. SNS 및 SEO 최적화 (Open Graph 태그)아버지가 견적서 링크를 고객에게 카카오톡이나 문자로 보낼 때, 허술한 URL만 가는 것이 아니라 멋진 썸네일과 제목이 뜨도록 <head> 태그 내에 필수 구성합니다.<!-- Primary Meta Tags -->
<title>용인 랙 - 빠르고 정확한 랙 설치 견적</title>
<meta name="title" content="용인 랙 - 전문 시공 및 견적 시스템">
<meta name="description" content="경량랙, 중량랙, 파렛트랙 맞춤형 최저가 견적을 즉시 확인하세요.">

<!-- Open Graph / KakaoTalk / Facebook -->
<meta property="og:type" content="website">
<meta property="og:url" content="[https://아버지도메인.com/](https://아버지도메인.com/)">
<meta property="og:title" content="[용인 랙] 맞춤형 견적서가 도착했습니다.">
<meta property="og:description" content="현장에 딱 맞는 랙 설치 견적을 지금 바로 확인해 보세요.">
<meta property="og:image" content="[https://아버지도메인.com/assets/og-image.jpg](https://아버지도메인.com/assets/og-image.jpg)"> <!-- 1200x630px 권장 -->

<!-- Favicon -->
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon.png">
7. 배포 및 도메인 연결 (GitHub + Cloudflare)로컬에서 완벽하게 동작하는 것을 확인한 후 배포합니다.7.1. GitHub Pages 배포로컬 프로젝트를 GitHub Repository(Public 추천)에 Push.Repository Settings -> Pages -> Source를 main 브랜치로 설정하여 호스팅 활성화.7.2. Cloudflare DNS 설정 (Custom Domain)Cloudflare 대시보드 -> DNS 메뉴.A 레코드 추가: GitHub Pages의 IP 주소(4개) 연결.185.199.108.153 / 185.199.109.153 / 185.199.110.153 / 185.199.111.153CNAME 레코드 추가: www 이름을 아버지의 github.io 주소로 연결.SSL/TLS 설정: '전체(Full)' 또는 '가변(Flexible)'으로 설정하여 자물쇠 아이콘(HTTPS) 활성화.GitHub Pages 설정에서 'Custom domain' 항목에 구매하신 Cloudflare 도메인 입력 후 Save.8. 🚀 개발 진행 마일스톤 (Action Plan)[ ] Step 1: 구글 시트 2개 생성 및 컬럼 세팅 (데이터베이스 준비)[ ] Step 2: Google Apps Script 초기 설정 및 doGet, doPost 임시 배포 (API 엔드포인트 확보)[ ] Step 3: 로컬 HTML/JS/CSS 기본 폼 마크업 및 실시간 단가 계산 로직 구현 (가장 중요)[ ] Step 4: API 연동 테스트 (로컬 폼 -> 구글 시트 데이터 적재 확인)[ ] Step 5: 이미지 캡처(html2canvas), 카카오톡 공유 등 편의 기능 추가[ ] Step 6: OG 이미지 제작(미리캔버스/캔바 활용) 및 메타 태그 삽입[ ] Step 7: GitHub Push 및 Cloudflare 도메인 연동 완료이 계획서를 바탕으로 각 Step별 코드를 작성하며 진행하면, 절대 실패하지 않는 견고한 서비스를 구축할 수 있습니다.