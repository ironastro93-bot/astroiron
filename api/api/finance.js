// ASTRO IRON — 금융 데이터 서버 (Finnhub + SEC EDGAR)
// 원칙: 실시간 금융 데이터는 AI를 호출하지 않고 공식 API에서 직접 가져온다.
// [필수] Vercel 환경변수: FINNHUB_API_KEY = 무료 키 (https://finnhub.io)

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

let tickerCikMap = null;
async function loadCikMap() {
  if (tickerCikMap) return tickerCikMap;
  const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": "ASTRO IRON ironastro93@gmail.com" } });
  const j = await r.json();
  tickerCikMap = {};
  for (const k in j) tickerCikMap[j[k].ticker] = String(j[k].cik_str).padStart(10, "0");
  return tickerCikMap;
}
async function getFilings(ticker) {
  try {
    const map = await loadCikMap(); const cik = map[ticker];
    if (!cik) return [];
    const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": "ASTRO IRON ironastro93@gmail.com" } });
    const j = await r.json(); const rec = j.filings?.recent; if (!rec) return [];
    const out = [];
    for (let i = 0; i < rec.form.length && out.length < 5; i++) {
      if (["10-K", "10-Q", "8-K", "S-1", "424B4"].includes(rec.form[i])) {
        out.push({ type: rec.form[i], date: rec.filingDate[i], desc: rec.primaryDocDescription[i] || rec.form[i],
          url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${rec.accessionNumber[i].replace(/-/g, "")}/${rec.primaryDocument[i]}` });
      }
    }
    return out;
  } catch { return []; }
}

export default async function handler(req, res) {
  const { type, symbol, query, resolution } = req.query;

  if (type === "filings") {
    if (!/^[A-Z0-9.]{1,6}$/.test(symbol || "")) return res.status(400).json({ error: "잘못된 티커" });
    return res.status(200).json({ filings: await getFilings(symbol.toUpperCase()) });
  }

  if (!KEY) return res.status(503).json({ error: "금융 데이터 서버가 설정되지 않았어요. 운영자: FINNHUB_API_KEY를 등록해 주세요.", noKey: true });

  try {
    const sym = (symbol || "").toUpperCase();
    const needSym = ["quote", "profile", "candle", "news", "financials", "peers", "sparkline"];
    if (needSym.includes(type) && !/^[A-Z0-9.]{1,6}$/.test(sym))
      return res.status(400).json({ error: "티커는 영문·숫자 1~6자로 입력해 주세요." });

    switch (type) {
      case "search": {
        // 티커 자동완성 (TSL → Tesla)
        if (!query || query.length < 1) return res.status(200).json({ results: [] });
        const r = await fh(`/search?q=${encodeURIComponent(query)}`);
        const results = (r.result || []).filter((x) => /^[A-Z0-9.]{1,6}$/.test(x.symbol) && x.type === "Common Stock" || x.type === "ETP")
          .slice(0, 8).map((x) => ({ symbol: x.symbol, name: x.description }));
        return res.status(200).json({ results });
      }
      case "quote": {
        const q = await fh(`/quote?symbol=${sym}`);
        return res.status(200).json({ symbol: sym, price: q.c, change: q.d, changePercent: q.dp, high: q.h, low: q.l, open: q.o, prevClose: q.pc });
      }
      case "profile": return res.status(200).json(await fh(`/stock/profile2?symbol=${sym}`));
      case "candle": {
        const reso = ["D", "W", "M", "60"].includes(resolution) ? resolution : "D";
        const days = reso === "M" ? 1825 : reso === "W" ? 730 : reso === "60" ? 30 : 120;
        const to = Math.floor(Date.now() / 1000), from = to - days * 86400;
        const c = await fh(`/stock/candle?symbol=${sym}&resolution=${reso}&from=${from}&to=${to}`);
        if (c.s !== "ok") return res.status(200).json({ candles: [] });
        const candles = c.t.map((t, i) => ({ d: new Date(t * 1000).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" }), c: c.c[i] }));
        const step = Math.max(1, Math.floor(candles.length / 40));
        return res.status(200).json({ candles: candles.filter((_, i) => i % step === 0 || i === candles.length - 1) });
      }
      case "news": {
        const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        const n = await fh(`/company-news?symbol=${sym}&from=${from}&to=${to}`);
        return res.status(200).json({ news: (n || []).slice(0, 8).map((x) => ({ title: x.headline, source: x.source, url: x.url, datetime: x.datetime })) });
      }
      case "financials": {
        const f = await fh(`/stock/metric?symbol=${sym}&metric=all`); const m = f.metric || {};
        return res.status(200).json({ metrics: { per: m.peTTM, pbr: m.pbQuarterly, roe: m.roeTTM, eps: m.epsTTM,
          revenueGrowth: m.revenueGrowthTTMYoy, margin: m.netProfitMarginTTM, high52: m["52WeekHigh"], low52: m["52WeekLow"],
          beta: m.beta, dividendYield: m.dividendYieldIndicatedAnnual } });
      }
      case "peers": return res.status(200).json({ peers: (await fh(`/stock/peers?symbol=${sym}`) || []).slice(0, 6) });
      case "indices": {
        const map = [["SPY", "S&P 500"], ["QQQ", "나스닥100"], ["DIA", "다우존스"], ["IWM", "러셀2000"], ["VTI", "미국전체"], ["SCHD", "배당ETF"]];
        const out = [];
        for (const [s, name] of map) { try { const q = await fh(`/quote?symbol=${s}`); out.push({ name, symbol: s, price: q.c, changePercent: q.dp }); } catch { out.push({ name, symbol: s, price: null, changePercent: null }); } }
        return res.status(200).json({ indices: out });
      }
      case "crypto": {
        const map = [["BINANCE:BTCUSDT", "Bitcoin", "BTC"], ["BINANCE:ETHUSDT", "Ethereum", "ETH"], ["BINANCE:SOLUSDT", "Solana", "SOL"]];
        const out = [];
        for (const [s, name, sym] of map) { try { const q = await fh(`/quote?symbol=${s}`); out.push({ name, symbol: sym, price: q.c, changePercent: q.dp }); } catch { out.push({ name, symbol: sym, price: null, changePercent: null }); } }
        return res.status(200).json({ crypto: out });
      }
      case "forex": {
        // 무료 티어 환율: OANDA 프록시 심볼 사용 (제한 시 null)
        const map = [["OANDA:USD_KRW", "USD/KRW"], ["OANDA:USD_JPY", "USD/JPY"], ["OANDA:EUR_USD", "EUR/USD"]];
        const out = [];
        for (const [s, name] of map) { try { const q = await fh(`/quote?symbol=${s}`); out.push({ name, price: q.c, changePercent: q.dp }); } catch { out.push({ name, price: null, changePercent: null }); } }
        return res.status(200).json({ forex: out });
      }
      case "sparkline": {
        // 카드용 미니 차트 (최근 종가 20개)
        const to = Math.floor(Date.now() / 1000), from = to - 30 * 86400;
        const c = await fh(`/stock/candle?symbol=${sym}&resolution=D&from=${from}&to=${to}`);
        if (c.s !== "ok") return res.status(200).json({ spark: [] });
        return res.status(200).json({ spark: c.c.slice(-20) });
      }
      default: return res.status(400).json({ error: "지원하지 않는 데이터 유형입니다." });
    }
  } catch (e) {
    return res.status(e.code || 500).json({ error: e.msg || "금융 데이터를 불러오지 못했어요." });
  }
}
