// ASTRO IRON — AI 해석 서버 (요약·리스크·시나리오·종목비교·Q&A)
// 원칙: AI는 데이터 "해석"만. AI가 실패해도 앱은 죽지 않는다.
// [선택] Vercel 환경변수: ANTHROPIC_API_KEY (없으면 AI 기능만 비활성)
//        ANTHROPIC_MODEL (선택) — 지정 시 그 모델을 최우선 사용
// 502 대응: 모델명이 틀리면 자동으로 다음 유효 모델로 재시도하고,
//           크레딧 부족/키 오류 등 진짜 사유는 응답 error 로 그대로 전달한다.

const KEY = process.env.ANTHROPIC_API_KEY;
// [무료 대안] NVIDIA NIM (OpenAI 호환) — ANTHROPIC 키가 없으면 자동 사용
const NVIDIA_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";
// 정적 폴백(모델 목록 조회 실패 시)
const STATIC_FALLBACK = [
  "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219",
  "claude-3-5-sonnet-latest", "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022", "claude-haiku-4-5-20251001",
];
let goodModel = null;   // 성공한 모델 기억
let discovered = null;  // 이 키가 실제 쓸 수 있는 모델 목록 (/v1/models)
const TIMEOUT = 45000;
// ── 남용 방지: IP당 분당 요청 제한(베스트에포트, 크레딧 도난 방지) ──
const _rl = new Map();
function rateLimited(ip) {
  const now = Date.now(), WINDOW = 60000, MAX = 20;
  let e = _rl.get(ip);
  if (!e || now - e.t > WINDOW) e = { n: 0, t: now };
  e.n++; _rl.set(ip, e);
  if (_rl.size > 5000) _rl.clear();
  return e.n > MAX;
}

// 이 키가 접근 가능한 모델을 Anthropic에서 직접 조회
async function listModels() {
  if (discovered) return discovered;
  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    });
    if (!r.ok) { console.error("[ai] /v1/models", r.status); return []; }
    const j = await r.json();
    discovered = (j.data || []).map((m) => m.id);
    return discovered;
  } catch (e) { console.error("[ai] /v1/models 예외", String(e.message || e)); return []; }
}

// 시도 순서: 환경변수 → 성공모델 → 조회된 모델(sonnet>haiku>기타) → 정적 폴백
async function modelOrder() {
  const disc = await listModels();
  const pref = [
    ...disc.filter((id) => /sonnet/i.test(id)),
    ...disc.filter((id) => /haiku/i.test(id)),
    ...disc.filter((id) => !/sonnet|haiku/i.test(id)),
  ];
  const order = [process.env.ANTHROPIC_MODEL, goodModel, ...pref, ...STATIC_FALLBACK].filter(Boolean);
  return [...new Set(order)];
}

async function anthropic(model, prompt, maxTokens) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    const raw = await r.text();
    let data = {};
    try { data = JSON.parse(raw); } catch { /* non-JSON */ }
    if (r.ok) {
      return { ok: true, text: (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n") };
    }
    const msg = data?.error?.message || raw.slice(0, 200) || `HTTP ${r.status}`;
    const isModelErr = r.status === 404 || (r.status === 400 && /model/i.test(msg));
    console.error("[ai] Anthropic 오류", r.status, "model=" + model, "→", msg.slice(0, 180));
    return { ok: false, status: r.status, msg, isModelErr };
  } catch (e) {
    if (e.name === "AbortError") return { ok: false, status: 504, msg: "AI 응답 시간 초과", isModelErr: false };
    console.error("[ai] 네트워크 오류", String(e.message || e));
    return { ok: false, status: 500, msg: String(e.message || e), isModelErr: false };
  } finally { clearTimeout(timer); }
}

async function nvidiaChat(prompt, maxTokens) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + NVIDIA_KEY },
      body: JSON.stringify({ model: NVIDIA_MODEL, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0.3 }),
    });
    const raw = await r.text();
    let d = {}; try { d = JSON.parse(raw); } catch { /* non-JSON */ }
    if (!r.ok) {
      const msg = d?.detail || d?.error?.message || raw.slice(0, 180) || ("NVIDIA 오류 " + r.status);
      console.error("[ai] NVIDIA", r.status, msg.slice(0, 160));
      throw { code: r.status === 429 ? 429 : 502, msg };
    }
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
  } catch (e) {
    if (e.name === "AbortError") throw { code: 504, msg: "NVIDIA 응답 시간 초과" };
    throw e;
  } finally { clearTimeout(timer); }
}
async function callModel(prompt, maxTokens) {
  // ANTHROPIC 키가 없고 NVIDIA 키만 있으면 NVIDIA(무료) 사용
  if (!KEY && NVIDIA_KEY) return await nvidiaChat(prompt, maxTokens);
  const order = await modelOrder();
  if (!order.length) throw { code: 502, msg: "이 키로 사용 가능한 모델을 찾지 못했어요. (Anthropic 콘솔에서 모델 접근 권한 확인)" };
  let last = { msg: "AI 오류", status: 502 };
  for (const m of order) {
    const r = await anthropic(m, prompt, maxTokens);
    if (r.ok) { goodModel = m; return r.text; }
    last = r;
    if (!r.isModelErr) break; // 모델 문제가 아니면(크레딧/키/네트워크) 다른 모델도 소용없음
  }
  throw { code: last.status === 429 ? 429 : 502, msg: last.msg };
}

function parseJson(text) {
  let s = text.replace(/```json|```/g, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1) return null;
  s = s.slice(a, b === -1 ? undefined : b + 1);
  try { return JSON.parse(s); }
  catch {
    let f = s;
    if ((f.match(/"/g) || []).length % 2) f += '"';
    const oa = (f.match(/\[/g) || []).length, ca = (f.match(/\]/g) || []).length;
    const oo = (f.match(/{/g) || []).length, co = (f.match(/}/g) || []).length;
    f += "]".repeat(Math.max(0, oa - ca)) + "}".repeat(Math.max(0, oo - co));
    try { return JSON.parse(f); } catch { return null; }
  }
}

export default async function handler(req, res) {
  try {
    // 점검용: GET /api/ai?health=1 → 이 배포가 키를 보는지 확인 (키 값은 노출 안 함)
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, provider: KEY ? "anthropic" : (NVIDIA_KEY ? "nvidia" : "none"), hasKey: !!(KEY || NVIDIA_KEY), keyPreview: KEY ? (KEY.slice(0,7)+"…"+KEY.slice(-4)) : (NVIDIA_KEY ? (NVIDIA_KEY.slice(0,7)+"…"+NVIDIA_KEY.slice(-4)) : null), nvidiaModel: NVIDIA_KEY ? NVIDIA_MODEL : null, availableModels: KEY ? await listModels() : [], activeModel: goodModel, env: process.env.VERCEL_ENV || "unknown" });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용됩니다." });
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.headers["x-real-ip"] || "?";
    if (rateLimited(ip)) return res.status(429).json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요.", aiUnavailable: true });
    { const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || ""); if (raw.length > 8000) return res.status(413).json({ error: "요청 본문이 너무 큽니다.", aiUnavailable: true }); }
    if (!KEY && !NVIDIA_KEY) return res.status(503).json({ error: "현재 AI 분석을 사용할 수 없습니다. (운영자: ANTHROPIC_API_KEY 또는 NVIDIA_API_KEY 등록 필요) 실시간 금융 데이터는 계속 제공됩니다.", aiUnavailable: true });

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const { task, context, question, premium } = body || {};
    const ctxStr = JSON.stringify(context || {}).slice(0, 4500);
    const depth = premium ? "심층적으로 (기업 개요·성장성·경쟁 환경 포함)" : "간결하게 (핵심만)";

    let prompt, maxTokens = premium ? 1400 : 800, wantJson = true;
    if (task === "summary") {
      prompt = `다음은 미국 주식/ETF의 실제 금융 데이터입니다. 이 데이터만 근거로 ${depth} 분석하세요. 수치를 지어내지 마세요.
데이터: ${ctxStr}
ONLY raw JSON, 한국어:
{"signal":"strong_buy|buy|hold|sell|strong_sell","score":<-100~100>,"summary":"${premium ? "4~6문장 심층 요약" : "2문장 요약"}","bullPoints":["강세1","강세2","강세3"],"bearPoints":["약세1","약세2","약세3"]${premium ? ',"overview":"기업/ETF 개요 2문장","growth":"성장성 평가 1~2문장"' : ""}}
signal은 매수/매도 지시가 아닌 데이터 기반 방향성 신호입니다.`;
    } else if (task === "risk") {
      prompt = `다음 금융 데이터로 리스크를 ${depth} 분석하세요. 수치 날조 금지.
데이터: ${ctxStr}
ONLY raw JSON, 한국어:
{"shortTermVolatility":"단기 변동성 1문장","currentRisks":["위험1","위험2"${premium ? ',"위험3"' : ""}],"growthPotential":"성장 가능성 1문장","longTermOutlook":"장기 전망 1문장"}`;
    } else if (task === "scenario") {
      prompt = `다음 데이터로 투자 시나리오 3가지를 제시하세요. 수치 날조 금지.
데이터: ${ctxStr}
ONLY raw JSON, 한국어: {"bull":"강세 시나리오 ${premium ? "2문장" : "1문장"}","neutral":"중립 ${premium ? "2문장" : "1문장"}","bear":"약세 ${premium ? "2문장" : "1문장"}"}`;
    } else if (task === "news_summary") {
      prompt = `뉴스 제목 목록을 ${depth} 요약하고 각 영향을 분류하세요.
뉴스: ${ctxStr}
ONLY raw JSON, 한국어: {"summary":"전체 요약","items":[{"title":"제목(원문 유지)","impact":"positive|neutral|negative"}]}`;
      maxTokens = 1000;
    } else if (task === "compare") {
      prompt = `다음 여러 종목의 데이터를 비교 분석하세요(Premium 기능). 수치 날조 금지.
데이터: ${ctxStr}
ONLY raw JSON, 한국어: {"verdict":"종합 비교 2~3문장","rows":[{"ticker":"XXX","strength":"강점 1문장","weakness":"약점 1문장"}]}`;
      maxTokens = 1200;
    } else if (task === "portfolio") {
      prompt = `사용자 포트폴리오를 진단하세요(개인 맞춤 매매 지시 금지, 일반 원칙만).
포트폴리오: ${ctxStr}
ONLY raw JSON, 한국어: {"concentration":"섹터 편중 1문장","diversification":"분산 수준 1문장","riskLevel":"낮음|보통|높음","advice":"일반적 개선 의견 ${premium ? "2~3문장" : "1문장"}"}`;
    } else if (task === "market_summary") {
      prompt = `다음은 현재 미국 시장의 실시간 데이터(지수·환율·크립토·금리·원자재)입니다. 이 수치만 근거로 오늘 시장을 3문장으로 요약하세요. 수치를 지어내지 마세요.
데이터: ${ctxStr}
ONLY raw JSON, 한국어: {"summary":"3문장 시장 요약"}`;
      maxTokens = 400;
    } else if (task === "translate_news") {
      prompt = `다음 영어 뉴스 제목들을 자연스러운 한국어로 번역하세요. 회사명·티커·고유명사는 그대로 두고 의미를 정확히 옮기세요.
제목 목록(JSON): ${ctxStr}
반드시 입력과 동일한 개수·순서로, ONLY raw JSON: {"items":["한국어번역1","한국어번역2"]}`;
      maxTokens = 1300;
    } else if (task === "chat") {
      prompt = `당신은 투자 정보 도우미입니다. 참고 데이터로 질문에 답하세요.
규칙: 개인 맞춤 매매 지시 금지, 판단 재료(근거·위험) 제시, 모르면 모른다고.
참고 데이터: ${ctxStr}
질문: ${String(question || "").slice(0, 500)}
${premium ? "4~6문장" : "2~3문장"} 한국어. 일반 텍스트.`;
      wantJson = false; maxTokens = premium ? 900 : 500;
    } else {
      return res.status(400).json({ error: "지원하지 않는 AI 작업입니다." });
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await callModel(prompt, maxTokens);
        if (!wantJson) return res.status(200).json({ answer: text.trim() });
        const parsed = parseJson(text);
        if (!parsed) { if (attempt < 2) continue; return res.status(502).json({ error: "AI 응답을 읽지 못했어요.", aiUnavailable: true }); }
        return res.status(200).json(parsed);
      } catch (e) {
        if (attempt >= 2 || e.code === 429) return res.status(200).json({ error: e.msg || "AI 오류.", aiUnavailable: true });
      }
    }
    return res.status(200).json({ error: "AI 오류.", aiUnavailable: true });
  } catch (e) {
    // 어떤 경우에도 함수가 죽어 502가 나지 않도록 최종 안전망
    console.error("[ai] handler 예외", String(e && e.message || e));
    return res.status(200).json({ error: "AI 처리 중 오류가 발생했어요.", aiUnavailable: true });
  }
}
