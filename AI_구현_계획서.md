# 용인 랙 AI 기능 구현 계획

> 작성일: 2026-03-27
> AI 엔진: Google Gemini API (Google AI Studio)

---

## 1. Gemini 모델 선정

### 기능별 모델 매핑

| 기능 | 모델 | 모델 ID | 선정 이유 |
|------|------|---------|-----------|
| #1 고객 자동완성 | AI 불필요 | — | 기존 데이터 조회만으로 충분 |
| #2 품목 추천 | AI 불필요 | — | 빈도 분석 + 규칙 기반 |
| #3 후속 관리 알림 | AI 불필요 | — | 날짜 계산 + 규칙 기반 |
| #4 견적 요청 AI 분석 | **Gemini 3 Flash** | `gemini-3-flash-preview` | Pro급 추론 + Flash급 속도/가격. 구조화 JSON 출력 지원 |
| #5 사진 + 치수 → AI 견적 | **Gemini 3 Flash** | `gemini-3-flash-preview` | Vision 입력 + 구조화 출력 + Thinking 레벨 조절 가능 |

### 왜 Gemini 3 Flash인가

| 항목 | **Gemini 3 Flash** | Gemini 2.5 Flash | Gemini 2.5 Flash-Lite |
|------|---------------------|------------------|----------------------|
| 모델 ID | `gemini-3-flash-preview` | `gemini-2.5-flash` | `gemini-2.5-flash-lite` |
| 입력 토큰 가격 | **$0.50/1M** | $0.30/1M | $0.10/1M |
| 출력 토큰 가격 | **$3.00/1M** | $2.50/1M | $0.40/1M |
| Vision(이미지) | ✅ | ✅ | ✅ |
| 구조화 JSON 출력 | ✅ | ✅ | ✅ |
| Function Calling | ✅ | ✅ | ✅ |
| **무료 티어** | ✅ | ✅ | ✅ |
| 컨텍스트 윈도우 | **1M 토큰** | 1M 토큰 | 1M 토큰 |
| 추론 능력 | **Pro급** (2.5 대비 대폭 향상) | 충분 | 기본 |
| Thinking 레벨 | ✅ (minimal/low/medium/high) | ❌ | ❌ |
| 출시일 | 2025-12-17 | 2025-05 | 2025-06 |

**선정 근거:**
- 2.5 Flash 대비 추론/멀티모달 품질 **대폭 향상** → 견적 분석 정확도 향상
- 가격 차이 미미 (입력 $0.50 vs $0.30) — 일 10건 수준에서 월 차이 ₩300 이내
- **Thinking 레벨** 지원 → `minimal`로 빠르고 저렴, 복잡한 사진 분석은 `medium`
- 구조화 출력 + Google Search Grounding 동시 사용 가능 ([공식 문서](https://ai.google.dev/gemini-api/docs/gemini-3))
- ⚠️ Gemini 2.0 Flash는 2026-06-01 폐기 예정

### 비용 추정

| 시나리오 | 토큰/건 | 일 건수 | 월 비용 (유료) | 무료 티어 |
|----------|---------|---------|---------------|----------|
| 견적 요청 분석 (#4) | ~1,500 | 5 | **~₩500** | ✅ 무료 |
| 사진 분석 (#5) | ~2,500 | 3 | **~₩700** | ✅ 무료 |
| **합계** | | | **~₩1,200/월** | **₩0** |

> 참고: [Gemini API 가격표](https://ai.google.dev/gemini-api/docs/pricing), [Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)

---

## 2. Gemini API 개발 방법 상세

### 2.1 API 키 발급

1. [Google AI Studio](https://aistudio.google.com/) 접속
2. "Get API key" → "Create API key" 클릭
3. 신용카드 없이 무료 발급 가능
4. 발급된 키를 앱의 설정 페이지(settings.html)에서 저장

> 참고: [Gemini API Quickstart](https://ai.google.dev/gemini-api/docs/quickstart)

### 2.2 REST API 호출 구조 (GAS UrlFetchApp용)

**엔드포인트:**
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key={API_KEY}
```

**텍스트 분석 요청 (Feature #4):**
```javascript
var payload = {
  contents: [{
    parts: [{ text: "프롬프트 텍스트" }]
  }],
  generationConfig: {
    responseMimeType: "application/json",
    responseJsonSchema: {
      type: "object",
      properties: {
        analysis: { type: "string" },
        recommendedType: { type: "string" },
        recommendedQty: { type: "integer" }
      },
      required: ["analysis", "recommendedType"]
    },
    temperature: 0.3,
    maxOutputTokens: 1024
  }
};
```

**이미지 + 텍스트 분석 요청 (Feature #5):**
```javascript
var payload = {
  contents: [{
    parts: [
      {
        inlineData: {
          mimeType: "image/jpeg",      // 지원: jpeg, png, webp, heic, heif
          data: "base64인코딩된이미지"    // 전체 요청 20MB 이내
        }
      },
      { text: "이 사진의 공간을 분석하세요..." }
    ]
  }],
  generationConfig: {
    responseMimeType: "application/json",
    responseJsonSchema: { /* 스키마 */ },
    temperature: 0.3,
    maxOutputTokens: 1024
  }
};
```

> 참고: [Structured Output 공식 문서](https://ai.google.dev/gemini-api/docs/structured-output), [Image Understanding 공식 문서](https://ai.google.dev/gemini-api/docs/image-understanding)

### 2.3 GAS에서 UrlFetchApp 호출 패턴

```javascript
function _callGemini(prompt, options) {
  var apiKey = _getGeminiApiKey();
  if (!apiKey) return { error: 'Gemini API 키가 설정되지 않았습니다' };

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=' + apiKey;

  var parts = [];
  // Vision: 이미지가 있으면 먼저 추가
  if (options && options.imageBase64) {
    parts.push({
      inlineData: {
        mimeType: options.imageMimeType || 'image/jpeg',
        data: options.imageBase64
      }
    });
  }
  parts.push({ text: prompt });

  var body = {
    contents: [{ parts: parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
      maxOutputTokens: 1024
    }
  };

  // 스키마가 있으면 추가 (구조화 출력 보장)
  if (options && options.schema) {
    body.generationConfig.responseJsonSchema = options.schema;
  }

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var json = JSON.parse(response.getContentText());
  if (json.error) return { error: json.error.message };

  var text = json.candidates[0].content.parts[0].text;
  try { return JSON.parse(text); }
  catch(e) { return { rawText: text }; }
}
```

> 참고: [GAS + Gemini 튜토리얼 (Google Codelabs)](https://codelabs.developers.google.com/codelabs/gemini-workspace), [GAS UrlFetchApp 공식 문서](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app), [GAS + Gemini 예제 (GitHub Gist by tanaikech)](https://gist.github.com/tanaikech/28061e3d5404b4fba23368bbae4611d2)

### 2.4 기술적 제약 및 대응

| 제약 | 값 | 대응 |
|------|---|------|
| GAS 실행 시간 제한 | 6분 | Gemini 2.5 Flash 응답 2~5초 → 충분 |
| UrlFetchApp 타임아웃 | 60초 | Flash 모델 평균 응답 3초 → 문제 없음 |
| UrlFetchApp 일 호출 수 | 20,000 (Gmail) / 100,000 (Workspace) | 일 수십 건 → 충분 |
| 인라인 이미지 최대 크기 | 전체 요청 20MB | 프론트에서 1024px 리사이즈 + JPEG 80% 압축 |
| 이미지 토큰 비용 | 258 토큰/이미지 (≤384px), 타일당 258토큰 | 1024px 이미지 ≈ 4타일 ≈ 1,032토큰 |
| 무료 티어 제한 | 250 RPD, 10 RPM | 일 10건이면 충분, 초과 시 유료 전환 (매우 저렴) |
| CacheService 100KB | AI 응답 캐싱 부적합 | Sheets에 분석 결과 저장 또는 프론트 sessionStorage |

> 참고: [GAS Quotas 공식 문서](https://developers.google.com/apps-script/guides/services/quotas)

---

## 3. 기능별 구현 상세

### Phase 0: Gemini API 인프라

**Code.gs 변경:**
1. `_getGeminiApiKey()` — 설정 시트에서 `geminiApiKey` 조회
2. `_callGemini(prompt, options)` — 위 2.3절의 헬퍼 함수

**settings.html 변경:**
- Gemini API 키 입력 필드 추가 (기존 onesignal 키 섹션 아래)

**js/api.js 변경:**
- `analyzeRequest(data)`, `analyzePhoto(data)` POST 메서드 추가

---

### Feature 1: 고객 자동완성 + 원클릭 재견적

**파일:** `Code.gs`, `index.html`

**Code.gs — getEstimates() 확장** (line 610-622)
- 응답에 `bizNumber`, `bizType`, `bizItem` 추가 (시트 col 12-14)

**index.html — loadCustomerSuggestions() 강화** (line 447-472)
- 고객명 매칭 시 7개 필드 전체 자동 채움
- 최신 견적 기준 매칭 (filter + sort by date)
- "이전 견적 불러오기 (N건)" 버튼 + 이전 견적 목록 표시
- 선택 시 해당 견적 품목을 현재 items에 로드

---

### Feature 2: 스마트 품목 추천

**파일:** `js/app.js`, `index.html`

**빈도 기반 TOP 3:**
- `yr_item_freq` localStorage — 아이템 사용 빈도 추적
- `addItemFrequency(item)` — addItem() 시 호출
- `getTopItems(3)` — 빈도순 상위 3개
- "최근 사용" → "자주 사용하는 품목"으로 변경 (app.js line 150-168)

**이 고객 패턴** (Feature 1 의존):
- 고객 매칭 시 과거 견적 품목 추출 → 중복 제거 → 섹션 표시

**함께 선택됨 (연관 추천):**
- 견적 이력 품목 동시 출현 분석
- 랙 추가 후 "설치비 추가하시겠습니까?" 제안 바

---

### Feature 3: 후속 관리 알림

**파일:** `Code.gs`, `dashboard.html`

**Code.gs — 상태변경일 추적:**
- 견적내역 시트 16번째 컬럼 `상태변경일` 추가
- `saveEstimate()` — 생성일 기록
- `updateStatus()` — 변경 시 현재 시간 갱신
- `getEstimates()`, `getDashboard()` — `statusChangedAt` 필드 추가

**dashboard.html — 후속 알림 UI:**
- 색상 배지: 🔴 7일+ / 🟡 3~6일 / 🟢 0~2일
- "후속 필요" 필터 탭 추가

---

### Feature 4: 견적 요청 AI 분석 (Gemini 3 Flash)

**파일:** `Code.gs`, `requests.html`, `js/api.js`

**Code.gs — analyzeRequest(body):**
- 고객 메모 + 랙종류 + 수량 → Gemini에 전달
- 단가표를 프롬프트 컨텍스트에 포함
- `responseJsonSchema`로 구조화 응답 강제:
  ```json
  {
    "type": "object",
    "properties": {
      "analysis": { "type": "string" },
      "recommendedType": { "type": "string" },
      "recommendedForm": { "type": "string" },
      "recommendedSpec": { "type": "string" },
      "recommendedQty": { "type": "integer" },
      "estimatedPriceRange": { "type": "string" },
      "reasoning": { "type": "string" },
      "confidence": { "type": "string", "enum": ["high", "medium", "low"] }
    },
    "required": ["analysis", "recommendedType", "recommendedQty", "confidence"]
  }
  ```
- doPost에 `analyzeRequest` 액션 추가 (**LockService 밖**, uploadPhoto 옆)

**requests.html — AI 분석 UI:**
- 메모 있는 요청에 "AI 분석" 버튼
- 로딩 → 분석 카드 (추천 랙/규격/수량 + 가격 범위 + 신뢰도)
- "원클릭 견적 생성" → index.html로 AI 추천값 URL 파라미터 전달

**index.html — AI 프리필:**
- `prefillFromUrl()`에 `from=ai-analysis` 분기 추가
- AI 추천 랙종류/형태/규격/수량 자동 선택

---

### Feature 5: 사진 + 평면 사이즈 → AI 견적 (Gemini 3 Flash Vision)

**파일:** `Code.gs`, `index.html`, `js/api.js`

**Code.gs — analyzePhoto(body):**
- 사진 base64 + 가로/세로/높이(m) → Gemini Vision 호출
- `_callGemini()` 헬퍼의 `imageBase64` 옵션 사용
- `responseJsonSchema`로 구조화 응답:
  ```json
  {
    "type": "object",
    "properties": {
      "photoAnalysis": {
        "type": "object",
        "properties": {
          "floorType": { "type": "string" },
          "existingRacks": { "type": "string" },
          "obstacles": { "type": "string" },
          "environment": { "type": "string" }
        }
      },
      "recommendation": {
        "type": "object",
        "properties": {
          "rackType": { "type": "string" },
          "layout": { "type": "string" },
          "estimatedQty": { "type": "integer" },
          "reasoning": { "type": "string" }
        }
      },
      "warnings": { "type": "array", "items": { "type": "string" } }
    }
  }
  ```
- doPost에 `analyzePhoto` 액션 추가 (LockService 밖)

**index.html — AI 공간 분석 섹션:**
- 접이식 UI: "📷 AI 공간 분석 (사진 + 치수)"
- 입력: 가로(m) × 세로(m) × 높이(m) + 현장 사진
- `capture="environment"` — 모바일 카메라 바로 실행
- 프론트에서 1024px 리사이즈 + JPEG 80% → base64 (20MB 이내 보장)
- 분석 결과: 공간 분석 + 추천 + 주의사항 카드
- "추천 품목으로 견적 작성" 버튼 → 랙 셀렉터에 자동 선택

---

## 4. 구현 순서

```
Phase 0: Gemini 인프라           ← Code.gs + settings.html + api.js
    ↓
Phase 1 (병렬):
  Feature 1: 고객 자동완성        ← index.html + Code.gs
  Feature 3: 후속 관리 알림       ← dashboard.html + Code.gs
    ↓
Phase 2:
  Feature 2: 품목 추천            ← js/app.js + index.html
    ↓
Phase 3:
  Feature 4: 요청 AI 분석         ← requests.html + Code.gs
    ↓
Phase 4:
  Feature 5: 사진 AI 견적         ← index.html + Code.gs
```

---

## 5. 수정 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `Code.gs` | Gemini 헬퍼 (_callGemini, _getGeminiApiKey), analyzeRequest, analyzePhoto, getEstimates 확장, 상태변경일 추가 |
| `index.html` | 고객 자동완성 강화, 이전 견적 불러오기, AI 공간 분석 섹션, AI 프리필 |
| `js/app.js` | 빈도 추적, TOP3 추천, 고객 패턴, 연관 추천 |
| `js/api.js` | analyzeRequest, analyzePhoto API 메서드 추가 |
| `dashboard.html` | 후속 알림 배지, "후속 필요" 필터 탭 |
| `requests.html` | AI 분석 버튼/결과 UI, 원클릭 견적 생성 |
| `settings.html` | Gemini API 키 입력 필드 |
| `appsscript.json` | 변경 없음 (script.external_request 이미 존재) |

---

## 6. 검증 방법

1. **Gemini 인프라**: settings.html에서 API 키 저장 → Code.gs에서 `_callGemini("안녕하세요")` 테스트
2. **Feature 1**: 기존 고객명 입력 → 7개 필드 자동 채움 + 이전 견적 목록 표시
3. **Feature 2**: 아이템 여러 번 추가 → "자주 사용하는 품목"에 빈도순 반영
4. **Feature 3**: 대시보드에서 오래된 견적에 색상 배지 + "후속 필요" 필터
5. **Feature 4**: 요청 목록 → AI 분석 → Gemini 응답 카드 → 원클릭 견적 생성
6. **Feature 5**: 사진 + 치수 입력 → AI 분석 → 추천 품목 자동 선택
7. **배포**: `clasp push` → 새 웹앱 버전 배포 → 프로덕션 URL 테스트

---

## 7. 참고 자료 (공식 문서 및 개발 가이드)

### Gemini API 공식 문서
- [Gemini 모델 목록 및 사양](https://ai.google.dev/gemini-api/docs/models)
- [**Gemini 3 Developer Guide**](https://ai.google.dev/gemini-api/docs/gemini-3) ← 사용 모델 가이드
- [Gemini API 가격표](https://ai.google.dev/gemini-api/docs/pricing)
- [Rate Limits (무료/유료 티어)](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Quickstart (API 키 발급 + 첫 호출)](https://ai.google.dev/gemini-api/docs/quickstart)
- [구조화 출력 (Structured Output)](https://ai.google.dev/gemini-api/docs/structured-output)
- [이미지 분석 (Image Understanding)](https://ai.google.dev/gemini-api/docs/image-understanding)
- [텍스트 생성 (Text Generation)](https://ai.google.dev/gemini-api/docs/text-generation)
- [generateContent API 레퍼런스](https://ai.google.dev/api/generate-content)
- [Gemini 3 Flash 상세 (OpenRouter)](https://openrouter.ai/google/gemini-3-flash-preview)
- [Gemini 3 Flash 상세 (Vertex AI)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash)

### GAS + Gemini 통합 가이드
- [Google Codelabs: Gemini로 Workspace 자동화](https://codelabs.developers.google.com/codelabs/gemini-workspace)
- [GAS UrlFetchApp 공식 문서](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)
- [GAS Quotas (실행 시간/호출 제한)](https://developers.google.com/apps-script/guides/services/quotas)

### 개발자 커뮤니티 예제
- [GAS + Gemini 카테고리 분류 예제 (tanaikech)](https://gist.github.com/tanaikech/28061e3d5404b4fba23368bbae4611d2)
- [GAS + Gemini Function Calling 가이드 (tanaikech)](https://gist.github.com/tanaikech/061cca4b9af67abe8c4244c03750ea30)
- [GAS + Gemini → Google Docs 생성 (BaseScripts)](https://basescripts.com/how-to-use-google-apps-script-to-call-the-gemini-api-and-create-a-google-doc-with-ai-generated-content)
- [Gemini API 구조화 출력 가이드 (DEV.to)](https://dev.to/shrsv/how-to-generate-structured-output-json-yaml-in-gemini-ai-2ok0)
