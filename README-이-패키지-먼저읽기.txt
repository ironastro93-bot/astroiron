========================================
 AstroIron v1.6 — 배포용 통합 패키지 (애드센스 준비 완성본)
 생성일: 2026-07-13 · 표준 ZIP (반디집으로 열림)
========================================
 [v1.6] "토론방" → "커뮤니티"로 명칭 통일 (앱 내비/헤딩 + 개인정보처리방침·이용약관).
 [v1.4] 모의투자 주문내역 고도화 — 필터(전체/체결/예약/취소) +
        주문번호 + 상태 배지(예약·체결완료·취소) + 취소 내역 기록.
 [v1.5] 호가창 정보 보강 — 스프레드 + 매도/매수 총잔량 표시.
        "모의 시뮬레이션·실제 잔량 아님" 표기 강화(오해 방지).


■ 이 zip 하나로 "라이브 사이트 + 블로그 콘텐츠"가 전부 연결됩니다.
  - 블로그(글 15개)와 contact.html 포함
  - index.html footer + sitemap.xml 이 그 페이지들로 연결
  - [v1.2] 홈 "📚 오늘의 학습" 섹션 — 블로그 글 3개 카드 + 전체보기
  - [v1.3 신규] 모의투자 주문창 상단에 실시간 "시장정보 바"
    (S&P500·나스닥·다우·비트코인) — 주문하며 시장 분위기 확인.
    ※ VIX는 무료 데이터 미지원으로 제외.
  → 애드센스 크롤러가 원본 콘텐츠를 확실히 찾을 수 있게 됩니다.

■ 폴더 구성 (저장소 루트에 그대로 업로드)
  AstroIron_v1.1/
  ├─ index.html                 ★ 갱신: footer에 블로그·문의·운영정책 링크 추가
  ├─ sitemap.xml                ★ 갱신: 6개 → 23개 URL(블로그 15 + contact 포함)
  ├─ contact.html               ★ 신규: 문의하기 페이지
  ├─ about.html / faq.html / privacy.html / terms.html / community-policy.html
  ├─ sw.js / firebase-messaging-sw.js / manifest.webmanifest
  ├─ ads.txt / robots.txt / vercel.json / package.json
  ├─ google7b2f13fdceb9da06.html
  ├─ og.png / icon-180.png / icon-192.png / icon-512.png
  ├─ api/
  │   ├─ finance.js   [FINNHUB_API_KEY]
  │   ├─ macro.js     [FRED_API_KEY]
  │   ├─ ai.js        [ANTHROPIC_API_KEY 또는 NVIDIA_API_KEY]
  │   └─ analyze.js
  ├─ blog/                      ★ 신규: 미국 증시 교육 원본 글 15개
  │   ├─ index.html             (블로그 목록)
  │   ├─ (투자 10편) what-is-mock-investing / stock-basics-beginners /
  │   │   stop-loss / diversification / per-pbr / etf-guide /
  │   │   chart-basics / volume / long-vs-short / beginner-mistakes
  │   └─ (개발 5편) nextjs-cls / image-optimization / font-preload /
  │       reduce-tbt / lighthouse-90
  └─ README-배포가이드.md

■ 배포 순서
  1) 압축 해제 → 폴더 내용을 저장소 루트에 업로드 (blog/ 폴더 포함)
  2) Vercel 환경변수 확인: FINNHUB_API_KEY, FRED_API_KEY (필수) /
     ANTHROPIC_API_KEY 또는 NVIDIA_API_KEY (AI, 선택)
  3) git push → Vercel 자동 배포
  4) 배포 후 확인:
     - https://astroiron.com/blog/ 열리는지
     - https://astroiron.com/contact.html 열리는지
     - https://astroiron.com/sitemap.xml 이 23개 URL 보이는지
  5) Google Search Console에 sitemap.xml 제출 → 블로그 글 몇 개 "색인 요청"
  6) 색인이 잡힌 뒤 애드센스 신청

■ 보안
  - API 키는 파일에 없습니다(전부 Vercel 환경변수). 압축에 비밀키 미포함.
  - firebase 설정값은 공개 식별자(비밀 아님).

■ 색상 관례 안내
  - 이 앱은 빨강=상승 / 파랑=하락 (한국식)으로 전 화면 일관.
