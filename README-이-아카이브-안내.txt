========================================
 AstroIron v1.0 — 프로젝트 배포/백업 아카이브
 생성일: 2026-07-13
========================================

■ 압축 형식 안내 (중요)
 이 파일은 표준 ZIP 형식입니다. 반디집(Bandizip)으로 그대로 열립니다.
 ※ "빈디집/VinDizip/.vdz" 는 실재하지 않는 형식이라 사용하지 않았습니다.
   반디집은 표준 .zip / .7z 를 만들고 여는 도구이며, 독점 .vdz 형식은 없습니다.
   Vercel·GitHub 배포도 .zip 또는 평문 파일 기준이므로 .zip 이 올바른 선택입니다.

■ 이 앱의 실제 구조
 - 단일 index.html (바닐라 JS 프론트엔드) + api/ (Vercel 서버리스 함수)
 - Next.js / app / components 구조가 아닙니다. (설계문서의 구조와 다름)

■ 폴더 구성
 AstroIron_v1.0/
 ├─ index.html                 메인 앱 (홈 지수 히어로 + 모의투자 쉬움모드/종목목록 반영본)
 ├─ about.html / faq.html / privacy.html / terms.html / community-policy.html
 ├─ sw.js / firebase-messaging-sw.js / manifest.webmanifest
 ├─ ads.txt / robots.txt / sitemap.xml / vercel.json / package.json
 ├─ google7b2f13fdceb9da06.html   (구글 소유확인)
 ├─ og.png / icon-180.png / icon-192.png / icon-512.png
 ├─ api/
 │   ├─ finance.js   (Finnhub + SEC EDGAR)   [FINNHUB_API_KEY]
 │   ├─ macro.js     (FRED 국채·달러·원자재)  [FRED_API_KEY]
 │   ├─ ai.js        (Anthropic/NVIDIA)       [ANTHROPIC_API_KEY 또는 NVIDIA_API_KEY]
 │   └─ analyze.js
 └─ README-배포가이드.md

■ 보안
 - API 키는 파일에 없습니다. 전부 process.env(Vercel 환경변수)에서 읽습니다.
 - firebase-messaging-sw.js 의 Firebase 설정값은 공개용 식별자입니다(비밀 아님).

■ 배포 방법
 1) 압축 해제 후 폴더 내용을 저장소 루트에 그대로 업로드
 2) Vercel Environment Variables 에 키 등록:
    FINNHUB_API_KEY (필수) / FRED_API_KEY (필수) / ANTHROPIC_API_KEY 또는 NVIDIA_API_KEY (AI, 선택)
 3) git push → Vercel 자동 배포

■ 이번 버전(v1.0)에 반영된 최근 변경
 - 홈: 미국 주요 지수 입체형 히어로(대형 S&P500 / 중형 나스닥·다우 / 소형 러셀2000·시장심리)
 - 모의투자: 쉬움/전문가 모드, 종목 목록 탭(검색 없이 원클릭 매수/매도), 예상 수익·손실
 - 초보자 온보딩(모의투자란? + 인기종목 원탭), 시작자금 프리셋 모달
 - 참고: VIX 는 무료 백엔드 미지원 → '시장 심리(상승종목 비율)' 게이지로 대체
