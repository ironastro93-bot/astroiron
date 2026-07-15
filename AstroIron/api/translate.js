// ASTRO IRON — 무료 번역 서버 (뉴스 제목 영→한)
// 원칙: LLM(Anthropic/NVIDIA) 없이, 무료·무키 번역 서비스만 사용한다.
//  1순위: Google 무료 엔드포인트(translate_a/single, 무키) — 한국어 품질 좋음
//  2순위: MyMemory 무료 티어(무키) — 폴백
// 키 불필요. 실패 시 빈 문자열 반환 → 프론트는 원문(영어) 유지.

const TIMEOUT = 7000;
const UA = { "User-Agent": "Mozilla/5.0 ASTRO IRON" };

function withTimeout() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

async function gtx(text) {
  const t = withTimeout();
  try {
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=" + encodeURIComponent(text);
    const r = await fetch(url, { headers: UA, signal: t.signal });
    if (!r.ok) return "";
    const j = await r.json();
    const out = (Array.isArray(j) && Array.isArray(j[0]) ? j[0] : []).map((seg) => (seg && seg[0]) || "").join("");
    return out && out.trim() ? out.trim() : "";
  } catch { return ""; } finally { t.done(); }
}

async function myMemory(text) {
  const t = withTimeout();
  try {
    const url = "https://api.mymemory.translated.net/get?langpair=en|ko&q=" + encodeURIComponent(text);
    const r = await fetch(url, { headers: UA, signal: t.signal });
    if (!r.ok) return "";
    const j = await r.json();
    const out = j && j.responseData && j.responseData.translatedText;
    return out && out.trim() ? out.trim() : "";
  } catch { return ""; } finally { t.done(); }
}

async function translateOne(text) {
  const s = String(text || "").slice(0, 500).trim();
  if (!s) return "";
  return (await gtx(s)) || (await myMemory(s)) || "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.query && req.query.health) {
      const sample = await translateOne("Market rallies on Fed decision");
      return res.status(200).json({ ok: true, provider: "gtx+mymemory", sample });
    }

    let titles = [];
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch { body = {}; } }
      body = body || {};
      if (Array.isArray(body.titles)) titles = body.titles;
    } else if (req.query && req.query.q) {
      titles = [String(req.query.q)];
    }

    titles = titles.slice(0, 20).map((x) => String(x || ""));
    const items = await Promise.all(titles.map((t) => translateOne(t)));
    return res.status(200).json({ items });
  } catch (e) {
    // 절대 죽지 않게 — 실패해도 200 + 빈 배열
    return res.status(200).json({ items: [], error: String((e && e.message) || e) });
  }
}
