# 용인 랙 스마트 견적 시스템 — 변경 이력

## 2026-03-26 세션 작업 내역

### 1. UI/UX 개선
- 추가 항목 버튼/D/C 할인 입력 영역 모바일 overflow 수정 (`min-w-0`, `shrink-0`)
- 견적서/거래명세표 셀 내 텍스트 수직 중앙 정렬 (`vertical-align:middle`)
- 업태/종목 단어 단위 줄바꿈 (`word-break:keep-all`)
- 토스트 메시지 우측 상단 표시 (`max-width: 320px`, 모바일 대응)
- 모든 페이지 헤더 플로팅 (`sticky top-0 z-40`)
- 견적 수정/요청→견적 진입 시 즉시 로딩 오버레이

### 2. 마진단가 적용 시스템
- 간편 견적서에 마진단가 옵션 적용
- 공유 URL에 `hideMargin` 파라미터 연동
- `view.html`에서 토큰 기반 마진 옵션 반영

### 3. 공유 URL 토큰 보안 강화
- 순차 estimateId 대신 32자 UUID 토큰 기반 공유 URL
- `Code.gs`: 공유토큰 시트 + `createShareToken`/`getEstimateByToken` 함수
- `hideMargin`, `docType` 옵션을 토큰에 내장

### 4. 고객 사업자 정보 통합
- 견적 요청 폼에 회사명, 현장주소, 사업자등록번호, 업태, 종목 필드 추가
- 새 견적 작성에 동일 필드 추가 + URL 파라미터 프리필
- 거래명세표 공급받는자 영역에 사업자 정보 표시
- `Code.gs`: 견적요청/견적내역 시트 컬럼 확장

### 5. 요청→견적 연동 워크플로우
- 견적 요청 목록에 **전화걸기** 버튼 + **견적 작성** 버튼 추가
- 전화 클릭 시 자동 '연락완료' 상태 전환
- 견적 작성 시 고객 정보 자동 프리필 (URL 파라미터)
- 공유 완료 시 자동 '견적발송' 상태 전환
- 견적 저장 시 요청에 `estimateId` 자동 연결
- 연결된 요청: "견적서 확인" 버튼 / 미연결: "견적 작성" 버튼 조건부 표시
- 상태 태그 시스템 (연락완료/견적발송 동시 활성 가능)

### 6. 대시보드 기능 강화
- 견적 **수정** 버튼 추가 (기존 데이터 로드 → 덮어쓰기 저장)
- 견적 **삭제** 버튼 추가 (확인 팝업 + 로딩 + 연결된 요청/토큰 자동 정리)
- `Code.gs`: `updateEstimate`, `deleteEstimate` 함수 추가

### 7. 요청 알림 배지 시스템
- 탭바 "요청" 탭에 미확인 요청 수 빨간 배지 표시
- 데이터 기반 모델: `markRequestsSeen(total)` + 차이 계산
- 요청 목록 자동 폴링 (60초 간격, visibility 대응)
- 에러 시 기존 데이터 유지 (GAS 간헐적 연결 끊김 대응)

### 8. 푸시 알림 전환 (ntfy.sh → OneSignal)
- OneSignal Web Push SDK v16 통합 (Custom Code 모드)
- `OneSignalSDKWorker.js` 서비스워커 파일 생성
- `sw.js`에 OneSignal importScripts 통합
- `admin-push.html` 관리자 기기 등록 페이지 생성
- `Code.gs`: OneSignal REST API로 서버 직접 발송
- REST API Key는 구글 시트 설정 탭에만 저장 (GitHub 노출 방지)
- ntfy.sh 관련 코드 전체 제거
- 더보기 메뉴에 푸시 알림 설정 링크 추가

### 9. 코드 최적화 (최종)
#### js/api.js
- 요청 타임아웃 (GET 10초, POST 20초) AbortController
- GET 요청 중복 제거 (동일 요청 공유)
- silent 옵션으로 백그라운드 요청 조용한 실패

#### js/ui.js
- confirm() 모달 중복 방지
- 토스트 애니메이션 상수 추출
- 배지 조회 에러 바운더리 강화

#### js/app.js
- 단가 캐시 TTL 5분 (불필요한 API 호출 방지)
- localStorage 안전 래퍼 (`_lsGet`, `_lsSet`, `_lsRemove`)
- `setActivePreset()` 함수 추출
- `crypto.getRandomValues` 기반 clientId 생성

#### js/estimate.js
- `getBranding()` 60초 캐시
- `downloadImage()` html2canvas 1회 재시도
- `share()` URL 빌더 함수 추출

#### Code.gs
- `findEstimateRow()` 헬퍼 추출 (중복 검색 제거)
- `saveSettings()` 배치 쓰기 최적화
- 디버그 코드/ntfy 잔여 코드 제거
- 대규모 데이터셋 최적화 주석 추가

#### HTML/SW
- OneSignal 초기화 코드 `js/onesignal-init.js`로 공통화 (9개 파일 중복 제거)
- sw.js 캐시 자산 목록 업데이트 + activate 로깅
