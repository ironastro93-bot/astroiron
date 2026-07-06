// ASTRO IRON — AI 분석 중계 서버 (Vercel Serverless Function)
// API 키는 이 서버에만 존재하며 브라우저에 절대 노출되지 않습니다.
// Vercel 대시보드 > Settings > Environment Variables 에
//   ANTHROPIC_API_KEY = (본인 키)
// 를 등록해야 작동합니다.

export default async function handler(req, res) {
  // CORS: 같은 도메인에서만 쓰므로 기본값 유지. 필요시 본인 도메인만 허용.
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }

  const { type, ticker } = req.body || {};

  // 입력 검증 (서버에서도 한 번 더 — 클라이언트 검증은 우회될 수 있음)
  if (type === "stock" && !/^[A-Z0-9.]{1,6}$/.test(ticker || "")) {
    return res.status(400).json({ error: "잘못된 티커 형식입니다." });
  }
  if (type !== "stock" && type !== "market") {
    return res.status(400).json({ error: "잘못된 요청 유형입니다." });
  }

  const stockPrompt = `You are a stock analysis engine. Search the web for the CURRENT, most recent data on the US stock with ticker "${ticker}".

Find: current/latest price, daily change %, recent price trend, notable recent news, and general analyst sentiment.

Respond with ONLY a raw JSON object (no markdown, no code fences, no preamble). Keep every string SHORT. All strings in KOREAN except ticker/companyName/asOf:

{
  "ticker": "${ticker}",
  "companyName": "회사명 (영문)",
  "price": 123.45,
  "changePercent": -1.23,
  "asOf": "price data date",
  "signal": "strong_buy" | "buy" | "hold" | "sell" | "strong_sell",
  "score": <integer -100 to 100>,
  "summary": "2문장 요약",
  "bullPoints": ["근거1", "근거2", "근거3"],
  "bearPoints": ["근거1", "근거2", "근거3"],
  "news": ["뉴스 한 줄 요약1", "요약2", "요약3"]
}

If the ticker does not exist, respond: {"error": "설명 (한국어)"}`;

  const marketPrompt = `Search the web for CURRENT market data. Respond with ONLY raw JSON (no markdown, no fences). Keep strings SHORT, in KOREAN:

{
  "asOf": "data date",
  "mood": "fear" | "neutral" | "greed",
  "moodScore": <0-100, current CNN Fear & Greed Index or estimate>,
  "summary": "오늘 글로벌 시장 분위기 2문장 요약 (한국어)",
  "items": [
    {"name": "S&P 500", "value": "6,000.12", "changePercent": 0.45},
    {"name": "나스닥", "value": "...", "changePercent": 0},
    {"name": "다우존스", "value": "...", "changePercent": 0},
    {"name": "코스피", "value": "...", "changePercent": 0},
    {"name": "원/달러", "value": "...", "changePercent": 0},
    {"name": "비트코인", "value": "...", "changePercent": 0},
    {"name": "VIX", "value": "...", "changePercent": 0}
  ]
}`;

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: type === "stock" ? 2000 : 1500,
        messages: [{ role: "user", content: type === "stock" ? stockPrompt : marketPrompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      }),
    });

    if (!apiRes.ok) {
      const status = apiRes.status;
      if (status === 401) return res.status(500).json({ error: "서버 설정 오류(키). 운영자에게 문의해 주세요." });
      if (status === 429) return res.status(429).json({ error: "요청이 많아요. 잠시 후 다시 시도해 주세요." });
      return res.status(502).json({ error: `AI 서버 오류 (${status})` });
    }

    const data = await apiRes.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const cleaned = text.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return res.status(502).json({ error: "분석 결과를 읽지 못했어요. 다시 시도해 주세요." });
    }
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "분석 중 오류가 발생했어요. 다시 시도해 주세요." });
  }
}
