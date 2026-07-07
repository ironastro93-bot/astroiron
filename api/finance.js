// ASTRO IRON — 금융 데이터 서버 (Finnhub + SEC EDGAR)
// 원칙: 실시간 금융 데이터는 AI를 절대 호출하지 않는다. 공식 API에서 직접 가져온다.
//
// [필수] Vercel 환경변수: FINNHUB_API_KEY = 본인 무료 키 (https://finnhub.io)
// 키가 없으면 각 요청은 503 + 안내 메시지를 반환하고, 앱은 죽지 않는다.

const FINNHUB = "https://finnhub.io/api/v1";
const KEY = process.env.FINNHUB_API_KEY;
const TIMEOUT = 8000;

async function fh(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${FINNHUB}${path}${sep}token=${KEY}`, { signal: ctrl.signal });
    if (r.status === 429) throw { code: 429, msg: "금융 데이터 요청이 많아요. 잠시 후 다시 시도해 주세요." };
    if (!r.ok) throw { code: 502, msg: `금융 데이터 오류 (${r.status})` };
    return await r.json();
  } finally { clearTimeout(timer); }
}

// SEC EDGAR: 티커 → CIK → 최근 공시 (키 불필요)
let tickerCikMap = null;
async function loadCikMap() {
  if (tickerCikMap) return tickerCikMap;
  const r = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": "ASTRO IRON ironastro93@gmail.com" },
  });
  const j = await r.json();
  tickerCikMap = {};
  for (const k in j) tickerCikMap[j[k].ticker] = String(j[k].cik_str).padStart(10, "0");
  return tickerCikMap;
}
async function getFilings(ticker) {
  try {
    const map = await loadCikMap();
    const cik = map[ticker];
    if (!cik) return [];
    const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "User-Agent": "ASTRO IRON ironastro93@gmail.com" },
    });
    const j = await r.json();
    const rec = j.filings?.recent;
    if (!rec) return [];
    const out = [];
    for (let i = 0; i < rec.form.length && out.length < 5; i++) {
      if (["10-K", "10-Q", "8-K", "S-1", "424B4"].includes(rec.form[i])) {
        out.push({
          type: rec.form[i],
          date: rec.filingDate[i],
          desc: rec.primaryDocDescription[i] || rec.form[i],
          url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${rec.accessionNumber[i].replace(/-/g, "")}/${rec.primaryDocument[i]}`,
        });
      }
    }
    return out;
  } catch { return []; }
}

export default async function handler(req, res) {
  const { type, symbol } = req.query;

  // SEC EDGAR는 Finnhub 키 없이도 동작
  if (type === "filings") {
    if (!/^[A-Z0-9.]{1,6}$/.test(symbol || "")) return res.status(400).json({ error: "잘못된 티커" });
    const filings = await getFilings(symbol.toUpperCase());
    return res.status(200).json({ filings });
  }

  if (!KEY) return res.status(503).json({ error: "금융 데이터 서버가 설정되지 않았어요. 운영자: FINNHUB_API_KEY를 등록해 주세요.", noKey: true });

  try {
    const sym = (symbol || "").toUpperCase();
    const needSym = ["quote", "profile", "candle", "news", "financials", "peers", "dividend"];
    if (needSym.includes(type) && !/^[A-Z0-9.]{1,6}$/.test(sym))
      return res.status(400).json({ error: "티커는 영문·숫자 1~6자로 입력해 주세요." });

    switch (type) {
      case "quote": {
        const q = await fh(`/quote?symbol=${sym}`);
        return res.status(200).json({ symbol: sym, price: q.c, change: q.d, changePercent: q.dp, high: q.h, low: q.l, open: q.o, prevClose: q.pc });
      }
      case "profile": {
        const p = await fh(`/stock/profile2?symbol=${sym}`);
        return res.status(200).json(p);
      }
      case "candle": {
        // 최근 30일 일봉
        const to = Math.floor(Date.now() / 1000);
        const from = to - 60 * 86400;
        const c = await fh(`/stock/candle?symbol=${sym}&resolution=D&from=${from}&to=${to}`);
        if (c.s !== "ok") return res.status(200).json({ candles: [] });
        const candles = c.t.map((t, i) => ({ d: new Date(t * 1000).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" }), c: c.c[i] }));
        return res.status(200).json({ candles: candles.slice(-20) });
      }
      case "news": {
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        const n = await fh(`/company-news?symbol=${sym}&from=${from}&to=${to}`);
        const news = (n || []).slice(0, 8).map((x) => ({ title: x.headline, source: x.source, url: x.url, datetime: x.datetime }));
        return res.status(200).json({ news });
      }
      case "financials": {
        const f = await fh(`/stock/metric?symbol=${sym}&metric=all`);
        const m = f.metric || {};
        return res.status(200).json({ metrics: {
          per: m.peTTM, pbr: m.pbQuarterly, roe: m.roeTTM, eps: m.epsTTM,
          revenueGrowth: m.revenueGrowthTTMYoy, margin: m.netProfitMarginTTM,
          high52: m["52WeekHigh"], low52: m["52WeekLow"], beta: m.beta, dividendYield: m.dividendYieldIndicatedAnnual,
        }});
      }
      case "peers": {
        const p = await fh(`/stock/peers?symbol=${sym}`);
        return res.status(200).json({ peers: (p || []).slice(0, 6) });
      }
      case "indices": {
        // 주요 지수·ETF 프록시 (무료 티어는 지수 직접 조회 제한 → 대표 ETF로 대체)
        const map = [["SPY","S&P 500"],["QQQ","나스닥100"],["DIA","다우존스"],["IWM","러셀2000"]];
        const out = [];
        for (const [s, name] of map) {
          try { const q = await fh(`/quote?symbol=${s}`); out.push({ name, symbol: s, price: q.c, changePercent: q.dp }); }
          catch { out.push({ name, symbol: s, price: null, changePercent: null }); }
        }
        return res.status(200).json({ indices: out });
      }
      default:
        return res.status(400).json({ error: "지원하지 않는 데이터 유형입니다." });
    }
  } catch (e) {
    return res.status(e.code || 500).json({ error: e.msg || "금융 데이터를 불러오지 못했어요." });
  }
}
