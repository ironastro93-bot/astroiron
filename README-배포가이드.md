# ASTRO IRON — 배포 가이드 (v5 · 금융/AI 분리 아키텍처)

## 새 구조의 핵심
- **금융 데이터**(시세·차트·재무·뉴스·공시)는 공식 API에서 직접 옵니다 → AI를 쓰지 않음, 항상 정확·빠름
- **AI**는 요약·리스크·시나리오 "해석"만 담당 → AI가 죽어도 금융 데이터는 정상 작동
- 두 서버가 분리되어 있어 한쪽 장애가 다른 쪽에 영향 없음

## 폴더 구성
```
ironastro/
├── index.html        ← 화면
└── api/
    ├── finance.js    ← 금융 데이터 (Finnhub + SEC EDGAR)  [필수 키 1개]
    └── ai.js         ← AI 해석 (Anthropic)                [선택 키]
```

---

## 1단계 — Finnhub 무료 키 (필수, 약 3분)
1. https://finnhub.io → **Get free API key** → 가입 → 대시보드에서 API 키 복사
2. 무료 티어: 분당 60회. 개인 서비스엔 충분.

## 2단계 — Anthropic 키 (선택 · AI 분석용, 약 5분)
1. https://console.anthropic.com → API Keys → Create Key → 복사
2. Billing에서 $5 충전 + **월 한도 설정**
3. 넣지 않아도 앱은 정상 작동합니다(AI 분석 탭만 "사용 불가"로 표시).

## 3단계 — Vercel 배포 (약 10분)
1. https://vercel.com → GitHub로 가입
2. GitHub에 `ironastro` 저장소 만들고 폴더 업로드 (index.html + api 폴더 전체)
3. Vercel → Add New > Project → Import
4. **Environment Variables**:
   - `FINNHUB_API_KEY` = 1단계 키  (필수)
   - `ANTHROPIC_API_KEY` = 2단계 키 (선택)
5. Deploy → `xxx.vercel.app` 생성

## 4단계 — .com 연결 (약 15분)
1. 가비아 또는 Namecheap에서 .com 구매
2. Vercel → Settings > Domains → 도메인 추가
3. 안내된 DNS 값을 도메인 구매처에 입력 → 완료 (HTTPS 자동)

---

## 데이터 출처
- 시세·차트·재무·뉴스·지수: **Finnhub** (finnhub.io)
- SEC 공시: **SEC EDGAR** (무료, 키 불필요)
- AI 요약·리스크·시나리오: **Anthropic Claude** (선택)

## 주의
- 키는 **Vercel 환경변수에만.** 코드·GitHub에 넣지 마세요.
- Finnhub 무료 티어는 미국 주식 위주. 일부 지표·해외종목은 값이 없을 수 있어요(앱은 "—"로 표시).
- 지수는 무료 티어 제약으로 대표 ETF(SPY/QQQ/DIA/IWM) 시세로 표시됩니다.
- 유료화 본격화 시 유사투자자문업 신고(금감원) 검토. 면책 문구 삭제 금지.
- 더 정밀한 실시간(초 단위 호가)·옵션·선물은 Finnhub 유료 또는 Polygon 추가 연동 필요.
