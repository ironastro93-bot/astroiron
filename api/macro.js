// ASTRO IRON — 거시 데이터 서버 (FRED: 국채금리·달러인덱스·원자재)
// FRED = 미국 연준 경제데이터. 무료, 신뢰도 최상.
// [필수] Vercel 환경변수: FRED_API_KEY (https://fred.stlouisfed.org/docs/api/api_key.html)
// 키 없으면 503 + 안내. 앱은 죽지 않음.

const FRED = "https://api.stlouisfed.org/fred/series/observations";
const KEY = process.env.FRED_API_KEY;
const TIMEOUT = 8000;

// FRED 시리즈 ID 매핑
const SERIES = {
  treasury: [
    ["DGS2", "미국 2년물", "%"],
    ["DGS10", "미국 10년물", "%"],
    ["DGS30", "미국 30년물", "%"],
  ],
  dollar: [
    ["DTWEXBGS", "달러인덱스(광의)", ""],
  ],
  commodity: [
    // FRED LBMA 금·은 시리즈는 2024년 제공 중단 → Yahoo 선물(무키)로 대체
    ["YH:GC=F", "금 ($/oz)", "$"],
    ["YH:SI=F", "은 ($/oz)", "$"],
    ["DCOILWTICO", "WTI 유가 ($/bbl)", "$"],
    ["DHHNGSP", "천연가스 ($/MMBtu)", "$"],
  ],
};

async function yahooSeries(sym) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1mo&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0 ASTRO IRON" }, signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const res0 = j?.chart?.result?.[0];
    const closes = (res0?.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
    if (closes.length < 2) return null;
    const latest = closes[closes.length - 1], prev = closes[closes.length - 2];
    return { latest, change: latest - prev, changePercent: prev ? ((latest - prev) / prev) * 100 : 0, spark: closes.slice(-20) };
  } catch { return null; } finally { clearTimeout(timer); }
}

async function fetchSeries(id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    // 최근 40개 관측치 (스파크라인용), 최신순
    const url = `${FRED}?series_id=${id}&api_key=${KEY}&file_type=json&sort_order=desc&limit=40`;
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const obs = (j.observations || []).filter((o) => o.value !== ".").reverse(); // 오래된→최신
    if (obs.length < 2) return null;
    const vals = obs.map((o) => parseFloat(o.value));
    const latest = vals[vals.length - 1];
    const prev = vals[vals.length - 2];
    const change = latest - prev;
    const changePercent = prev ? (change / prev) * 100 : 0;
    // 스파크라인용 최근 20포인트
    const spark = vals.slice(-20);
    return { latest, change, changePercent, spark };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS")return res.status(204).end();
  const { group } = req.query;
  if (!KEY) return res.status(503).json({ error: "거시 데이터 서버가 설정되지 않았어요. 운영자: FRED_API_KEY를 등록해 주세요.", noKey: true });

  const list = SERIES[group];
  if (!list) return res.status(400).json({ error: "지원하지 않는 그룹입니다. (treasury|dollar|commodity)" });

  try {
    const out = [];
    for (const [id, name, unit] of list) {
      const d = id.startsWith("YH:") ? await yahooSeries(id.slice(3)) : await fetchSeries(id);
      out.push({ id, name, unit, ...(d || { latest: null, change: null, changePercent: null, spark: [] }) });
    }
    return res.status(200).json({ group, items: out });
  } catch (e) {
    return res.status(500).json({ error: "거시 데이터를 불러오지 못했어요." });
  }
}
