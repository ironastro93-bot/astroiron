import { useState, useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════
//  ASTRO IRON · 미국 주식 시그널
//  수익화 설정 — 아래 두 값만 바꾸면 됩니다.
//  1) PAYMENT_LINK: 토스 송금 링크, Stripe Payment Link,
//     Buy Me a Coffee 등 본인 결제 링크로 교체
//  2) PRO_CODE: 결제한 사람에게 알려줄 해제 코드
// ═══════════════════════════════════════════════════
const PAYMENT_LINK = "https://toss.me/여기에-본인-링크";
// 보안: 해제 코드는 평문 대신 SHA-256 해시로만 저장합니다.
// 코드를 바꾸려면 새 코드의 SHA-256 해시를 여기에 넣으세요.
// (해시 만들기: 브라우저 콘솔에서 아래 한 줄 실행)
// crypto.subtle.digest('SHA-256', new TextEncoder().encode('새코드')).then(b=>console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
// 현재 해시는 "ASTRO-2026"의 해시 — 배포 전 반드시 본인만 아는 코드로 교체!
const PRO_CODE_HASH = "ffda2d0eddb0fe5bc9b31780915fb31a9147d13edef95746a2a564b960dc934b";
const FREE_DAILY_LIMIT = 3;
const PRO_PRICE = "4,900원 · 30일 이용권 (자동결제 없음)";

const C = {
  bg: "#FFFFFF",
  soft: "#F7F8FA",
  line: "#E8EAEE",
  lineDark: "#D8DBE2",
  ink: "#1D2025",
  charcoal: "#26292F",   // 자연스러운 소프트 블랙 (완전 검정 아님)
  charcoalDeep: "#1B1E23",
  sub: "#6B7280",
  faint: "#9CA3AF",
  steel: "#2B3A55",
  up: "#E5484D",
  down: "#3B6FE0",
  hold: "#8A919E",
};

// 자본시장법상 "매수하라/매도하라"는 직접 권유로 해석될 수 있어
// '시장 방향성 신호'를 서술하는 표현으로 구성합니다.
const SIGNAL_META = {
  strong_buy:  { label: "상승 신호 강함", color: C.up },
  buy:         { label: "상승 우위", color: C.up },
  hold:        { label: "중립 · 관망", color: C.hold },
  sell:        { label: "하락 우위", color: C.down },
  strong_sell: { label: "하락 신호 강함", color: C.down },
};

const DIRECTORY = [
  { group: "우주 · 방산", items: [
    { t: "SPCX", n: "SpaceX" }, { t: "RKLB", n: "Rocket Lab" }, { t: "LMT", n: "Lockheed Martin" },
    { t: "BA", n: "Boeing" }, { t: "RTX", n: "RTX" }, { t: "ASTS", n: "AST SpaceMobile" },
  ]},
  { group: "빅테크", items: [
    { t: "AAPL", n: "Apple" }, { t: "MSFT", n: "Microsoft" }, { t: "GOOGL", n: "Alphabet" },
    { t: "AMZN", n: "Amazon" }, { t: "META", n: "Meta" }, { t: "NFLX", n: "Netflix" },
  ]},
  { group: "반도체 · AI", items: [
    { t: "NVDA", n: "NVIDIA" }, { t: "AMD", n: "AMD" }, { t: "TSM", n: "TSMC" },
    { t: "AVGO", n: "Broadcom" }, { t: "MU", n: "Micron" }, { t: "PLTR", n: "Palantir" },
  ]},
  { group: "전기차 · 에너지", items: [
    { t: "TSLA", n: "Tesla" }, { t: "RIVN", n: "Rivian" }, { t: "ENPH", n: "Enphase" }, { t: "XOM", n: "Exxon Mobil" },
  ]},
  { group: "금융 · 크립토", items: [
    { t: "JPM", n: "JPMorgan" }, { t: "V", n: "Visa" }, { t: "COIN", n: "Coinbase" }, { t: "MSTR", n: "Strategy" },
  ]},
];

const LOADING_MSGS = [
  "최신 시세를 확인하고 있어요",
  "최근 뉴스를 모으고 있어요",
  "추세와 모멘텀을 살펴보는 중이에요",
  "매수 · 매도 근거를 정리하고 있어요",
];

// ── 암호화 헬퍼: SHA-256 ──
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── 저장소 헬퍼 (오늘 사용량 · Pro 여부) ──
const todayKey = () => `usage:${new Date().toISOString().slice(0, 10)}`;

async function getUsage() {
  try { const r = await window.storage.get(todayKey()); return parseInt(r?.value || "0", 10) || 0; }
  catch { return 0; }
}
async function addUsage() {
  const n = (await getUsage()) + 1;
  try { await window.storage.set(todayKey(), String(n)); } catch {}
  return n;
}
// Pro 상태도 "1" 같은 단순값이 아니라 코드 해시 자체를 저장하고,
// 불러올 때마다 정답 해시와 대조해서 저장소 조작을 무력화합니다.
async function getPro() {
  try { const r = await window.storage.get("pro"); return r?.value === PRO_CODE_HASH; }
  catch { return false; }
}
async function setPro() {
  try { await window.storage.set("pro", PRO_CODE_HASH); } catch {}
}

async function analyzeTicker(ticker) {
  const prompt = `You are a stock analysis engine. Search the web for the CURRENT, most recent data on the US stock with ticker "${ticker}".

Find: current/latest price, daily change %, recent price trend (1 week / 1 month), notable recent news, and general analyst sentiment.

Then produce a technical + news-based directional signal.

Respond with ONLY a raw JSON object (no markdown, no code fences, no preamble) in this exact schema. All string values in KOREAN except ticker/companyName/asOf:

{
  "ticker": "${ticker}",
  "companyName": "회사명 (영문 그대로)",
  "price": 123.45,
  "changePercent": -1.23,
  "currency": "USD",
  "asOf": "date/time of the price data you found",
  "signal": "strong_buy" | "buy" | "hold" | "sell" | "strong_sell",
  "score": <integer -100 (강한 매도) to 100 (강한 매수)>,
  "summary": "2~3문장 핵심 요약 (한국어)",
  "bullPoints": ["강세 근거 1", "강세 근거 2", "강세 근거 3"],
  "bearPoints": ["약세 근거 1", "약세 근거 2", "약세 근거 3"],
  "news": ["최근 주요 뉴스 한 줄 요약 1", "요약 2", "요약 3"]
}

If the ticker does not exist or you cannot find price data, respond with: {"error": "설명 (한국어)"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });

  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("분석 결과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

// ── 은은한 우주 배경 (저작권 걱정 없는 자체 생성 별밭) ──
function Starfield() {
  const stars = useRef(
    Array.from({ length: 90 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      r: Math.random() * 1.3 + 0.4,
      o: Math.random() * 0.5 + 0.15,
    }))
  ).current;
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      {/* 상단 성운 그라데이션 — 흰 배경으로 자연스럽게 사라짐 */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 460,
        background: `
          radial-gradient(ellipse 90% 60% at 15% -10%, rgba(43,58,85,0.16), transparent 60%),
          radial-gradient(ellipse 70% 50% at 85% -15%, rgba(90,70,140,0.10), transparent 60%),
          linear-gradient(180deg, rgba(24,32,52,0.10) 0%, rgba(255,255,255,0) 85%)
        `,
      }} />
      <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 440 }} viewBox="0 0 100 100" preserveAspectRatio="none">
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.12}
            fill="#2B3A55" opacity={s.o * (1 - s.y / 110)} />
        ))}
      </svg>
    </div>
  );
}

function Gauge({ score, color }) {
  const clamped = Math.max(-100, Math.min(100, score ?? 0));
  const pct = (clamped + 100) / 2;
  return (
    <div style={{ margin: "20px 0 4px" }}>
      <div style={{ position: "relative", height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${C.down}22, ${C.soft} 45%, ${C.soft} 55%, ${C.up}22)`, border: `1px solid ${C.line}` }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, width: 1, left: "50%", background: C.lineDark }} />
        <div style={{
          position: "absolute", left: `calc(${pct}% - 7px)`, top: -4,
          width: 14, height: 14, borderRadius: "50%", background: "#fff",
          border: `4px solid ${color}`, boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
          transition: "left 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 11.5, color: C.faint }}>
        <span>하락 신호</span><span>중립</span><span>상승 신호</span>
      </div>
    </div>
  );
}

function PointList({ title, items, color }) {
  return (
    <div style={{ flex: 1, minWidth: 250 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color, marginBottom: 10 }}>{title}</div>
      {(items || []).map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 9, fontSize: 14, lineHeight: 1.6, color: C.ink, marginBottom: 8 }}>
          <span style={{ color, flexShrink: 0, fontSize: 12, marginTop: 3 }}>●</span>
          <span>{p}</span>
        </div>
      ))}
    </div>
  );
}

// ── Pro 업그레이드 모달 ──
function ProModal({ onClose, onUnlock }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState(false);
  const [checking, setChecking] = useState(false);
  const tryUnlock = async () => {
    if (checking) return;
    setChecking(true);
    const hash = await sha256(code.trim().toUpperCase());
    setChecking(false);
    if (hash === PRO_CODE_HASH) onUnlock();
    else setErr(true);
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(15,20,32,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, maxWidth: 420, width: "100%", padding: "30px 28px", boxShadow: "0 20px 60px rgba(15,20,32,0.25)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.steel, letterSpacing: "0.1em", marginBottom: 6 }}>ASTRO IRON PRO</div>
        <h3 style={{ margin: "0 0 8px", fontSize: 21, fontWeight: 700 }}>오늘의 무료 분석을 모두 썼어요</h3>
        <p style={{ margin: "0 0 18px", fontSize: 14, color: C.sub, lineHeight: 1.65 }}>
          무료는 하루 {FREE_DAILY_LIMIT}회까지예요. Pro로 업그레이드하면 제한 없이 분석할 수 있어요.
        </p>
        <div style={{ background: C.soft, borderRadius: 12, padding: "16px 18px", marginBottom: 18 }}>
          {["무제한 종목 분석", "우선 응답 (대기 없음)", "새 기능 우선 제공"].map((f) => (
            <div key={f} style={{ fontSize: 13.5, color: C.ink, marginBottom: 6, display: "flex", gap: 8 }}>
              <span style={{ color: C.steel }}>✓</span>{f}
            </div>
          ))}
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 10 }}>{PRO_PRICE}</div>
        </div>
        <a href={PAYMENT_LINK} target="_blank" rel="noreferrer"
          style={{ display: "block", textAlign: "center", padding: "13px 0", borderRadius: 10, background: C.charcoal, color: "#fff", fontWeight: 700, fontSize: 14.5, textDecoration: "none", marginBottom: 10 }}>
          결제하고 코드 받기
        </a>
        {/* 전자상거래법 제13조: 거래조건 표시 */}
        <p style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.6, margin: "0 0 14px" }}>
          1회 결제 · 자동결제 없음 · 결제 후 코드 미사용 시 7일 이내 전액 환불 가능 (문의: 하단 이메일)
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={code}
            onChange={(e) => { setCode(e.target.value); setErr(false); }}
            onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
            placeholder="해제 코드 입력"
            style={{ flex: 1, padding: "11px 14px", fontSize: 14, borderRadius: 10, border: `1.5px solid ${err ? C.up : C.lineDark}` }}
          />
          <button onClick={tryUnlock} disabled={checking} style={{ padding: "11px 18px", borderRadius: 10, border: `1px solid ${C.lineDark}`, background: "#fff", fontWeight: 700, fontSize: 13.5, cursor: checking ? "default" : "pointer", color: C.ink }}>
            {checking ? "확인 중" : "확인"}
          </button>
        </div>
        {err && <div style={{ fontSize: 12.5, color: C.up, marginTop: 8 }}>코드가 맞지 않아요. 다시 확인해 주세요.</div>}
        <button onClick={onClose} style={{ marginTop: 16, background: "none", border: "none", color: C.faint, fontSize: 13, cursor: "pointer", padding: 0 }}>
          다음에 할게요
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [usage, setUsage] = useState(0);
  const [isPro, setIsPro] = useState(false);
  const [showPro, setShowPro] = useState(false);
  const timerRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => {
    (async () => {
      setUsage(await getUsage());
      setIsPro(await getPro());
    })();
  }, []);

  useEffect(() => {
    if (loading) timerRef.current = setInterval(() => setMsgIdx((i) => (i + 1) % LOADING_MSGS.length), 2400);
    else { clearInterval(timerRef.current); setMsgIdx(0); }
    return () => clearInterval(timerRef.current);
  }, [loading]);

  const run = async (t) => {
    const symbol = (t || ticker).trim().toUpperCase();
    if (!symbol || loading) return;

    // 보안: 티커는 영문 대문자·숫자·점 1~6자만 허용 (임의 문자열 주입 차단)
    if (!/^[A-Z0-9.]{1,6}$/.test(symbol)) {
      setError("티커는 영문·숫자 1~6자만 입력할 수 있어요. 예) TSLA, SPCX, BRK.B");
      setResult(null);
      return;
    }

    if (!isPro && usage >= FREE_DAILY_LIMIT) { setShowPro(true); return; }

    setTicker(symbol);
    setLoading(true);
    setError(null);
    setResult(null);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    try {
      const data = await analyzeTicker(symbol);
      setResult(data);
      if (!isPro) setUsage(await addUsage());
    } catch (e) {
      setError(e.message || "분석 중 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  };

  const meta = result ? (SIGNAL_META[result.signal] || SIGNAL_META.hold) : null;
  const changeColor = result ? (result.changePercent >= 0 ? C.up : C.down) : C.ink;
  const remaining = Math.max(0, FREE_DAILY_LIMIT - usage);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "'Noto Sans KR', 'Inter', sans-serif", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap');
        * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
        input:focus { outline: none; border-color: ${C.steel} !important; }
        button { font-family: inherit; }
        .tickerBtn:hover { border-color: ${C.steel} !important; background: rgba(247,248,250,0.9) !important; }
        @keyframes pulse { 50% { opacity: 0.35; } }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>

      <Starfield />
      {showPro && <ProModal onClose={() => setShowPro(false)} onUnlock={async () => { await setPro(); setIsPro(true); setShowPro(false); }} />}

      {/* 상단 바 */}
      <nav style={{ borderBottom: `1px solid ${C.line}`, background: "rgba(255,255,255,0.82)", backdropFilter: "blur(8px)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "15px 24px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 27, height: 27, borderRadius: 8, background: C.charcoal, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: "'Inter', sans-serif" }}>AI</div>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", fontFamily: "'Inter', sans-serif", color: C.charcoalDeep }}>ASTRO IRON</span>
          <span style={{ fontSize: 12.5, color: C.faint, marginLeft: 2 }}>미국 주식 시그널</span>
          <div style={{ marginLeft: "auto" }}>
            {isPro ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: C.steel, border: `1px solid ${C.steel}`, borderRadius: 999, padding: "4px 12px" }}>PRO</span>
            ) : (
              <button onClick={() => setShowPro(true)} style={{ fontSize: 12.5, fontWeight: 600, color: C.sub, background: "none", border: `1px solid ${C.line}`, borderRadius: 999, padding: "5px 13px", cursor: "pointer" }}>
                오늘 {remaining}회 남음 · Pro
              </button>
            )}
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "40px 24px 72px", position: "relative", zIndex: 1 }}>
        {/* 인트로 + 검색 */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 25, fontWeight: 700, letterSpacing: "-0.02em", color: C.charcoalDeep }}>
            지금 시장은 어느 쪽을 보고 있을까?
          </h1>
          <p style={{ margin: "0 0 22px", fontSize: 14.5, color: C.sub, lineHeight: 1.65 }}>
            티커를 선택하거나 입력하면 실시간 시세와 뉴스를 모아 상승 · 하락 신호를 정리해 드려요.
          </p>
          <div style={{ display: "flex", gap: 10, maxWidth: 520 }}>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="티커 검색  ·  예) SPCX, TSLA"
              style={{ flex: 1, padding: "12px 16px", fontSize: 15, borderRadius: 10, background: "rgba(255,255,255,0.9)", border: `1.5px solid ${C.lineDark}`, color: C.ink, transition: "border-color 0.15s" }}
            />
            <button
              onClick={() => run()}
              disabled={loading || !ticker.trim()}
              style={{ padding: "12px 26px", fontSize: 14.5, fontWeight: 700, borderRadius: 10, background: loading || !ticker.trim() ? "#B9C0CE" : C.charcoal, color: "#fff", border: "none", cursor: loading || !ticker.trim() ? "default" : "pointer" }}
            >
              분석
            </button>
          </div>
        </div>

        {/* 결과 영역 */}
        <div ref={resultRef}>
          {loading && (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "40px 24px", textAlign: "center", marginBottom: 36, background: "rgba(247,248,250,0.85)" }}>
              <div style={{ fontSize: 14.5, fontWeight: 500, color: C.steel, animation: "pulse 1.6s infinite" }}>
                {LOADING_MSGS[msgIdx]}···
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, color: C.faint }}>실시간 검색 중이라 10~20초 정도 걸려요</div>
            </div>
          )}

          {error && !loading && (
            <div style={{ border: `1px solid ${C.up}55`, background: "#FFF6F6", borderRadius: 14, padding: "18px 22px", fontSize: 14, lineHeight: 1.6, marginBottom: 36 }}>
              <b style={{ color: C.up }}>분석하지 못했어요.</b> {error}
            </div>
          )}

          {result && !loading && (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 16, marginBottom: 42, boxShadow: "0 2px 14px rgba(20,25,40,0.06)", overflow: "hidden", background: "rgba(255,255,255,0.92)" }}>
              <div style={{ padding: "24px 28px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, borderBottom: `1px solid ${C.line}` }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.faint, fontFamily: "'Inter', sans-serif", letterSpacing: "0.04em" }}>{result.ticker}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, fontFamily: "'Inter', sans-serif" }}>{result.companyName}</div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>기준 {result.asOf} · 실제 호가와 차이가 있을 수 있어요</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Inter', sans-serif", letterSpacing: "-0.01em" }}>
                    ${Number(result.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: 15, color: changeColor, fontWeight: 700, fontFamily: "'Inter', sans-serif" }}>
                    {result.changePercent >= 0 ? "▲" : "▼"} {Math.abs(result.changePercent).toFixed(2)}%
                  </div>
                </div>
              </div>

              <div style={{ padding: "24px 28px", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, padding: "5px 12px", borderRadius: 999, background: meta.color + "14", color: meta.color, fontWeight: 700 }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: 13, color: C.faint, fontFamily: "'Inter', sans-serif" }}>
                    score {result.score > 0 ? "+" : ""}{result.score}
                  </span>
                </div>
                <Gauge score={result.score} color={meta.color} />
                <p style={{ margin: "18px 0 0", fontSize: 14.5, lineHeight: 1.75, color: C.ink }}>{result.summary}</p>
              </div>

              <div style={{ padding: "24px 28px", display: "flex", gap: 28, flexWrap: "wrap", borderBottom: `1px solid ${C.line}` }}>
                <PointList title="이런 점은 좋아요" items={result.bullPoints} color={C.up} />
                <PointList title="이런 점은 조심해야 해요" items={result.bearPoints} color={C.down} />
              </div>

              {result.news?.length > 0 && (
                <div style={{ padding: "20px 28px", background: C.soft }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, marginBottom: 10 }}>최근 뉴스</div>
                  {result.news.map((n, i) => (
                    <div key={i} style={{ fontSize: 13.5, lineHeight: 1.65, color: C.sub, marginBottom: 6 }}>· {n}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 종목 디렉토리 */}
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>종목 둘러보기</h2>
          <p style={{ fontSize: 13, color: C.faint, margin: "0 0 20px" }}>누르면 바로 분석이 시작돼요.</p>
          {DIRECTORY.map((g) => (
            <div key={g.group} style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, marginBottom: 10 }}>{g.group}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {g.items.map((s) => (
                  <button
                    key={s.t}
                    className="tickerBtn"
                    onClick={() => run(s.t)}
                    disabled={loading}
                    style={{
                      padding: "8px 14px", fontSize: 13, borderRadius: 10,
                      background: "rgba(255,255,255,0.85)", border: `1px solid ${C.line}`, color: C.ink,
                      cursor: loading ? "default" : "pointer",
                      display: "flex", alignItems: "center", gap: 8,
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <b style={{ fontFamily: "'Inter', sans-serif", fontSize: 12.5 }}>{s.t}</b>
                    <span style={{ color: C.faint }}>{s.n}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 법적 고지 — 차콜 다크 푸터 */}
        <footer style={{ marginTop: 48, borderRadius: 16, background: C.charcoalDeep, color: "#B8BDC7", padding: "26px 28px", fontSize: 12, lineHeight: 1.75 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 20, height: 20, borderRadius: 6, background: "#3A3E46", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: "'Inter', sans-serif" }}>AI</div>
            <span style={{ fontWeight: 700, color: "#E8EAEE", fontFamily: "'Inter', sans-serif", fontSize: 13 }}>ASTRO IRON</span>
          </div>
          <p style={{ margin: "0 0 8px" }}>
            본 서비스의 신호는 공개된 시세와 뉴스를 AI가 자동 요약·해석한 <b style={{ color: "#E8EAEE" }}>참고 지표</b>이며,
            「자본시장법」상 투자자문·투자권유에 해당하지 않습니다. 특정 종목의 매수·매도를 권유하지 않으며,
            수익을 보장하지 않습니다. 투자 판단과 그 결과에 대한 책임은 전적으로 이용자 본인에게 있습니다.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            시세와 뉴스에는 지연·오차가 있을 수 있습니다. 뉴스는 원문을 복제하지 않고 출처 기반으로 요약합니다.
            본 서비스는 회원가입이 없으며 이름·연락처·계좌번호 등 개인정보를 수집하지 않습니다.
          </p>
          <p style={{ margin: 0, color: "#8A8F99" }}>
            문의 · 환불 요청: your-email@example.com (본인 이메일로 교체하세요)
          </p>
        </footer>
      </div>
    </div>
  );
}
