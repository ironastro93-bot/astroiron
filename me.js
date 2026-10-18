// ASTRO IRON — 계정/Premium 상태 조회 (서버 권위)
// 기존 Firebase 로그인으로 받은 ID 토큰을 서버에서 검증(RS256, Google 공개 인증서)하고,
// Upstash에 저장된 Premium 권한을 읽어, Premium이면 기존 ai.js가 검증하는 HMAC proToken을 발급한다.
//
// Vercel 환경변수(서버 전용):
//   FIREBASE_PROJECT_ID          (예: astroiron-46437)
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//   PRO_SECRET                   (기존 redeem.js와 동일 — proToken 서명)
// 하나라도 없으면 503(unconfigured) → 프런트는 기존(레거시) 방식으로 폴백.
import crypto from "crypto";
import { makeToken } from "./redeem.js";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "";
const UURL = process.env.UPSTASH_REDIS_REST_URL || "";
const UTOK = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let _certs = { at: 0, map: null };
async function googleCerts() {
  if (_certs.map && Date.now() - _certs.at < 3600000) return _certs.map; // 1h 캐시
  const r = await fetch(CERTS_URL);
  if (!r.ok) throw new Error("certs fetch");
  const map = await r.json();
  _certs = { at: Date.now(), map };
  return map;
}
function b64urlToBuf(s) { return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64"); }

// Firebase ID 토큰 검증 → { uid, email } 또는 null
export async function verifyFirebaseIdToken(idToken) {
  if (!idToken || !PROJECT) return null;
  const parts = String(idToken).split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(b64urlToBuf(parts[0]).toString("utf8"));
    payload = JSON.parse(b64urlToBuf(parts[1]).toString("utf8"));
  } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  // 클레임 검증
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== PROJECT) return null;
  if (payload.iss !== "https://securetoken.google.com/" + PROJECT) return null;
  if (!payload.sub) return null;
  if (!(payload.exp > now) || !(payload.iat <= now + 300)) return null;
  // 서명 검증(RS256) — Google x509 인증서의 공개키로
  const certs = await googleCerts();
  const pem = certs[header.kid];
  if (!pem) return null;
  let pub;
  try { pub = new crypto.X509Certificate(pem).publicKey; } catch { return null; }
  const signed = parts[0] + "." + parts[1];
  const ok = crypto.verify("RSA-SHA256", Buffer.from(signed), pub, b64urlToBuf(parts[2]));
  if (!ok) return null;
  return { uid: payload.sub, email: payload.email || "" };
}

// Upstash REST: 단일 명령(JSON 배열)을 POST → { result }
export async function upstash(cmd) {
  const r = await fetch(UURL, {
    method: "POST",
    headers: { Authorization: "Bearer " + UTOK, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("upstash " + r.status);
  const j = await r.json();
  return j.result;
}
export async function readUntil(uid) {
  const v = await upstash(["GET", "ent:" + uid]);
  return v ? Number(v) : 0;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!PROJECT || !UURL || !UTOK || !process.env.PRO_SECRET) {
    return res.status(503).json({ error: "계정 시스템이 설정되지 않았어요.", unconfigured: true });
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "로그인이 필요해요." });
  try {
    const user = await verifyFirebaseIdToken(token);
    if (!user) return res.status(401).json({ error: "세션이 유효하지 않아요." });
    const until = await readUntil(user.uid);
    const premium = !!until && Date.now() < until;
    const out = { email: user.email, premium, premiumUntil: until || null };
    if (premium) {
      const daysLeft = Math.max(1, Math.ceil((until - Date.now()) / 86400000));
      out.proToken = makeToken(daysLeft, user.uid); // ai.js가 검증하는 토큰(uid 포함 → per-account 공정사용)
      out.exp = until;
    }
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "조회 중 오류가 발생했어요." });
  }
}
