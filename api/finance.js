// ASTRO IRON — 금융 데이터 서버 (Finnhub + SEC EDGAR + Stooq)
// 원칙: 실시간 금융 데이터는 AI 없이 공식/무료 API에서 직접 가져온다.
// [필수] Vercel 환경변수: FINNHUB_API_KEY (https://finnhub.io)
// 차트(candle)는 Finnhub 무료 티어에서 막혀서 → Stooq(무료·무키)로 대체.

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

// ── Stooq 무료 일봉 (키 불필요) ─────────────────────────────
function ymd(dt) { return dt.toISOString().slice(0, 10).replace(/-/g, ""); }
async function stooqCandles(sym, period) {
  const spanDays = { "1M": 31, "3M": 93, "1Y": 370, "5Y": 1830 }[period] || 93;
  const now = new Date();
  const d1 = ymd(new Date(now.getTime() - spanDays * 86400000)), d2 = ymd(now);
  const s = sym.toLowerCase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}.us&i=d&d1=${d1}&d2=${d2}`;
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 ASTRO IRON" } });
    if (!r.ok) return [];
    const txt = await r.text();
    if (!txt || txt.trim().startsWith("<") || /No data|N\/D/i.test(txt.slice(0, 40))) return [];
    const lines = txt.trim().split("\n");
    if (lines.length < 3) return [];
    let rows = lines.slice(1).map((l) => {
      const p = l.split(",");
      return { d: p[0], c: parseFloat(p[4]) };
    }).filter((x) => x.d && !isNaN(x.c));
    if (!rows.length) return [];
    const step = Math.max(1, Math.floor(rows.length / 56));
    rows = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    return rows.map((x) => ({ d: x.d.slice(5).replace("-", "/"), c: x.c })); // MM/DD
  } catch { return []; }
  finally { clearTimeout(timer); }
}

// ── Yahoo Finance 일봉 (무료·무키, 서버에서 가장 안정적) ──────────
async function yahooCandles(sym, period) {
  const map = { "1M": ["1mo", "1d"], "3M": ["3mo", "1d"], "1Y": ["1y", "1d"], "5Y": ["5y", "1wk"] };
  const [range, interval] = map[period] || map["3M"];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`;
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return [];
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts = res?.timestamp || [];
    const cl = res?.indicators?.quote?.[0]?.close || [];
    let rows = ts.map((t, i) => ({ t, c: cl[i] })).filter((x) => x.c != null && !isNaN(x.c));
    if (!rows.length) return [];
    const step = Math.max(1, Math.floor(rows.length / 56));
    rows = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    return rows.map((x) => {
      const dt = new Date(x.t * 1000);
      return { d: (dt.getMonth() + 1) + "/" + dt.getDate(), c: x.c };
    });
  } catch { return []; }
  finally { clearTimeout(timer); }
}

// Yahoo 우선, 실패 시 Stooq 폴백
async function getCandles(sym, period) {
  const y = await yahooCandles(sym, period);
  if (y.length) return y;
  return await stooqCandles(sym, period);
}

// ── SEC EDGAR 공시 ─────────────────────────────
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
    const LABEL = { "10-K": "연간 보고서", "10-Q": "분기 보고서", "8-K": "수시 공시", "S-1": "상장 신고서", "424B4": "증권 신고서" };
    const out = [];
    for (let i = 0; i < rec.form.length && out.length < 8; i++) {
      if (LABEL[rec.form[i]]) {
        out.push({ type: rec.form[i], label: LABEL[rec.form[i]], date: rec.filingDate[i],
          desc: rec.primaryDocDescription[i] || LABEL[rec.form[i]],
          url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${rec.accessionNumber[i].replace(/-/g, "")}/${rec.primaryDocument[i]}` });
      }
    }
    return out;
  } catch { return []; }
}

// ── 히트맵용 큐레이션 목록 ─────────────────────────────
const MOVERS = [
  ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["NVDA", "NVIDIA"], ["AMZN", "Amazon"],
  ["GOOGL", "Alphabet"], ["META", "Meta"], ["TSLA", "Tesla"], ["AMD", "AMD"],
  ["AVGO", "Broadcom"], ["NFLX", "Netflix"], ["PLTR", "Palantir"], ["COIN", "Coinbase"],
  ["JPM", "JPMorgan"], ["XOM", "Exxon"], ["LLY", "Eli Lilly"], ["WMT", "Walmart"],
];
const SECTORS = [
  ["XLK", "기술"], ["XLF", "금융"], ["XLE", "에너지"], ["XLV", "헬스케어"],
  ["XLY", "임의소비재"], ["XLI", "산업재"], ["XLP", "필수소비재"], ["XLU", "유틸리티"],
  ["XLB", "소재"], ["XLRE", "리츠"], ["XLC", "통신"],
];
async function quotesFor(list) {
  const out = [];
  for (const [s, name] of list) {
    try { const q = await fh(`/quote?symbol=${s}`); out.push({ symbol: s, name, price: q.c, changePercent: q.dp }); }
    catch { out.push({ symbol: s, name, price: null, changePercent: null }); }
  }
  return out;
}

export default async function handler(req, res) {
  const { type, symbol, query, resolution } = req.query;

  if (type === "filings") {
    if (!/^[A-Z0-9.]{1,6}$/.test(symbol || "")) return res.status(400).json({ error: "잘못된 티커" });
    return res.status(200).json({ filings: await getFilings(symbol.toUpperCase()) });
  }
  if (type === "candle") { // Stooq — 키 불필요
    const sym = (symbol || "").toUpperCase();
    if (!/^[A-Z0-9.]{1,6}$/.test(sym)) return res.status(400).json({ error: "티커를 확인해 주세요." });
    return res.status(200).json({ candles: await getCandles(sym, resolution) });
  }

  if (!KEY) return res.status(503).json({ error: "금융 데이터 서버가 설정되지 않았어요. 운영자: FINNHUB_API_KEY를 등록해 주세요.", noKey: true });

  try {
    const sym = (symbol || "").toUpperCase();
    const needSym = ["quote", "profile", "news", "financials", "peers", "sparkline", "recommend", "earnings"];
    if (needSym.includes(type) && !/^[A-Z0-9.]{1,6}$/.test(sym))
      return res.status(400).json({ error: "티커는 영문·숫자 1~6자로 입력해 주세요." });

    switch (type) {
      case "search": {
        if (!query || query.length < 1) return res.status(200).json({ results: [] });
        const r = await fh(`/search?q=${encodeURIComponent(query)}`);
        const OK = ["Common Stock", "ETP", "ETF", "ADR", "REIT", "Preferred Stock", "Mutual Fund"];
        const seen = new Set();
        const results = (r.result || [])
          .filter((x) => x.symbol && !x.symbol.includes(".") && !x.symbol.includes(":") && /^[A-Z0-9-]{1,7}$/.test(x.symbol) && (!x.type || OK.includes(x.type)))
          .filter((x) => (seen.has(x.symbol) ? false : (seen.add(x.symbol), true)))
          .slice(0, 10).map((x) => ({ symbol: x.symbol, name: x.description }));
        return res.status(200).json({ results });
      }
      case "quote": {
        const q = await fh(`/quote?symbol=${sym}`);
        return res.status(200).json({ symbol: sym, price: q.c, change: q.d, changePercent: q.dp, high: q.h, low: q.l, open: q.o, prevClose: q.pc });
      }
      case "profile": return res.status(200).json(await fh(`/stock/profile2?symbol=${sym}`));
      case "news": {
        const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        const n = await fh(`/company-news?symbol=${sym}&from=${from}&to=${to}`);
        return res.status(200).json({ news: (n || []).slice(0, 10).map((x) => ({ title: x.headline, source: x.source, url: x.url, datetime: x.datetime, image: x.image || "" })) });
      }
      case "financials": {
        const f = await fh(`/stock/metric?symbol=${sym}&metric=all`); const m = f.metric || {};
        return res.status(200).json({ metrics: { per: m.peTTM, pbr: m.pbQuarterly, roe: m.roeTTM, eps: m.epsTTM,
          revenueGrowth: m.revenueGrowthTTMYoy, margin: m.netProfitMarginTTM, high52: m["52WeekHigh"], low52: m["52WeekLow"],
          beta: m.beta, dividendYield: m.dividendYieldIndicatedAnnual, dividendPerShare: m.dividendPerShareAnnual,
          payoutRatio: m.payoutRatioTTM, dividendGrowth: m.dividendGrowthRate5Y } });
      }
      case "recommend": {
        const r = await fh(`/stock/recommendation?symbol=${sym}`);
        const rows = (r || []).slice(0, 4).map((x) => ({ period: x.period, strongBuy: x.strongBuy, buy: x.buy, hold: x.hold, sell: x.sell, strongSell: x.strongSell }));
        return res.status(200).json({ recommend: rows });
      }
      case "earnings": {
        const e = await fh(`/stock/earnings?symbol=${sym}`);
        const rows = (e || []).slice(0, 6).map((x) => ({ period: x.period, quarter: x.quarter, year: x.year, actual: x.actual, estimate: x.estimate, surprise: x.surprise, surprisePercent: x.surprisePercent }));
        return res.status(200).json({ earnings: rows });
      }
      case "peers": return res.status(200).json({ peers: (await fh(`/stock/peers?symbol=${sym}`) || []).slice(0, 6) });
      case "indices": {
        return res.status(200).json({ indices: await quotesFor([["SPY", "S&P 500"], ["QQQ", "나스닥100"], ["DIA", "다우존스"], ["IWM", "러셀2000"], ["VTI", "미국전체"], ["SCHD", "배당ETF"]]) });
      }
      case "movers": {
        const rows = await quotesFor(MOVERS);
        rows.sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));
        return res.status(200).json({ movers: rows });
      }
      case "sectors": {
        const rows = await quotesFor(SECTORS);
        rows.sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999));
        return res.status(200).json({ sectors: rows });
      }
      case "crypto": {
        const map = [["BINANCE:BTCUSDT", "Bitcoin", "BTC"], ["BINANCE:ETHUSDT", "Ethereum", "ETH"], ["BINANCE:SOLUSDT", "Solana", "SOL"]];
        const out = [];
        for (const [s, name, tk] of map) { try { const q = await fh(`/quote?symbol=${s}`); out.push({ name, symbol: tk, price: q.c, changePercent: q.dp }); } catch { out.push({ name, symbol: tk, price: null, changePercent: null }); } }
        return res.status(200).json({ crypto: out });
      }
      case "sparkline": {
        const c = await getCandles(sym, "1M");
        return res.status(200).json({ spark: c.map((x) => x.c).slice(-20) });
      }
      default: return res.status(400).json({ error: "지원하지 않는 데이터 유형입니다." });
    }
  } catch (e) {
    return res.status(e.code || 500).json({ error: e.msg || "금융 데이터를 불러오지 못했어요." });
  }
}
