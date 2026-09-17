# 용인 랙 AI 활용 계획서

> 작성일: 2026-03-27
> 기반: 코드베이스 아키텍처 분석 + 웹 리서치 + 원본 제안서 검토

---

## 1. 현재 시스템 평가

### 아키텍처 현황
| 항목 | 상태 |
|------|------|
| 프론트엔드 | HTML/JS + Tailwind (정적 호스팅) |
| 백엔드 | Google Apps Script (doGet/doPost) |
| DB | Google Sheets (단가표 698행, 견적내역, 견적요청, 설정, 포트폴리오) |
| 인증 | PIN 해시 기반 토큰 |
| 캐시 | CacheService (100KB 제한) + localStorage |

### AI 준비도: **6.5 / 10**

**강점**
- 단가표 4개 가격모델(A/B/C/D) 체계적 분류 완료
- 견적 품목을 JSON으로 저장 → 아이템 레벨 분석 가능
- 고객 정보(업종/업태/사업자번호) 수집 체계 존재
- UrlFetchApp으로 외부 API 즉시 호출 가능

**약점**
- 추천/분석 인프라 전무 (순수 CRUD 시스템)
- GAS 실행 제한: **6분 타임아웃, UrlFetchApp 60초 응답 제한**
- Sheets 동시 쓰기: LockService 15초 대기
- 데이터 볼륨이 아직 작음 → 통계 기반 AI의 신뢰도 제한적

---

## 2. 원본 제안서 평가

### 각 항목별 실현 가능성 및 ROI 평가

| # | 기능 | 실현성 | ROI | 평가 |
|---|------|--------|-----|------|
| 1 | 고객 자동완성 | ★★★★★ | ★★★★★ | **즉시 구현 가능.** 견적내역 시트 데이터만으로 충분. AI 불필요. |
| 2 | 스마트 품목 추천 | ★★★★☆ | ★★★★☆ | **실용적.** 최근 항목(yr_recent_items) 이미 5개 저장 중. 빈도 기반 확장 쉬움. |
| 3 | 마진율 가이드 | ★★★☆☆ | ★★★☆☆ | **주의 필요.** 현재 마진은 커스텀 항목(name='마진')으로 저장 — 파싱 가능하나 데이터 양이 적으면 통계 신뢰도 낮음. |
| 4 | 견적 요청 AI 분석 | ★★★★☆ | ★★★★★ | **핵심 기능.** Claude Haiku로 메모 분석 → 랙 추천은 매우 실용적. GAS UrlFetchApp으로 구현 가능. |
| 5 | 견적서 설명문 생성 | ★★★★☆ | ★★★☆☆ | **있으면 좋지만 우선순위 낮음.** 현장 업종 특성상 설명문보다 가격이 결정적. |
| 6 | 스마트 후속 관리 | ★★★★☆ | ★★★★★ | **매우 실용적.** 규칙 기반만으로도 큰 효과. 견적 상태(상담완료/계약 등) + 날짜 기반 알림. |
| 7 | 현장 사진→견적 | ★★☆☆☆ | ★★★★☆ | **과대평가 위험.** 아래 상세 분석 참고. |
| 8 | AI 챗봇 | ★★☆☆☆ | ★★★☆☆ | **ROI 의문.** 1~5인 업체에서 24시간 챗봇의 실질 수요 불확실. 카카오 API 연동 복잡도 높음. |
| 9 | 포트폴리오 태깅 | ★★★☆☆ | ★★☆☆☆ | **후순위.** 포트폴리오 사진 수가 적으면 수동 태깅이 더 빠름. |
| 10 | 수요 예측 | ★★☆☆☆ | ★★☆☆☆ | **시기상조.** 최소 1년치 월별 데이터 필요. 현재 데이터 양으로는 시계열 예측 불가. |

### 핵심 지적 사항

**1) 사진→견적(#7)에 대한 현실적 평가**

원본 제안서에서 "공간 크기 5m×8m 추정, 천장 높이 3m 판단" 등을 언급했지만, 현장 사진만으로 이런 수치를 정확히 추출하는 것은 현재 Vision AI의 한계를 벗어남:
- 단안 카메라로 실제 거리 측정 불가 (LiDAR/스테레오 필요)
- 빈 창고 사진에서 랙 수량 산출은 추정에 불과
- [Handoff AI](https://handoff.ai/), [SimplyWise](https://play.google.com/store/apps/details?id=com.simplywise.costestimator)도 도면/사진 + 사용자 보정 입력을 병행

**현실적 대안:** 사진은 "참고 자료"로만 활용하고, 구조화된 질문(가로×세로, 용도, 바닥 상태)으로 AI가 추천하는 방식이 더 정확.

**2) 챗봇(#8)의 ROI 재검토**

1~5인 소규모 업체에서 카카오 비즈니스 API + Claude API를 연동한 24시간 챗봇은:
- 구현 비용 대비 실제 문의 건수가 적을 가능성
- 카카오 비즈니스 채널 운영비 발생
- 이미 `request.html`로 견적 요청 수집 중

**현실적 대안:** 챗봇 대신 견적 요청 페이지에 AI 가이드 추가 (아래 새 제안 참고)

---

## 3. 웹 리서치 기반 추가 제안

### 리서치에서 발견한 핵심 트렌드

| 트렌드 | 출처 | 적용 가능성 |
|--------|------|-------------|
| AI 견적 도구 78% 효율 향상 인식 | [Oneflow](https://oneflow.com/blog/ai-quoting-software/) | 업계 전반의 AI 견적 채택 가속화 |
| 사진+음성 멀티모달 견적 | [CountBricks](https://www.countbricks.com/) | 음성 입력 즉시 적용 가능 |
| Claude Batch API 50% 할인 | [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing) | 야간 배치 분석으로 비용 절감 |
| Prompt Caching 90% 비용 절감 | [Anthropic Docs](https://platform.claude.com/docs/en/build-with-claude/usage-cost-api) | 단가표 컨텍스트 캐싱 활용 |
| GAS 일 20,000 UrlFetch 호출 제한 | [Google Quotas](https://developers.google.com/apps-script/guides/services/quotas) | 일 수백 건 수준이면 충분 |

### 새로 제안하는 기능 3가지

**A. 음성 입력 견적 (Web Speech API)**

제안서에 언급된 음성 입력을 구체화합니다. 현장에서 장갑 끼고 작업 중에도 사용 가능:

```
작업자: "경량랙 독립 1200 곱하기 600 1800 5단 15대"
    ↓ Web Speech API (브라우저 내장, 무료)
    ↓ Claude Haiku로 구조화
    ↓
{ type: "고급경량랙", form: "독립형", spec: "600*1200", tier: "1800(5단)", qty: 15 }
    ↓ 자동 품목 추가
```

- **구현 난이도:** 중간 (Web Speech API는 Chrome 내장)
- **비용:** Claude Haiku 건당 ~₩5
- **효과:** 현장 입력 시간 80% 단축, 차별화된 UX

**B. AI 견적 요청 가이드 (챗봇 대체)**

카카오 챗봇 대신, 기존 `request.html`에 대화형 가이드를 추가:

```
[request.html 상단]
"어떤 용도로 사용하시나요?"
  → 창고 보관 / 매장 진열 / 냉동·냉장 / 기타

"보관할 물건의 무게는?"
  → 가벼운 편 (박스, 서류) / 보통 (식품, 부품) / 무거운 편 (공구, 철자재)

    ↓ 규칙 기반 매핑 (AI 불필요)
    ↓
"고급경량랙을 추천드립니다. 상세 견적을 요청하시겠습니까?"
  → [견적 요청하기] (rackType 자동 채움)
```

- **구현 난이도:** 낮음 (규칙 기반, AI 불필요)
- **비용:** ₩0
- **효과:** 고객 스스로 적합한 랙을 선택 → 요청 품질 향상 → 견적 전환 속도 증가

**C. 주간 AI 리포트 (이메일/카카오 발송)**

수요 예측(#10)의 현실적 축소 버전:

```
[매주 월요일 자동 발송]
━━━ 용인 랙 주간 리포트 ━━━
■ 이번 주 견적: 12건 (₩18,400,000)
■ 미처리 요청: 3건 ⚠️
■ 후속 필요: 홍길동(7일 경과), 우리물류(5일 경과)
■ 인기 품목: 고급경량랙 독립형 (전주 대비 +20%)
■ 평균 마진: 23.5%
```

- **구현:** GAS 시간 트리거 + UrlFetchApp (이메일 또는 카카오 알림톡)
- **비용:** ₩0 (GAS 내장 MailApp)
- **효과:** 관리자가 능동적으로 파악하지 않아도 핵심 지표 자동 파악

---

## 4. 수정된 구현 로드맵

원본 제안서의 8주 로드맵을 현실성과 ROI 기준으로 재배치합니다.

### Phase 1: 즉시 효과 (Week 1~2) — AI 불필요, 규칙 기반

| 우선순위 | 기능 | 예상 공수 | 핵심 변경 |
|----------|------|-----------|-----------|
| P0 | **고객 자동완성** (#1) | 2일 | getEstimates 데이터로 자동완성 UI |
| P0 | **품목 추천 확장** (#2) | 2일 | yr_recent_items 확장 + 빈도 TOP3 |
| P1 | **후속 관리 알림** (#6 규칙 기반) | 3일 | 대시보드에 "N일 경과" 배지 |
| P1 | **견적 요청 가이드** (B) | 2일 | request.html 대화형 UI |

**Phase 1 완료 시 기대 효과:**
- 재방문 고객 입력 시간: 1.5분 → 15초
- 견적 작성 시간: 3분 → 2분
- 후속 연락 누락률 감소

### Phase 2: Claude API 연동 (Week 3~4)

| 우선순위 | 기능 | 예상 공수 | 핵심 변경 |
|----------|------|-----------|-----------|
| P0 | **Claude API 기반 인프라** | 2일 | Code.gs에 callClaude() 헬퍼 + API키 설정 |
| P0 | **견적 요청 AI 분석** (#4) | 3일 | 메모 → 랙 추천 + 원클릭 견적 초안 |
| P1 | **마진율 가이드** (#3) | 2일 | 견적 이력 통계 + UI 표시 |
| P2 | **견적서 설명문** (#5) | 1일 | estimate-preview에 AI 생성 설명 |

**Claude API 호출 설계:**
```javascript
// Code.gs — Claude API 헬퍼
function callClaude(prompt, maxTokens) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    payload: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens || 500,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  return JSON.parse(response.getContentText());
}
```

**비용 추정:**
| 모델 | 입력 (1K 토큰) | 출력 (1K 토큰) | 건당 예상 비용 |
|------|---------------|---------------|--------------|
| Haiku 4.5 | $0.80/MTok | $4.00/MTok | ~₩5~15 |
| Sonnet 4.6 | $3.00/MTok | $15.00/MTok | ~₩20~50 |

일 10건 기준 → **월 ₩1,500~4,500** (Haiku), **월 ₩6,000~15,000** (Sonnet)

### Phase 3: 고급 기능 (Week 5~6)

| 우선순위 | 기능 | 예상 공수 | 핵심 변경 |
|----------|------|-----------|-----------|
| P1 | **음성 입력 견적** (A) | 4일 | Web Speech API + Claude 파싱 |
| P1 | **주간 AI 리포트** (C) | 2일 | GAS 시간 트리거 + MailApp |
| P2 | **후속 관리 AI 강화** (#6) | 3일 | Claude로 전환 확률 예측 |

### Phase 4: 차별화 (Week 7~8) — 선택적

| 우선순위 | 기능 | 예상 공수 | 핵심 변경 |
|----------|------|-----------|-----------|
| P2 | **사진 참고 견적** (#7 축소) | 5일 | Vision API로 공간 분석 + 구조화 질문 보완 |
| P3 | **포트폴리오 태깅** (#9) | 3일 | 업로드 시 Vision 자동 태그 |
| P3 | **수요 리포트** (#10 축소) | 2일 | 월간 통계 (예측은 데이터 축적 후) |

---

## 5. 기술적 제약 및 대응 방안

| 제약 | 영향 | 대응 |
|------|------|------|
| GAS 6분 실행 제한 | Claude API 호출 포함 시 타임아웃 위험 | 단건 호출은 충분 (응답 2~5초). 배치는 시간 트리거로 분할 |
| UrlFetchApp 60초 타임아웃 | Claude 대용량 프롬프트 시 초과 가능 | Haiku 모델 사용 + 프롬프트 1000토큰 이내 유지 |
| CacheService 100KB 제한 | AI 응답 캐싱 어려움 | Sheets에 AI 결과 컬럼 추가하여 영구 저장 |
| 일 20,000 UrlFetch 호출 | Claude API 호출 + 기타 호출 합산 | 일 수백 건 수준이면 문제 없음 |
| Sheets 동시 쓰기 Lock 15초 | AI 분석 중 다른 사용자 대기 | AI 호출은 Lock 밖에서 처리, 결과만 Lock 안에서 저장 |
| API 키 보안 | 프론트엔드 노출 위험 | ScriptProperties에만 저장, doPost를 통해서만 호출 |

---

## 6. 비용 요약

| 항목 | 월 비용 (추정) |
|------|---------------|
| Claude API (Haiku, 일 10건) | ₩1,500 ~ ₩4,500 |
| Claude API (Sonnet, 사진 분석 등) | ₩6,000 ~ ₩15,000 |
| Google Workspace | 기존 비용 (추가 없음) |
| 카카오 알림톡 (주간 리포트) | ₩0 (이메일 대체 시) |
| **월 총 예상** | **₩1,500 ~ ₩20,000** |

---

## 7. 최종 권장 순서

```
[가장 먼저] ─────────────────────────────────────────── [나중에]

#1 고객 자동완성    ← AI 불필요, 즉시 효과, 현장 체감 최대
#6 후속 관리 알림   ← 규칙 기반, 계약 전환율 직결
#2 품목 추천       ← 기존 데이터 활용, 견적 속도 향상
(B) 견적 요청 가이드 ← 고객 셀프서비스, 요청 품질 향상
    ↓
#4 요청 AI 분석    ← Claude 연동 첫 기능, ROI 최고
(A) 음성 입력      ← 현장 차별화, Web Speech API 무료
(C) 주간 리포트    ← 관리자 인사이트, 자동 발송
    ↓
#3 마진 가이드     ← 데이터 축적 후 신뢰도 향상
#7 사진 참고 견적   ← Vision API, 보조 수단으로만
#5 견적서 설명문   ← 있으면 좋지만 필수 아님
```

**원본 제안서에서 제외를 권장하는 항목:**
- **#8 AI 챗봇:** 비용 대비 효과 불확실 → (B) 견적 요청 가이드로 대체
- **#10 수요 예측:** 데이터 축적 최소 1년 필요 → (C) 주간 리포트로 축소 시작

---

## 8. 웹 리서치 보충 — 실제 서비스 사례 및 수치

### 시장 동향
- 2026년까지 **75%의 기업이 AI 견적 도구 채택 예상** ([Oneflow](https://oneflow.com/blog/ai-quoting-software/))
- AI CRM 도입 기업: 영업 생산성 **21% 향상**, 효율성 **34% 증가** ([Rings.ai](https://www.rings.ai/blog/top-ai-powered-crms))
- 건설업 설문: **78% 효율 향상 인식**, 47%가 이미 견적에 AI 사용 중

### 실제 제품 벤치마크

| 서비스 | 핵심 기능 | 용인 랙 시사점 |
|--------|-----------|---------------|
| [Handoff AI](https://handoff.ai/) | 사진/도면 → AI 견적 (10,000+ 시공업체) | #7 사진 견적의 실제 구현 사례. 다만 미국 시장 특화 (Home Depot/Lowe's 가격 연동) |
| [SimplyWise](https://play.google.com/store/apps/details?id=com.simplywise.costestimator) | 사진+설명 → 비용 견적 | 모바일 앱으로 즉시 견적, 한국어 미지원 |
| [CountBricks](https://www.countbricks.com/) | **음성+AI 견적** (특허 기술) | 음성 입력 견적의 상용 사례. 우리 (A) 음성 입력 제안과 동일 컨셉 |
| [채널톡 ALF](https://channel.io/en) | 한국어 AI 챗봇, 카카오톡 연동 | 단순 문의 **55% 자동 해결**, 무료 플랜 존재. #8 챗봇 대안으로 고려 가능 |
| [ServiceInSync](https://www.serviceinsync.com/) | AI+주소 기반 즉시 견적 | 현장 서비스 특화, 가격 학습 기능 |
| [Kyro AI](https://kyro.ai/) | 건설 현장 **음성 메모 → 구조화** | 현장 작업자 타이핑 대비 **5배 빠름** |

### 채널톡 ALF 상세 (챗봇 대안으로 재고려)

원본 계획서에서 #8 챗봇을 제외 권장했지만, 채널톡 ALF는 재고려 가치가 있음:
- **무료 플랜** 존재 (소규모 사업장에 적합)
- **카카오톡 연동** 기본 지원
- 직접 개발 대비 구현 비용 **0원**, 유지보수 불필요
- 단, 월 문의 건수가 일 5건 이상일 때만 ROI 발생

→ Phase 3 이후 문의량 증가 시 도입 검토 권장

### GAS + Claude API 비용 정밀 계산

웹 리서치로 확인한 실제 토큰 소비량 기반:

| 시나리오 | 토큰/건 | 일 건수 | 월 비용 (Haiku) |
|----------|---------|---------|----------------|
| 견적 요청 분석 (#4) | ~1,000 | 5 | **~₩600** |
| 견적서 설명문 (#5) | ~800 | 5 | **~₩450** |
| 음성 파싱 (A) | ~500 | 10 | **~₩500** |
| 사진 분석 (#7, Sonnet) | ~2,000 | 2 | **~₩3,000** |
| **합계** | | | **~₩4,550/월** |

> 참고: Gemini Flash가 GAS 네이티브 연동을 지원하지만, 구조화된 비즈니스 문서 생성에서는 Claude가 품질 우위 ([DEV.to](https://dev.to/lifeisverygood/leveraging-ai-in-google-sheets-practical-integration-with-apps-script-2jnd))

---

## 9. 참고 자료

- [Oneflow - Best AI Quoting Software 2026](https://oneflow.com/blog/ai-quoting-software/)
- [Handoff AI - Photo-to-Estimate](https://handoff.ai/)
- [SimplyWise - Cost Estimator App](https://play.google.com/store/apps/details?id=com.simplywise.costestimator)
- [CountBricks - Voice+AI Estimation](https://www.countbricks.com/)
- [Claude API GAS Integration Example](https://gist.github.com/estevecastells/08ffa9064b57ab34a622dee16c32b629)
- [GAS UrlFetchApp Guide](https://justin.poehnelt.com/posts/definitive-guide-to-urlfetchapp)
- [Google Apps Script Quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Anthropic API Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [한국 기업 AI 도입 사례 2025](https://blog.dfinite.ai/enterprise-ai-adoption-strategy)
- [채널톡 ALF AI 챗봇](https://channel.io/en)
- [Kyro AI - 현장 음성 메모](https://kyro.ai/blog/ai-in-construction-voice-notes-for-field-crews)
- [Web Speech API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [ServiceInSync - AI 즉시 견적](https://www.serviceinsync.com/)
- [Claude API GAS 통합 가이드 (Skywork)](https://skywork.ai/blog/how-to-claude-haiku-4-5-google-workspace-pipelines-guide/)
- [AI CRM for Small Business (Rings.ai)](https://www.rings.ai/blog/top-ai-powered-crms)
