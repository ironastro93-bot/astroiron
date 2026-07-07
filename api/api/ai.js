// ASTRO IRON — AI 해석 서버 (요약·리스크·시나리오·종목비교·Q&A)
// 원칙: AI는 데이터 "해석"만. AI가 실패해도 앱은 죽지 않는다.
// [선택] Vercel 환경변수: ANTHROPIC_API_KEY (없으면 AI 기능만 비활성)

const KEY = process.env.ANTHROPIC_API_KEY;
const TIMEOUT = 45000;

async function callModel(prompt, maxTokens) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    if (r.status === 429) throw { code: 429, msg: "AI 사용량이 많아요." };
    if (r.status === 401) throw { code: 500, msg: "AI 키 오류" };
    if (!r.ok) throw { code: 502, msg: `AI 오류 (${r.status})` };
    const d = await r.json();
    return (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  } finally { clearTimeout(timer); }
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
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용됩니다." });
  if (!KEY) return res.status(503).json({ error: "현재 AI 분석을 사용할 수 없습니다. 실시간 금융 데이터는 계속 제공됩니다.", aiUnavailable: true });

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
      if (e.name === "AbortError") return res.status(504).json({ error: "AI 응답 시간 초과.", aiUnavailable: true });
      if (attempt >= 2) return res.status(e.code || 500).json({ error: e.msg || "AI 오류.", aiUnavailable: true });
    }
  }
}
