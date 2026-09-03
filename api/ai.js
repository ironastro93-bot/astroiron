// ASTRO IRON — AI 해석 서버 (Provider 패턴: NVIDIA 우선 · Anthropic 폴백)
// 원칙: AI는 데이터 "해석"만. AI가 실패해도 앱은 죽지 않는다.
// 환경변수(.env / Vercel):
//   NVIDIA_API_KEY   (기본 AI 엔진 · 권장)
//   NVIDIA_MODEL     (선택, 기본 meta/llama-3.3-70b-instruct)
//   ANTHROPIC_API_KEY(폴백 AI 엔진)
//   ANTHROPIC_MODEL  (선택)
//   AI_PROVIDER_ORDER(선택, 예: "nvidia,anthropic" — 우선순위 재정의)
// 어떤 키도 코드에 하드코딩하지 않는다.

const KEY = process.env.ANTHROPIC_API_KEY;
const NVIDIA_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";
const STATIC_FALLBACK = [
  "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219",
  "claude-3-5-sonnet-latest", "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022", "claude-haiku-4-5-20251001",
];
let goodModel = null;
let discovered = null;
let lastProvider = null;
const TIMEOUT = 45000;

// ── 남용 방지: IP당 분당 요청 제한 ──
const _rl = new Map();
function rateLimited(ip) {
  const now = Date.now(), WINDOW = 60000, MAX = 20;
  let e = _rl.get(ip);
  if (!e || now - e.t > WINDOW) e = { n: 0, t: now };
  e.n++; _rl.set(ip, e);
  if (_rl.size > 5000) _rl.clear();
  return e.n > MAX;
}

// ── 응답 캐시(동일 프롬프트 중복 호출 절감, 인스턴스 내 베스트에포트) ──
const _cache = new Map();
const CACHE_TTL = 600000; // 10분
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() - e.t > CACHE_TTL) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v) {
  _cache.set(k, { t: Date.now(), v });
  if (_cache.size > 400) { const first = _cache.keys().next().value; _cache.delete(first); }
}

// ── Anthropic 모델 탐색 ──
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
async function anthropicOne(model, prompt, maxTokens) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    const raw = await r.text();
    let data = {}; try { data = JSON.parse(raw); } catch { /* non-JSON */ }
    if (r.ok) return { ok: true, text: (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n") };
    const msg = data?.error?.message || raw.slice(0, 200) || `HTTP ${r.status}`;
    const isModelErr = r.status === 404 || (r.status === 400 && /model/i.test(msg));
    console.error("[ai] Anthropic", r.status, "model=" + model, "→", msg.slice(0, 180));
    return { ok: false, status: r.status, msg, isModelErr };
  } catch (e) {
    if (e.name === "AbortError") return { ok: false, status: 504, msg: "AI 응답 시간 초과", isModelErr: false };
    return { ok: false, status: 500, msg: String(e.message || e), isModelErr: false };
  } finally { clearTimeout(timer); }
}
// Provider: Anthropic (모델 자동탐색 포함) → 성공 시 text, 실패 시 throw {code,msg}
async function anthropicProvider(prompt, maxTokens) {
  const order = await modelOrder();
  if (!order.length) throw { code: 502, msg: "이 Anthropic 키로 사용 가능한 모델을 찾지 못했어요." };
  let last = { msg: "AI 오류", status: 502 };
  for (const m of order) {
    const r = await anthropicOne(m, prompt, maxTokens);
    if (r.ok) { goodModel = m; return r.text; }
    last = r;
    if (!r.isModelErr) break; // 크레딧/키/네트워크 문제면 다른 모델도 무의미
  }
  throw { code: last.status === 429 ? 429 : 502, msg: last.msg };
}
// Provider: NVIDIA NIM (OpenAI 호환) → 성공 시 text, 실패 시 throw {code,msg}
async function nvidiaProvider(prompt, maxTokens) {
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
    if (e && e.code) throw e;
    throw { code: 502, msg: String(e && e.message || e) };
  } finally { clearTimeout(timer); }
}

// ── Provider 레지스트리(확장 지점: openai/gemini 등 여기에 추가) ──
const PROVIDERS = {
  nvidia: { available: () => !!NVIDIA_KEY, call: nvidiaProvider },
  anthropic: { available: () => !!KEY, call: anthropicProvider },
};
function providerOrder() {
  const envOrder = (process.env.AI_PROVIDER_ORDER || "").split(",").map((s) => s.trim()).filter(Boolean);
  const base = envOrder.length ? envOrder : ["nvidia", "anthropic"]; // 기본: NVIDIA 우선
  return base.filter((n) => PROVIDERS[n] && PROVIDERS[n].available());
}
// 우선 Provider부터 시도 → 실패하면 다음 Provider로 자동 폴백
async function callModel(prompt, maxTokens) {
  const order = providerOrder();
  if (!order.length) throw { code: 503, msg: "AI 키가 설정되지 않았어요." };
  let last = { code: 502, msg: "AI 오류" };
  for (const name of order) {
    try {
      const text = await PROVIDERS[name].call(prompt, maxTokens);
      lastProvider = name;
      return text;
    } catch (e) {
      last = { code: e.code || 502, msg: e.msg || String(e) };
      console.error("[ai] provider '" + name + "' 실패 → 폴백 시도", last.code, String(last.msg).slice(0, 140));
    }
  }
  throw last;
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
    if (req.method === "GET") {
      const order = providerOrder();
      return res.status(200).json({
        ok: true, providerOrder: order, primary: order[0] || null, activeProvider: lastProvider,
        nvidia: !!NVIDIA_KEY, anthropic: !!KEY, nvidiaModel: NVIDIA_KEY ? NVIDIA_MODEL : null,
        availableModels: KEY ? await listModels() : [], activeModel: goodModel,
        cacheSize: _cache.size, env: process.env.VERCEL_ENV || "unknown",
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용됩니다." });
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.headers["x-real-ip"] || "?";
    if (rateLimited(ip)) return res.status(429).json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요.", aiUnavailable: true });
    { const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || ""); if (raw.length > 8000) return res.status(413).json({ error: "요청 본문이 너무 큽니다.", aiUnavailable: true }); }
    if (!providerOrder().length) return res.status(503).json({ error: "현재 AI 분석을 사용할 수 없습니다. (운영자: NVIDIA_API_KEY 또는 ANTHROPIC_API_KEY 등록 필요) 실시간 금융 데이터는 계속 제공됩니다.", aiUnavailable: true });

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
    } else if (task === "news_sentiment") {
      prompt = `다음 뉴스 제목 목록을 감성 분석하세요. 각 제목의 감성과 주가 영향도를 분류하고, 전체 감성과 핵심 키워드를 뽑으세요.
뉴스(JSON): ${ctxStr}
반드시 입력과 동일한 개수·순서로, ONLY raw JSON, 한국어: {"overall":"전체 감성 한줄 요약","sentiment":"positive|neutral|negative","score":<-100~100>,"keywords":["키워드1","키워드2","키워드3","키워드4","키워드5"],"items":[{"sentiment":"positive|neutral|negative","impact":"high|medium|low"}]}`;
      maxTokens = 1200;
    } else if (task === "stock_deep") {
      prompt = `다음은 미국 주식의 실시간 시세·재무지표·최근 뉴스 제목입니다. 이 데이터만 근거로 심층 분석하세요. 경쟁사는 업계 상식 범위에서 '이름'만 언급하고 경쟁사의 구체 수치는 지어내지 마세요. 투자권유·목표가 단정 금지, 수치 날조 금지.
데이터: ${ctxStr}
ONLY raw JSON, 한국어: {"aiScore":<0~100>,"growth":"성장성 2~3문장","financialHealth":"재무 건전성 1~2문장","competitive":"경쟁 환경·주요 경쟁사(이름) 2~3문장","moat":"해자/차별점 1문장","opportunities":["기회1","기회2"],"threats":["위협1","위협2"],"verdict":"AI 종합 의견 2~3문장(중립)"}`;
      maxTokens = 1300;
    } else if (task === "portfolio_deep") {
      prompt = `사용자 포트폴리오와 이미 계산된 섹터/국가 비중·분산점수(실데이터)입니다. 개인 맞춤 매매 지시는 금지하고 일반 원칙 기반으로 진단·리밸런싱 아이디어를 제시하세요. 수치 날조 금지.
데이터: ${ctxStr}
ONLY raw JSON, 한국어: {"riskLevel":"낮음|보통|높음","diversification":"분산 수준 평가 1~2문장","concentration":"편중 위험 1~2문장","rebalance":[{"action":"조정 아이디어(일반 원칙)","reason":"근거"}],"overall":"종합 의견 1~2문장"}`;
      maxTokens = 1100;
    } else if (task === "compare") {
      prompt = `다음 여러 종목의 데이터를 비교 분석하세요(Premium 기능). 수치 날조 금지.
데이터: ${ctxStr}
ONLY raw JSON, 한국어: {"verdict":"종합 비교 2~3문장","rows":[{"ticker":"XXX","strength":"강점 1문장","weakness":"약점 1문장"}]}`;
      maxTokens = 1200;
    } else if (task === "portfolio") {
      prompt = `사용자 포트폴리오를 진단하세요(개인 맞춤 매매 지시 금지, 일반 원칙만).
포트폴리오: ${ctxStr}
ONLY raw JSON, 한국어: {"concentration":"섹터 편중 1문장","diversification":"분산 수준 1문장","riskLevel":"낮음|보통|높음","advice":"일반적 개선 의견 ${premium ? "2~3문장" : "1문장"}"}`;
    } else if (task === "order_assist") {
      prompt = `다음은 미국 주식의 실시간 데이터입니다. 이 데이터만 근거로 매매 '참고' 정보를 제시하세요. 투자권유·단정·목표가 제시 금지, 수치 날조 금지.
데이터: ${ctxStr}
ONLY raw JSON, 한국어: {"valuation":"현재가 밸류에이션 한줄(데이터 근거, 예: 일중 고점 부근/저점 부근)","volatility":"예상 변동성 한줄","suggestStop":"손절 참고선 한줄(예: -5% 부근, 근거)","suggestTake":"익절 참고선 한줄(예: +10% 부근, 근거)","opinion":"중립적 관찰 1~2문장","risk":"낮음|중간|높음"}`;
      maxTokens = 600;
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
      const history = Array.isArray(body.history) ? body.history.slice(-6).map((m) => (m.role === "user" ? "사용자" : "AI") + ": " + String(m.text || "").slice(0, 300)).join("\n") : "";
      prompt = `당신은 투자 정보 도우미입니다. 참고 데이터와 이전 대화 맥락으로 질문에 답하세요.
규칙: 개인 맞춤 매매 지시 금지, 판단 재료(근거·위험) 제시, 모르면 모른다고, 투자 초보도 이해하기 쉽게.
참고 데이터: ${ctxStr}
${history ? "이전 대화:\n" + history + "\n" : ""}질문: ${String(question || "").slice(0, 500)}
${premium ? "4~6문장" : "2~3문장"} 한국어. 일반 텍스트.`;
      wantJson = false; maxTokens = premium ? 900 : 500;
    } else {
      return res.status(400).json({ error: "지원하지 않는 AI 작업입니다." });
    }

    // 캐시(챗 제외 — 대화는 매번 신선하게)
    const ckey = task !== "chat" ? (task + "|" + (premium ? 1 : 0) + "|" + ctxStr) : null;
    if (ckey) { const hit = cacheGet(ckey); if (hit) return res.status(200).json(hit); }

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await callModel(prompt, maxTokens);
        if (!wantJson) { const out = { answer: text.trim(), provider: lastProvider }; return res.status(200).json(out); }
        const parsed = parseJson(text);
        if (!parsed) { if (attempt < 2) continue; return res.status(502).json({ error: "AI 응답을 읽지 못했어요.", aiUnavailable: true }); }
        parsed._provider = lastProvider;
        if (ckey) cacheSet(ckey, parsed);
        return res.status(200).json(parsed);
      } catch (e) {
        if (attempt >= 2 || e.code === 429) return res.status(200).json({ error: e.msg || "AI 오류.", aiUnavailable: true });
      }
    }
    return res.status(200).json({ error: "AI 오류.", aiUnavailable: true });
  } catch (e) {
    console.error("[ai] handler 예외", String(e && e.message || e));
    return res.status(200).json({ error: "AI 처리 중 오류가 발생했어요.", aiUnavailable: true });
  }
}
