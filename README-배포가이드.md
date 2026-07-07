# ASTRO IRON — 배포 가이드 (v7 · 글로벌 시장 대시보드)

## 구조
- **금융 데이터**(시세·차트·재무·뉴스·공시·지수·크립토) → Finnhub / SEC EDGAR
- **거시 데이터**(국채금리·달러인덱스·원자재) → FRED (미국 연준)
- **AI**(요약·리스크·시나리오·시장요약) → Anthropic (선택 · 없어도 앱 정상)
- 세 서버가 분리되어 한쪽 장애가 다른 쪽에 영향 없음

## 폴더 구성
```
ironastro/
├── index.html
└── api/
    ├── finance.js   ← Finnhub + SEC EDGAR   [FINNHUB_API_KEY 필수]
    ├── macro.js     ← FRED 국채·달러·원자재  [FRED_API_KEY 필수]
    └── ai.js        ← Anthropic 해석         [ANTHROPIC_API_KEY 선택]
```

---

## 1단계 — Finnhub 키 (필수, 3분)
1. https://finnhub.io → Get free API key → 가입 → 키 복사
2. 무료 티어: 분당 60회

## 2단계 — FRED 키 (필수, 3분)
1. https://fred.stlouisfed.org → 가입
2. My Account → API Keys → Request API Key → 키 복사
3. 완전 무료, 국채금리·달러·원자재 데이터 제공

## 3단계 — Anthropic 키 (선택, AI용)
1. https://console.anthropic.com → API Keys → Create Key
2. Billing $5 충전 + **월 한도 설정**
3. 없어도 앱 정상 작동 (AI 요약·분석만 "사용 불가"로 표시)

## 4단계 — Vercel 배포 (10분)
1. https://vercel.com → GitHub 가입
2. GitHub에 ironastro 저장소 만들고 폴더 업로드 (index.html + api 폴더 전체)
3. Add New > Project → Import
4. **Environment Variables**:
   - `FINNHUB_API_KEY` = 1단계 키  (필수)
   - `FRED_API_KEY` = 2단계 키     (필수 · 국채·원자재용)
   - `ANTHROPIC_API_KEY` = 3단계 키 (선택)
5. Deploy

## 5단계 — .com 연결 (15분)
가비아/Namecheap에서 .com 구매 → Vercel Settings > Domains에 추가 → DNS 입력

---

## 홈 대시보드 데이터 출처
- 지수·ETF·크립토: Finnhub
- 국채금리(2Y/10Y/30Y)·달러인덱스·금·은·유가·천연가스: FRED
- AI 시장 요약: Anthropic (선택)
- 각 카드의 미니 차트(스파크라인)는 자체 SVG로 렌더

## 주의
- 키는 **Vercel 환경변수에만.**
- Finnhub 무료 티어는 미국 주식·ETF·크립토 위주. 환율(forex)은 무료 티어에서 제한될 수 있음(그 경우 "—" 표시).
- FRED 원자재는 일부 시리즈가 영업일 기준 1~2일 지연될 수 있음(공식 데이터 특성).
- 검색은 Finnhub search로 미국 전체 상장 종목·ETF 자동완성 지원 (DIRECTORY 제한 없음).
- 유료화 본격화 시 유사투자자문업 신고(금감원) 검토. 면책 문구 삭제 금지.
- 차트는 자체 SVG 렌더(타사 차트 캡처·iframe 없음), 뉴스는 제목+원문링크만(저작권 준수).
