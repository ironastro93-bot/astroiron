// ASTRO IRON — 금융 데이터 서버 (Finnhub + Yahoo + SEC EDGAR)
// 원칙: 실시간 금융 데이터는 AI 없이 공식/무료 API에서 직접 가져온다.
// 시세·차트·검색·대시보드는 Finnhub 키가 없거나 막혀도 Yahoo(무키)로 폴백 → 화면이 "—"로 죽지 않는다.
// [권장] Vercel 환경변수: FINNHUB_API_KEY (뉴스·재무·투자의견·실적용)

const FINNHUB = "https://finnhub.io/api/v1";
const KEY = process.env.FINNHUB_API_KEY;
const TIMEOUT = 8000;
const UA = { "User-Agent": "Mozilla/5.0 ASTRO IRON" };

function withTimeout() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

async function fh(path) {
  const t = withTimeout();
  try {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${FINNHUB}${path}${sep}token=${KEY}`, { signal: t.signal });
    if (r.status === 429) throw { code: 429, msg: "금융 데이터 요청이 많아요. 잠시 후 다시 시도해 주세요." };
    if (!r.ok) throw { code: 502, msg: `금융 데이터 오류 (${r.status})` };
    return await r.json();
  } finally { t.done(); }
}

// ── Yahoo Finance (무료·무키) ─────────────────────────────
async function yahooJson(url) {
  const t = withTimeout();
  try {
    const r = await fetch(url, { signal: t.signal, headers: UA });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
  finally { t.done(); }
}

// Yahoo spark는 한 번에 10개 제한 → 10개씩 나눠 호출
async function sparkOne(symbols) {
  const j = await yahooJson(`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(symbols.join(","))}&range=1d&interval=5m`);
  const out = {};
  if (!j) return out;
  const rows = Array.isArray(j?.spark?.result) ? Object.fromEntries(j.spark.result.map((x) => [x.symbol, x])) : j;
  for (const s of symbols) {
    const row = rows[s];
    if (!row) { out[s] = { price: null, changePercent: null, spark: [] }; continue; }
    const closes = (row.close || []).filter((c) => c != null && !isNaN(c));
    const price = closes.length ? closes[closes.length - 1] : (row.chartPreviousClose ?? null);
    const prev = row.previousClose ?? row.chartPreviousClose ?? null;
    const changePercent = price != null && prev ? ((price - prev) / prev) * 100 : null;
    out[s] = { price, changePercent, spark: closes.slice(-20) };
  }
  return out;
}
async function yahooSpark(symbols) {
  const out = {};
  const chunks = [];
  for (let i = 0; i < symbols.length; i += 10) chunks.push(symbols.slice(i, i + 10));
  const results = await Promise.all(chunks.map((c) => sparkOne(c)));
  for (const r of results) Object.assign(out, r);
  return out;
}

// 단일 종목 시세 (chart meta)
async function yahooQuote(sym) {
  const j = await yahooJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`);
  const m = j?.chart?.result?.[0]?.meta;
  if (!m || m.regularMarketPrice == null) return null;
  const prev = m.chartPreviousClose ?? m.previousClose ?? null;
  const price = m.regularMarketPrice;
  return { price, change: prev != null ? price - prev : null, changePercent: prev ? ((price - prev) / prev) * 100 : null,
    high: m.regularMarketDayHigh ?? null, low: m.regularMarketDayLow ?? null, open: m.regularMarketOpen ?? null, prevClose: prev, name: m.shortName || m.longName || sym };
}

async function yahooSearch(q) {
  const j = await yahooJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`);
  const OK = ["EQUITY", "ETF", "MUTUALFUND", "INDEX"];
  const seen = new Set();
  return (j?.quotes || [])
    .filter((x) => x.symbol && !x.symbol.includes(".") && /^[A-Z0-9-]{1,7}$/.test(x.symbol) && OK.includes(x.quoteType) && (x.exchange !== "PNK"))
    .filter((x) => (seen.has(x.symbol) ? false : (seen.add(x.symbol), true)))
    .slice(0, 10).map((x) => ({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol }));
}

// ── AI 뉴스 센터: 분류·감성·중복제거 헬퍼 ──
function newsCategory(t) {
  const s = (t || "").toLowerCase();
  if (/earnings|eps|revenue|guidance|quarter|results|profit forecast/.test(s)) return "Earnings";
  if (/\bai\b|artificial intelligence|chatgpt|openai|llm|nvidia|generative/.test(s)) return "AI";
  if (/bitcoin|crypto|ethereum|blockchain|\bcoin\b|token/.test(s)) return "Crypto";
  if (/\bfed\b|inflation|\bcpi\b|\bppi\b|\bgdp\b|jobs|unemployment|rate cut|rate hike|treasury|tariff|economy/.test(s)) return "Economy";
  if (/chip|semiconductor|software|cloud|apple|microsoft|google|meta|tech\b/.test(s)) return "Technology";
  return "Market";
}
const NEWS_POS = ["surge","surges","jump","jumps","beat","beats","soar","rally","record","gains","upgrade","growth","strong","profit","wins","rise","rises","boost","tops","outperform"];
const NEWS_NEG = ["fall","falls","drop","drops","plunge","miss","misses","cut","cuts","downgrade","loss","weak","lawsuit","probe","decline","slump","warn","warns","layoff","recall","slides","tumble"];
function newsSentiment(t) {
  const s = (t || "").toLowerCase(); let p = 0, n = 0;
  NEWS_POS.forEach((w) => { if (s.includes(w)) p++; });
  NEWS_NEG.forEach((w) => { if (s.includes(w)) n++; });
  return p > n ? "positive" : n > p ? "negative" : "neutral";
}
function isClickbait(t) { return !t || t.length < 24 || /you won'?t believe|shocking|this one|click here|top \d+ stocks to buy now/i.test(t); }

// ── 키워드 뉴스 (비상장 기업 등): Finnhub 일반뉴스 필터 → Yahoo 폴백 ──
async function keywordNews(q) {
  const kw = (q || "").toLowerCase();
  const terms = kw.includes("spacex")
    ? ["spacex", "starship", "starlink", "falcon", "elon musk"]
    : [kw];
  if (KEY) {
    try {
      const n = await fh(`/news?category=general`);
      const hit = (n || [])
        .filter((x) => { const t = ((x.headline || "") + " " + (x.summary || "")).toLowerCase(); return terms.some((k) => t.includes(k)); })
        .slice(0, 6).map((x) => ({ title: x.headline, source: x.source, url: x.url, datetime: x.datetime }));
      if (hit.length) return hit;
    } catch { /* Yahoo 폴백 */ }
  }
  const j = await yahooJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=6&quotesCount=0`);
  return (j?.news || []).slice(0, 6).map((x) => ({ title: x.title, source: x.publisher, url: x.link, datetime: x.providerPublishTime }));
}

// ── SpaceX 발사 통계 (Launch Library 2, 무키·best-effort) ──
let spacexCache = null, spacexAt = 0;
async function spacexStats() {
  if (spacexCache && Date.now() - spacexAt < 3600000) return spacexCache; // 1시간 캐시
  try {
    const [a, b] = await Promise.all([
      yahooJson("https://ll.thespacedevs.com/2.2.0/launch/?lsp__name=SpaceX&limit=1&mode=list"),
      yahooJson("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?lsp__name=SpaceX&limit=1&mode=list"),
    ]);
    const out = { total: a?.count ?? null, upcoming: b?.count ?? null };
    if (out.total != null) { spacexCache = out; spacexAt = Date.now(); }
    return out;
  } catch { return { total: null, upcoming: null }; }
}

// ── Yahoo 일봉 차트 (우선), Stooq 폴백 ─────────────────────────
async function yahooCandles(sym, period) {
  const map = {
    "1m": ["1d", "1m"], "5m": ["5d", "5m"], "15m": ["1mo", "15m"], "1h": ["3mo", "60m"],
    "1d": ["1y", "1d"], "1w": ["5y", "1wk"], "1mo": ["10y", "1mo"],
    // legacy(스파크라인/구버전 호환)
    "1D": ["1d", "5m"], "1M": ["1mo", "1d"], "3M": ["3mo", "1d"], "1Y": ["1y", "1d"], "5Y": ["5y", "1wk"],
  };
  const [range, interval] = map[period] || map["1d"];
  const mins = interval.endsWith("m");
  const j = await yahooJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`);
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp || [];
  const q = res?.indicators?.quote?.[0] || {};
  const op = q.open || [], hi = q.high || [], lo = q.low || [], cl = q.close || [], vol = q.volume || [];
  let rows = ts.map((t, i) => ({ t, o: op[i], h: hi[i], l: lo[i], c: cl[i], v: vol[i] })).filter((x) => x.c != null && !isNaN(x.c));
  if (!rows.length) return [];
  if (rows.length > 500) rows = rows.slice(rows.length - 500); // 지표 정확도 위해 다운샘플 대신 최근 500개
  const intradayLabel = ["1m", "5m", "15m"].includes(interval);
  return rows.map((x) => {
    const dt = new Date(x.t * 1000);
    const p2 = (n) => String(n).padStart(2, "0");
    let d;
    if (intradayLabel) d = p2(dt.getHours()) + ":" + p2(dt.getMinutes());
    else if (interval === "60m") d = (dt.getMonth() + 1) + "/" + dt.getDate() + " " + p2(dt.getHours()) + "시";
    else if (interval === "1mo") d = String(dt.getFullYear()).slice(2) + "/" + p2(dt.getMonth() + 1);
    else d = (dt.getMonth() + 1) + "/" + dt.getDate();
    return { d, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v || 0 };
  });
}
function ymd(dt) { return dt.toISOString().slice(0, 10).replace(/-/g, ""); }
async function stooqCandles(sym, period) {
  const spanDays = { "1M": 31, "3M": 93, "1Y": 370, "5Y": 1830 }[period] || 93;
  const now = new Date();
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym.toLowerCase())}.us&i=d&d1=${ymd(new Date(now - spanDays * 86400000))}&d2=${ymd(now)}`;
  const t = withTimeout();
  try {
    const r = await fetch(url, { signal: t.signal, headers: UA });
    if (!r.ok) return [];
    const txt = await r.text();
    if (!txt || txt.trim().startsWith("<") || /No data|N\/D/i.test(txt.slice(0, 40))) return [];
    let rows = txt.trim().split("\n").slice(1).map((l) => { const p = l.split(","); return { d: p[0], c: parseFloat(p[4]) }; }).filter((x) => x.d && !isNaN(x.c));
    if (!rows.length) return [];
    const step = Math.max(1, Math.floor(rows.length / 56));
    return rows.filter((_, i) => i % step === 0 || i === rows.length - 1).map((x) => ({ d: x.d.slice(5).replace("-", "/"), c: x.c }));
  } catch { return []; } finally { t.done(); }
}
async function getCandles(sym, period) {
  const y = await yahooCandles(sym, period);
  return y.length ? y : await stooqCandles(sym, period);
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
        out.push({ type: rec.form[i], label: LABEL[rec.form[i]], date: rec.filingDate[i], desc: rec.primaryDocDescription[i] || LABEL[rec.form[i]],
          url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${rec.accessionNumber[i].replace(/-/g, "")}/${rec.primaryDocument[i]}` });
      }
    }
    return out;
  } catch { return []; }
}

// ── 히트맵 목록 ─────────────────────────────
const IDX = [["SPY", "S&P 500"], ["QQQ", "나스닥100"], ["DIA", "다우존스"], ["IWM", "러셀2000"], ["VTI", "미국전체"], ["SCHD", "배당ETF"]];
const MOVERS = [["AAPL", "Apple"], ["MSFT", "Microsoft"], ["NVDA", "NVIDIA"], ["AMZN", "Amazon"], ["GOOGL", "Alphabet"], ["META", "Meta"], ["TSLA", "Tesla"], ["AMD", "AMD"], ["AVGO", "Broadcom"], ["NFLX", "Netflix"], ["PLTR", "Palantir"], ["COIN", "Coinbase"], ["JPM", "JPMorgan"], ["XOM", "Exxon"], ["LLY", "Eli Lilly"], ["WMT", "Walmart"]];
const SECTORS = [["XLK", "기술"], ["XLF", "금융"], ["XLE", "에너지"], ["XLV", "헬스케어"], ["XLY", "임의소비재"], ["XLI", "산업재"], ["XLP", "필수소비재"], ["XLU", "유틸리티"], ["XLB", "소재"], ["XLRE", "리츠"], ["XLC", "통신"]];
const CRYPTO = [["BTC-USD", "Bitcoin", "BTC"], ["ETH-USD", "Ethereum", "ETH"], ["SOL-USD", "Solana", "SOL"]];

const UNIVERSE = [
  ["AAPL","Apple"],["MSFT","Microsoft"],["NVDA","NVIDIA"],["AMZN","Amazon"],["GOOGL","Alphabet"],["META","Meta"],["TSLA","Tesla"],["AVGO","Broadcom"],
  ["AMD","AMD"],["NFLX","Netflix"],["ADBE","Adobe"],["CRM","Salesforce"],["ORCL","Oracle"],["INTC","Intel"],["QCOM","Qualcomm"],["MU","Micron"],
  ["PLTR","Palantir"],["SMCI","Super Micro"],["ARM","Arm"],["TSM","TSMC"],["ASML","ASML"],["MRVL","Marvell"],["NOW","ServiceNow"],["SNOW","Snowflake"],
  ["JPM","JPMorgan"],["BAC","Bank of America"],["V","Visa"],["MA","Mastercard"],["GS","Goldman Sachs"],["MS","Morgan Stanley"],["BRK-B","Berkshire"],["COIN","Coinbase"],
  ["XOM","Exxon"],["CVX","Chevron"],["LLY","Eli Lilly"],["UNH","UnitedHealth"],["JNJ","Johnson & Johnson"],["PFE","Pfizer"],["MRK","Merck"],["ABBV","AbbVie"],
  ["WMT","Walmart"],["COST","Costco"],["HD","Home Depot"],["MCD","McDonald's"],["NKE","Nike"],["SBUX","Starbucks"],["PG","P&G"],["KO","Coca-Cola"],
  ["DIS","Disney"],["UBER","Uber"],["ABNB","Airbnb"],["SHOP","Shopify"],["PYPL","PayPal"],["SQ","Block"],["BA","Boeing"],["CAT","Caterpillar"],
  ["GE","GE Aerospace"],["RTX","RTX"],["LMT","Lockheed"],["RKLB","Rocket Lab"],["MSTR","Strategy"],["RIVN","Rivian"],["F","Ford"],["GM","GM"],
];
const POPULAR = [
  ["NVDA","NVIDIA"],["TSLA","Tesla"],["AAPL","Apple"],["AMD","AMD"],["PLTR","Palantir"],["AMZN","Amazon"],
  ["MSFT","Microsoft"],["META","Meta"],["GOOGL","Alphabet"],["INTC","Intel"],["SMCI","Super Micro"],["COIN","Coinbase"],
  ["MU","Micron"],["AVGO","Broadcom"],["SOFI","SoFi"],["F","Ford"],["BAC","Bank of America"],["NFLX","Netflix"],
  ["UBER","Uber"],["RIVN","Rivian"],["SNAP","Snap"],["PFE","Pfizer"],["T","AT&T"],["DIS","Disney"],
  ["XOM","Exxon"],["WMT","Walmart"],["BABA","Alibaba"],["LCID","Lucid"],
];
async function yahooMeta(sym) {
  const j = await yahooJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`);
  const m = j?.chart?.result?.[0]?.meta;
  if (!m || m.regularMarketPrice == null) return null;
  const prev = m.chartPreviousClose ?? m.previousClose ?? null;
  return { price: m.regularMarketPrice, changePercent: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null, volume: m.regularMarketVolume ?? null };
}
let popCache = null, popAt = 0;
async function popularRanking() {
  if (popCache && Date.now() - popAt < 30000) return popCache; // 30초 캐시(폴링 부하 방지)
  const out = [];
  for (let i = 0; i < POPULAR.length; i += 8) {
    const chunk = POPULAR.slice(i, i + 8);
    const res = await Promise.all(chunk.map(async ([s, name]) => {
      const m = await yahooMeta(s);
      return m ? { symbol: s, name, price: m.price, changePercent: m.changePercent, volume: m.volume } : { symbol: s, name, price: null, changePercent: null, volume: null };
    }));
    out.push(...res);
  }
  const rows = out.filter((x) => x.volume != null).sort((a, b) => b.volume - a.volume);
  if (rows.length) { popCache = rows; popAt = Date.now(); }
  return rows;
}

async function sparkChunked(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 40) {
    const part = await yahooSpark(symbols.slice(i, i + 40));
    Object.assign(out, part);
  }
  return out;
}

async function heatList(list) { // [sym,name] → Yahoo spark 배치
  const sparks = await yahooSpark(list.map((x) => x[0]));
  return list.map(([s, name]) => ({ symbol: s, name, price: sparks[s]?.price ?? null, changePercent: sparks[s]?.changePercent ?? null, spark: sparks[s]?.spark || [] }));
}

export default async function handler(req, res) {
  const { type, symbol, query, resolution } = req.query;
  const sym = (symbol || "").toUpperCase();

  try {
    // ── Finnhub 키 없이도 되는 것들 (Yahoo/SEC) ──
    switch (type) {
      case "filings":
        if (!/^[A-Z0-9.]{1,6}$/.test(sym)) return res.status(400).json({ error: "잘못된 티커" });
        return res.status(200).json({ filings: await getFilings(sym) });
      case "candle":
        if (!/^[A-Z0-9.]{1,6}$/.test(sym)) return res.status(400).json({ error: "티커를 확인해 주세요." });
        return res.status(200).json({ candles: await getCandles(sym, resolution) });
      case "sparkline":
        return res.status(200).json({ spark: (await getCandles(sym, "1M")).map((x) => x.c).slice(-20) });
      case "keyword_news":
        return res.status(200).json({ news: await keywordNews(query || "SpaceX") });
      case "market_news": {
        let items = [];
        if (KEY) {
          try {
            const n = await fh(`/news?category=general`);
            items = (n || []).map((x) => ({ title: x.headline, source: x.source, url: x.url, datetime: x.datetime, related: String(x.related || "").split(",").filter(Boolean).slice(0, 4), image: x.image || "" }));
          } catch { /* Yahoo 폴백 */ }
        }
        if (!items.length) {
          const j = await yahooJson(`https://query1.finance.yahoo.com/v1/finance/search?q=stock%20market&newsCount=25&quotesCount=0`);
          items = (j?.news || []).map((x) => ({ title: x.title, source: x.publisher, url: x.link, datetime: x.providerPublishTime, related: (x.relatedTickers || []).slice(0, 4), image: "" }));
        }
        const seen = new Set(); const out = [];
        for (const it of items) {
          const key = (it.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 42);
          if (!key || seen.has(key) || isClickbait(it.title)) continue;
          seen.add(key);
          out.push({ ...it, category: newsCategory(it.title), sentiment: newsSentiment(it.title) });
        }
        return res.status(200).json({ news: out.slice(0, 40), source: KEY ? "Finnhub" : "Yahoo Finance" });
      }
      case "spacex_stats":
        return res.status(200).json(await spacexStats());
      case "search": {
        if (!query || query.length < 1) return res.status(200).json({ results: [] });
        // Finnhub 우선(키 있을 때) → Yahoo 폴백
        if (KEY) {
          try {
            const r = await fh(`/search?q=${encodeURIComponent(query)}`);
            const OK = ["Common Stock", "ETP", "ETF", "ADR", "REIT", "Preferred Stock"];
            const seen = new Set();
            const results = (r.result || [])
              .filter((x) => x.symbol && !x.symbol.includes(".") && !x.symbol.includes(":") && /^[A-Z0-9-]{1,7}$/.test(x.symbol) && (!x.type || OK.includes(x.type)))
              .filter((x) => (seen.has(x.symbol) ? false : (seen.add(x.symbol), true)))
              .slice(0, 10).map((x) => ({ symbol: x.symbol, name: x.description }));
            if (results.length) return res.status(200).json({ results });
          } catch { /* Yahoo로 폴백 */ }
        }
        return res.status(200).json({ results: await yahooSearch(query) });
      }
      case "quote": {
        if (!/^[A-Z0-9.]{1,6}$/.test(sym)) return res.status(400).json({ error: "티커는 영문·숫자 1~6자로 입력해 주세요." });
        if (KEY) { try { const q = await fh(`/quote?symbol=${sym}`); if (q.c) return res.status(200).json({ symbol: sym, price: q.c, change: q.d, changePercent: q.dp, high: q.h, low: q.l, open: q.o, prevClose: q.pc }); } catch { /* fallback */ } }
        const y = await yahooQuote(sym);
        if (y) return res.status(200).json({ symbol: sym, price: y.price, change: y.change, changePercent: y.changePercent, high: y.high, low: y.low, open: y.open, prevClose: y.prevClose });
        return res.status(200).json({ symbol: sym, price: null });
      }
      case "profile": {
        if (KEY) { try { const p = await fh(`/stock/profile2?symbol=${sym}`); if (p && p.name) return res.status(200).json(p); } catch { /* fallback */ } }
        const y = await yahooQuote(sym);
        return res.status(200).json({ name: y?.name || sym, finnhubIndustry: "", marketCapitalization: null, country: "US" });
      }
      case "indices": return res.status(200).json({ indices: await heatList(IDX) });
      case "movers": { const rows = await heatList(MOVERS); rows.sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999)); return res.status(200).json({ movers: rows }); }
      case "ranking": {
        const rows = await popularRanking(); // 당일 거래량 순
        return res.status(200).json({ ranking: rows, source: "Yahoo Finance", sortBy: "volume", count: rows.length });
      }
      case "sectors": { const rows = await heatList(SECTORS); rows.sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999)); return res.status(200).json({ sectors: rows }); }
      case "crypto": {
        const sparks = await yahooSpark(CRYPTO.map((x) => x[0]));
        return res.status(200).json({ crypto: CRYPTO.map(([s, name, tk]) => ({ name, symbol: tk, price: sparks[s]?.price ?? null, changePercent: sparks[s]?.changePercent ?? null, spark: sparks[s]?.spark || [] })) });
      }
      case "fx": {
        const y = await yahooQuote("KRW=X");
        return res.status(200).json({ usdkrw: y?.price ?? null });
      }
    }

    // ── 여기부터는 Finnhub 전용 (뉴스·재무·투자의견·실적·피어) ──
    if (!KEY) return res.status(503).json({ error: "이 데이터는 FINNHUB_API_KEY 등록 후 표시됩니다. (시세·차트·검색·대시보드는 키 없이도 작동)", noKey: true });
    if (!/^[A-Z0-9.]{1,6}$/.test(sym)) return res.status(400).json({ error: "티커는 영문·숫자 1~6자로 입력해 주세요." });

    switch (type) {
      case "news": {
        const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        const n = await fh(`/company-news?symbol=${sym}&from=${from}&to=${to}`);
        return res.status(200).json({ news: (n || []).slice(0, 10).map((x) => ({ title: x.headline, source: x.source, url: x.url, datetime: x.datetime, image: x.image || "" })) });
      }
      case "financials": {
        const f = await fh(`/stock/metric?symbol=${sym}&metric=all`); const m = f.metric || {};
        return res.status(200).json({ metrics: { per: m.peTTM, pbr: m.pbQuarterly, roe: m.roeTTM, eps: m.epsTTM,
          revenueGrowth: m.revenueGrowthTTMYoy, margin: m.netProfitMarginTTM, high52: m["52WeekHigh"], low52: m["52WeekLow"],
          beta: m.beta, dividendYield: m.dividendYieldIndicatedAnnual, dividendPerShare: m.dividendPerShareAnnual, payoutRatio: m.payoutRatioTTM, dividendGrowth: m.dividendGrowthRate5Y } });
      }
      case "recommend": {
        const r = await fh(`/stock/recommendation?symbol=${sym}`);
        return res.status(200).json({ recommend: (r || []).slice(0, 4).map((x) => ({ period: x.period, strongBuy: x.strongBuy, buy: x.buy, hold: x.hold, sell: x.sell, strongSell: x.strongSell })) });
      }
      case "earnings": {
        const e = await fh(`/stock/earnings?symbol=${sym}`);
        return res.status(200).json({ earnings: (e || []).slice(0, 6).map((x) => ({ period: x.period, quarter: x.quarter, year: x.year, actual: x.actual, estimate: x.estimate, surprise: x.surprise, surprisePercent: x.surprisePercent })) });
      }
      case "peers": return res.status(200).json({ peers: (await fh(`/stock/peers?symbol=${sym}`) || []).slice(0, 6) });
      default: return res.status(400).json({ error: "지원하지 않는 데이터 유형입니다." });
    }
  } catch (e) {
    return res.status(e.code || 500).json({ error: e.msg || "금융 데이터를 불러오지 못했어요." });
  }
}
