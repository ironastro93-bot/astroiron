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

## 3단계 — Claude(Anthropic) 키 — AI 분석용 (필수는 아니지만, AI 분석을 쓰려면 반드시 필요)
> AI 분석이 "사용할 수 없습니다"로 뜨는 이유는 이 키가 없어서예요. 키를 넣으면 바로 켜집니다.
1. https://console.anthropic.com → **API Keys → Create Key** → 키 복사 (sk-ant-... 로 시작)
2. **Billing → 결제수단 등록 + $5 충전** (충전 안 하면 401/사용불가). **Usage limits에서 월 한도**도 걸어두면 안전.
3. Vercel 환경변수에 `ANTHROPIC_API_KEY` = 복사한 키 등록 → **Redeploy**
4. 없어도 시세·차트·뉴스·공시·재무·배당·투자의견·실적은 정상 작동. (AI 요약/분석만 비활성)

### ⚠️ 모델 ID 주의 (이전 버전 버그 수정됨)
- 이전 코드의 모델명 `claude-sonnet-4-6` 은 **존재하지 않는 이름**이라 키를 넣어도 AI가 실패했어요.
- 이번 버전은 `api/ai.js` 기본 모델을 **`claude-sonnet-4-20250514`** (실제 존재하는 ID)로 수정했습니다.
- 모델을 바꾸고 싶으면 Vercel 환경변수 `ANTHROPIC_MODEL` 에 원하는 모델 ID를 넣으면 코드 수정 없이 교체됩니다.

## 4단계 — Vercel 배포 (10분)
1. https://vercel.com → GitHub 가입
2. GitHub에 ironastro 저장소 만들고 폴더 업로드 (index.html + api 폴더 전체)
3. Add New > Project → Import
4. **Environment Variables**:
   - `FINNHUB_API_KEY` = 1단계 키  (필수)
   - `FRED_API_KEY` = 2단계 키     (필수 · 국채·원자재용)
   - `ANTHROPIC_API_KEY` = 3단계 키 (AI 분석용)
   - `ANTHROPIC_MODEL` = (선택) 모델 교체용. 미입력 시 claude-sonnet-4-20250514 사용
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

---

## v8 변경 사항 (이번 업데이트)
- **로고 클릭 → 홈**: 상단 좌측 ASTRO IRON 로고를 누르면 첫 화면(홈)으로 이동.
- **차트 살림**: Finnhub 무료 티어가 막은 차트를 **Yahoo Finance 일봉(무료·무키)** 으로 교체, 실패 시 Stooq 폴백. 기간 1개월/3개월/1년/5년.
- **AI 분석 수정**: 잘못된 모델 ID(`claude-sonnet-4-6`) → 유효 모델로 교체. `ANTHROPIC_API_KEY`만 넣으면 즉시 동작.
- **미국 주식 검색 확대**: Common Stock·ETF·ADR·REIT·우선주 등 더 많은 미국 종목이 자동완성에 노출.
- **새 탭 추가**: 종목 상세에 **배당 · 투자의견(애널리스트) · 실적(EPS 서프라이즈)** 탭 추가.
- **홈 히트맵**: 인기 미국 종목 급등락 히트맵 + 섹터 ETF(11개) 히트맵. 셀 클릭 시 바로 분석.
- **뉴스·공시 UI 정리**: 뉴스에 상대시간 표시, 공시는 종류 배지 + 한글 라벨(연간/분기/수시 보고서)로 깔끔하게.

## 데이터 출처 요약
- 시세·프로필·뉴스·재무·배당·투자의견·실적·지수·크립토·히트맵: **Finnhub** (FINNHUB_API_KEY)
- 차트(일봉): **Yahoo Finance**(주) / **Stooq**(폴백) — 키 불필요
- 공시: **SEC EDGAR** — 키 불필요
- 국채·달러·원자재: **FRED** (FRED_API_KEY)
- AI 요약·분석: **Anthropic Claude** (ANTHROPIC_API_KEY, 선택)

---

## v10 — 502(AI) 및 차트/UX 문제 해결

### 1) Anthropic 모델명 고정 (502의 핵심 원인)
- `api/ai.js` 기본 모델을 **`claude-3-5-sonnet-latest`** 로 고정했습니다. (원하면 `claude-3-5-sonnet-20241022` 로 바꿔도 됩니다.)
- 존재하지 않는 모델 ID를 쓰면 Anthropic이 400/404를 주고 서버가 502로 죽습니다. 이제 유효 ID로 고정 + 실패 시 **Vercel 로그에 원인**(`[ai] Anthropic API 오류 ...`)을 남깁니다.
- 모델 교체는 코드 수정 없이 환경변수 `ANTHROPIC_MODEL` 로 가능.

### 2) ⚠️ 반드시 확인 — ANTHROPIC_API_KEY 를 **Production 에도** 체크
- 현재 이 키가 **Preview(미리보기)** 에만 걸려 있어서, 실제 도메인(Production)에서는 `undefined` → 401 → **502** 로 튕깁니다.
- Vercel → Settings → **Environment Variables** → `ANTHROPIC_API_KEY` 의 ⋯ → Edit → **Production 체크박스 켜기** → Save.
- 그 다음 **Deployments → 최신 배포 → Redeploy**. (환경변수는 재배포해야 반영)
- Anthropic **Billing에 결제수단 등록 + 크레딧 충전**도 필요(없으면 401).

### 3) 로컬 실행 주의 (Windows Script Host 800A03EA 방지)
- `api/*.js` 는 **서버(Vercel/Node) 전용** 파일입니다. Windows에서 **더블클릭하지 마세요** → WScript가 실행하려다 `800A03EA 구문 오류`가 납니다. (코드 문제가 아니라 실행 방식 문제)
- 로컬 점검이 필요하면 터미널에서 `node --check api/ai.js` 처럼 Node로만 검사하세요. 전 파일 문법 검사 완료.

### 4) 프론트엔드 차트 침범(Overflow) 수정
- 차트 컨테이너에 `overflow:hidden` 적용 → 선이 영역 밖으로 삐져나가지 않고 잘립니다.
- Y축 도메인에 위아래 **10% 여백**을 줘서 선이 천장/바닥을 뚫지 않게 스케일링.
- SVG를 `width:100%` + `preserveAspectRatio` 반응형으로, 전역 `svg{max-width:100%}` / `body{overflow-x:hidden}` 로 창 크기 변경·모바일 가로 넘침 방지.
- 모바일: 차트 영역 `touch-action:pan-y` → 차트를 만져도 **세로 스크롤 정상**.

### 그 외 UX
- 검색창 **디바운스 260ms** 적용됨(타자 멈춘 뒤에만 요청 → 무료 한도 보호).
- 데이터/AI 로딩 중 **스켈레톤 UI** 유지.
- **차트 점 툴팁**: 마우스 올리면 날짜·가격 표시.
- AI 시장 요약 실패 시 **다시 시도 버튼**(전체 새로고침 불필요). 종목 AI 실패 시 **사유 표시**.
- **최근 조회·관심종목 localStorage 저장**, **다크모드 상태 기억** 유지.

## v12 — 우주 테마 + SpaceX(비상장) 추가
- **다크모드 우주 배경**: `index.html`의 `<style>`에서 `[data-theme="dark"] #sky`에 우주 이미지(`space-bg.jpg`) + 어두운 오버레이(rgba 0.6). 라이트모드는 기존 유지. 이미지 없으면 우주풍 그라데이션+별로 자동 대체(멈춤 없음). → 사진을 쓰려면 **`space-bg.jpg`를 index.html과 같은 폴더(저장소 루트)**에 두세요.
- **글래스모피즘**: 다크모드에서 카드·내비·모달 반투명 + `backdrop-blur`.
- **SpaceX(비상장)**:
  - 검색창에 `SpaceX` 입력(또는 자동완성 선택) 시 Finnhub 시세를 호출하지 않고 **전용 뉴스 상세**로 라우팅.
  - 홈 하단에 **🚀 SpaceX 비상장 카드** — 최신 뉴스 3건 요약, 우주 테마와 어울리는 글래스 카드.
  - 데이터 소스: 서버 `/api/finance?type=keyword_news&query=SpaceX` — **Finnhub 일반뉴스에서 'SpaceX/Starship/Falcon' 키워드 필터**, 키가 없거나 결과가 없으면 **Yahoo 뉴스로 폴백**(무키). 전 구간 try-catch로 실패해도 앱이 멈추지 않음.

## v14 — /api/ai 502 근본 해결
- **모델 자동 폴백**: 지정 모델이 틀려도(404/400 model) `claude-3-5-sonnet-latest → claude-3-5-sonnet-20241022 → haiku → claude-3-haiku` 순으로 자동 재시도. 성공한 모델은 기억.
- **502 제거**: AI 실패를 이제 HTTP 502가 아니라 **200 + `{aiUnavailable:true, error:"실제 사유"}`** 로 반환 → Vercel 로그의 빨간 502가 사라지고, 화면 AI 탭에 **진짜 사유**가 표시됩니다.
  - 사유가 "credit balance is too low" 면 → Anthropic Billing 크레딧 충전.
  - "invalid x-api-key" / 401 이면 → 키 오류(재발급/재등록) + **ANTHROPIC_API_KEY를 Production 스코프에도 체크 후 Redeploy**.
- **최종 안전망**: 핸들러 전체를 try-catch로 감싸 어떤 예외에도 함수가 죽지 않음(502 원천 차단).
- 참고: `/api/finance`·`/api/macro`는 로그상 200 정상. 문제는 `/api/ai` 하나였고, 위 변경으로 502가 나지 않습니다.

## v19 — 추천 3종(가격 알림 · 공유 · 인트라데이 차트)
- **가격 알림 🔔**: 종목 → 개요 탭에서 "이상(≥)/이하(≤) + 목표가" 설정. 1분 간격으로 감지해 도달 시 **브라우저 알림**(권한 없으면 사이트 내 배너). 상단 메뉴 "알림"에서 관리. 이 기기 저장.
- **URL 딥링크 / 공유 🔗**: 이제 종목·화면마다 주소가 바뀝니다(`astroiron.com/#stock/AAPL`, `/#watchlist`). 상세의 "🔗 공유" 버튼으로 링크 복사. 링크로 들어오면 해당 종목이 바로 열림(뒤로가기 지원). 북마크·공유·SEO에 유리.
- **인트라데이 + 거래량 차트 📈**: 차트 탭에 **1일(5분봉)** 추가 + 모든 기간에 **거래량 막대** 표시. 점 툴팁에 거래량 포함. Yahoo 무료 데이터.
