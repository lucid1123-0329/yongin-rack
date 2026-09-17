# 검색 최적화와 등록 — 2026-09-17

## 상태

코드 로컬 반영. 운영 배포·소유권 인증·색인 신청은 아직 하지 않았다. 사용자는 네이버·구글에 아직 등록하지 않았다고 확인했다. 이 문서는 검색 순위나 색인을 보장하지 않는다.

## 적용 내용

- robots.txt에서 JS/CSS 차단 해제: 검색엔진의 공개 화면 렌더링에 필요한 파일 접근 허용.
- 공개 3개 페이지마다 고유 제목·설명, HTTPS 대표 주소(canonical), OG URL·절대 이미지 URL·한국어 메타 지정. URL 파라미터는 대표 주소에 넣지 않는다.
- 랜딩 H1에 실제 지역·서비스 반영. 방문자에게 보이는 서비스·견적 준비 안내를 정적 HTML로 추가. 숨겨진 키워드나 지역명 반복 페이지를 만들지 않았다.
- JS 실행 여부와 무관하게 본문이 보이도록 reveal 기본 표시 변경. 시공 사례 페이지에도 정적 설명·블로그·공개 내부 링크 추가.
- LocalBusiness·WebSite·WebPage 연결 및 시공 서비스 목록. 기존에 제공된 상호·주소·전화·블로그만 사용. 영업시간·평점·가격·위치 좌표를 추측해서 넣지 않았다.
- OG는 기존 업체 안내 이미지 사용. AI 연출 사진을 실제 사업장 사진으로 구조화하지 않았다.
- 사이트맵에 공개 대표 URL 3개만 유지. 의미 없는 우선순위·변경 빈도 힌트 제거. 실제 변경일과 달라질 수 있는 자동 날짜를 넣지 않았다.
- 관리자 HTML과 고객 견적서 noindex 유지, 사이트맵 제외. robots 차단은 보안 수단이 아니며 기존 서버 인증은 그대로 유지한다. 차단된 URL은 외부 링크만으로 검색될 수 있어, 이미 노출된 URL은 검색 도구 삭제 요청과 별도 점검이 필요하다.
- SEO 자동 회귀 테스트를 배포 준비 검사에 추가했다.

## 운영 주소 읽기 전용 확인

- HTTP 루트와 www HTTPS 루트 모두 최종 https://yongin-rack.com/ 로 이동.
- robots.txt 200 / text/plain, sitemap.xml 200 / application/xml.
- 존재하지 않는 점검 URL은 404 (홈으로 돌리는 soft 404 아님).
- 위 검사는 현재 운영 주소 응답만 확인한 것이며 새 v72 내용 배포 확인은 아니다.

## 배포 후 등록 순서

1. 검토 완료 후 사용자 승인으로 커밋·배포한다. 운영 루트, robots, sitemap, canonical과 모바일 화면을 다시 확인한다.
2. [네이버 서치어드바이저](https://searchadvisor.naver.com/) 로그인 → 웹마스터 도구 → `https://yongin-rack.com` 사이트 추가. HTML 태그 인증 방식을 선택하고 발급된 `naver-site-verification` 메타 태그를 전달한다. 인증 코드는 공개용이며 계정 비밀번호·인증번호·API 키는 전달하지 않는다. 랜딩 head 반영·배포 뒤 소유확인을 누른다.
3. 네이버 요청 → 사이트맵 제출에 `https://yongin-rack.com/sitemap.xml` 제출. 웹 페이지 수집에 루트 URL 요청. robots 수집·검증과 사이트 진단 확인. 메뉴 명칭은 변경될 수 있다.
4. [구글 서치콘솔](https://search.google.com/search-console) 로그인 → 속성 추가. 간편한 방법은 URL 접두어 `https://yongin-rack.com/`와 HTML 태그 인증이며 `google-site-verification` 값을 head에 반영·배포한다. 도메인 속성을 택하면 발급된 DNS TXT 값을 DNS 관리 계정에서 추가해야 한다. 기존 TXT를 덮어쓰지 않는다.
5. 구글 Sitemaps에 `sitemap.xml` 제출. URL 검사 → 실제 URL 테스트 → 색인 생성 요청. 구조화 데이터는 Google 리치 결과 테스트에서도 확인한다.
6. 계정 등록과는 별개로 네이버 스마트플레이스·구글 비즈니스 프로필이 있다면 실제 상호·주소·전화·사이트 링크를 일치시킨다. 임의로 새 업체를 등록하거나 중복 생성하지 않는다.

## 운영 후 확인할 항목

- 검색 도구에서 수집 실패, 색인 제외 이유, 실제 노출 검색어·클릭·CTR 확인. 사이트 등록 즉시 노출되는 것은 아니다.
- 페이지 속도는 실제 배포 후 PageSpeed Insights 및 Search Console 실사용 지표로 확인. 이번 작업에서 Lighthouse 점수·Core Web Vitals 통과를 측정하거나 보장하지 않았다.
- 생성 이미지 11장 원본은 약 27.4MB이며 업종 선택 시 필요한 이미지만 로드한다. 개별 PNG 용량은 모바일 전송 비용이 크므로 별도 WebP/AVIF 파생본 최적화가 남아 있다. 원본과 AI 출처 표시는 보존한다.
- Tailwind Play CDN은 고객 보조 페이지에 남아 있다. 랜딩은 사용하지 않는다. CSS 빌드 전환은 별도 호환성 검증 후 진행한다.
- 검색 성과를 위한 다음 콘텐츠는 소유자가 확인한 실제 시공 기록, 정확한 규격·선택 기준, 현장별 제약과 해결 내용이다. AI 쇼룸 이미지는 시공 실적의 증거로 사용하지 않는다.

## 공식 근거

- [네이버 robots 가이드](https://searchadvisor.naver.com/guide/seo-basic-robots)
- [네이버 사이트 최적화](https://searchadvisor.naver.com/guide/report-seo)
- [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google 대표 URL](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google LocalBusiness](https://developers.google.com/search/docs/appearance/structured-data/local-business)
- [Google 사이트맵](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
