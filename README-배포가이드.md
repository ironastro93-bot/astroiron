# ASTRO IRON — .com 사이트 배포 가이드

이 폴더 하나로 진짜 도메인(.com) 사이트를 만들 수 있습니다.
순서대로 따라 하면 약 30분이면 끝납니다.

## 폴더 구성

```
ironastro/
├── index.html        ← 사이트 화면 (프론트엔드)
└── api/
    └── analyze.js    ← AI 분석 서버 (API 키를 숨기는 곳)
```

---

## 1단계 — Anthropic API 키 만들기 (약 5분)

AI 분석이 돌아가려면 Claude API 키가 필요합니다. (사이트 방문자가 아니라 운영자인 내가 비용을 내는 구조)

1. https://console.anthropic.com 접속 → 가입/로그인
2. 좌측 **API Keys** → **Create Key** → 키 복사 (sk-ant-... 로 시작)
3. **Billing**에서 결제수단 등록 후 **최소 금액만 충전** ($5 정도면 테스트 충분)
4. ⚠️ 중요: **Settings > Limits 에서 월 사용 한도를 꼭 설정**하세요 ($10 등).
   한도를 안 걸면 방문자가 몰렸을 때 요금이 계속 나갈 수 있습니다.
5. 이 키는 **절대 아무 데도 붙여넣지 마세요.** 오직 3단계의 Vercel 환경변수에만.

비용 감: 분석 1회당 대략 몇십 원 수준. 무료 하루 3회 제한이 있어서 폭주는 방지됩니다.

---

## 2단계 — Vercel에 무료 배포 (약 10분)

Vercel은 무료 호스팅 서비스입니다. 서버 관리 없이 이 폴더를 올리면 사이트가 됩니다.

1. https://vercel.com 접속 → GitHub 계정으로 가입 (GitHub 없으면 먼저 github.com 가입)
2. GitHub에서 **New repository** → 이름 `ironastro` → 이 폴더의 파일들을 업로드
   (Add file > Upload files 로 index.html과 api 폴더를 끌어다 놓기)
3. Vercel 대시보드 → **Add New > Project** → 방금 만든 ironastro 저장소 **Import**
4. 배포 전 **Environment Variables** 항목에 추가:
   - Name: `ANTHROPIC_API_KEY`
   - Value: 1단계에서 복사한 키
5. **Deploy** 클릭 → 1~2분 뒤 `ironastro.vercel.app` 같은 무료 주소가 생깁니다.
6. 그 주소로 접속해서 분석이 잘 되는지 테스트!

여기까지 하면 이미 전 세계 누구나 접속 가능한 사이트입니다. (아직 .com은 아님)

---

## 3단계 — .com 도메인 구매 & 연결 (약 15분)

1. 도메인 구매처 (아무 곳이나):
   - 가비아 https://www.gabia.com (한국어, 원화 결제)
   - Namecheap https://www.namecheap.com (보통 더 저렴)
2. 원하는 이름 검색 → 예) `astroiron.com`, `ironastro.com` → 구매 (연 1.5~2만원 수준)
3. Vercel 프로젝트 → **Settings > Domains** → 구매한 도메인 입력 → Add
4. Vercel이 알려주는 DNS 설정값(A 레코드 또는 CNAME)을 복사
5. 도메인 구매처의 **DNS 관리** 메뉴에 그 값을 그대로 입력
6. 몇 분~몇 시간 내에 `내도메인.com` 접속 가능 (HTTPS 자물쇠는 Vercel이 자동 발급)

---

## 4단계 — 이후 수정하는 법

- 코드 수정 → GitHub 저장소에서 파일 수정/재업로드 → Vercel이 **자동으로 재배포**
- Pro 코드 변경: index.html의 `PRO_CODE_HASH` 값 교체
  (새 해시 만들기: 브라우저 F12 콘솔에서)
  ```js
  crypto.subtle.digest('SHA-256', new TextEncoder().encode('새코드'))
    .then(b=>console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
  ```
- 현재 해제 코드: AIRN-NZ7I-7PUY (배포 전 교체 권장)

---

## 주의사항

- **API 키는 Vercel 환경변수에만.** index.html이나 GitHub에 붙여넣으면 도난당해 요금 폭탄 맞습니다.
- Anthropic 콘솔에서 **월 한도 설정** 필수.
- 유료 판매를 본격화하면 유사투자자문업 신고(금융감독원) 검토 필요.
- 사이트 하단 면책 문구는 절대 삭제하지 마세요.
