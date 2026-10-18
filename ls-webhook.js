// ASTRO IRON — Lemon Squeezy(결제대행/MoR) 웹훅 → Premium 권한 부여(서버 검증, Upstash 저장)
// 흐름: LS 결제 완료 → 서명된 이벤트 수신 → HMAC 서명 검증 → 멱등(이벤트 1회만) →
//       구매자 Firebase uid(checkout custom)에 Premium 만료일 가산. "완료 페이지 도달"이 아니라
//       서명·금액·상품을 서버에서 검증한 경우에만 지급.
//
// Vercel 환경변수(서버 전용):
//   LEMONSQUEEZY_WEBHOOK_SECRET            (LS 대시보드 Webhook signing secret)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//   (선택) LS_VARIANT_30 / LS_VARIANT_90 / LS_VARIANT_365  = variant id → 일수
// Paddle 등 다른 MoR로 교체 시 verifySig()/parseEvent()만 교체.
import crypto from "crypto";

export const config = { api: { bodyParser: false } }; // 원문(raw) 서명 검증

const SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "";
const UURL = process.env.UPSTASH_REDIS_REST_URL || "";
const UTOK = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const VAR_DAYS = {
  [process.env.LS_VARIANT_30 || "__30"]: 30,
  [process.env.LS_VARIANT_90 || "__90"]: 90,
  [process.env.LS_VARIANT_365 || "__365"]: 365,
};
const EVT_TTL = 60 * 60 * 24 * 120; // 멱등키 보관 120일

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function verifySig(raw, sigHex) {
  if (!SECRET || !sigHex) return false;
  const digest = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  const a = Buffer.from(digest, "utf8"), b = Buffer.from(String(sigHex), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function daysFor(variantId) {
  if (variantId && VAR_DAYS[String(variantId)]) return VAR_DAYS[String(variantId)];
  return 30; // 단건/구독 1주기 기본 30일
}
export async function upstash(cmd) {
  const r = await fetch(UURL, {
    method: "POST",
    headers: { Authorization: "Bearer " + UTOK, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("upstash " + r.status);
  return (await r.json()).result;
}

export function parseEvent(evt, headerEventName) {
  const meta = evt.meta || {};
  const data = evt.data || {};
  const attr = data.attributes || {};
  const custom = meta.custom_data || {};
  return {
    eventName: headerEventName || meta.event_name || "",
    eventId: String(data.id || meta.webhook_id || ""),  // 멱등키
    userId: custom.user_id || "",                        // checkout custom으로 전달한 Firebase uid
    variantId: attr.variant_id || (attr.first_order_item && attr.first_order_item.variant_id) || "",
    status: attr.status || "",
    totalCents: attr.total || (attr.first_order_item && attr.first_order_item.price) || 0,
  };
}

// 멱등 + 만료일 가산. 반환: {duplicate} 또는 {granted, until}
export async function grant(uid, days, ev) {
  // SET evt:<id> "1" NX EX ttl → 처음이면 "OK", 이미 있으면 null(=중복)
  const first = await upstash(["SET", "evt:" + ev.eventId, "1", "NX", "EX", EVT_TTL]);
  if (first !== "OK") return { duplicate: true };
  const cur = Number(await upstash(["GET", "ent:" + uid])) || 0;
  const base = Math.max(cur, Date.now());
  const until = base + days * 86400000;
  await upstash(["SET", "ent:" + uid, String(until)]);
  // 주문 로그(선택, 조회용)
  try { await upstash(["LPUSH", "orders:" + uid, JSON.stringify({ id: ev.eventId, kind: ev.eventName, amount: ev.totalCents, days, at: Date.now() })]); } catch (e) {}
  return { granted: true, until };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!SECRET || !UURL || !UTOK) return res.status(503).json({ error: "unconfigured" });
  let raw;
  try { raw = await readRaw(req); } catch { return res.status(400).json({ error: "bad body" }); }
  if (!verifySig(raw, req.headers["x-signature"] || "")) return res.status(401).json({ error: "bad signature" });
  let evt; try { evt = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "bad json" }); }
  const ev = parseEvent(evt, req.headers["x-event-name"]);
  const payEvents = ["order_created", "subscription_payment_success"];
  if (!payEvents.includes(ev.eventName)) return res.status(200).json({ ignored: ev.eventName });
  if (!ev.userId) return res.status(200).json({ ignored: "no user_id" });
  if (ev.status && !/paid|active|success/i.test(ev.status)) return res.status(200).json({ ignored: "status " + ev.status });
  try {
    return res.status(200).json(await grant(ev.userId, daysFor(ev.variantId), ev));
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
