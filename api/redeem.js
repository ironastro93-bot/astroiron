// ASTRO IRON — Premium 결제 코드 서버 검증 (HMAC 30일 토큰 발급)
// 환경변수(.env / Vercel):
//   PRO_SECRET : 토큰 서명용 비밀키(임의의 긴 문자열)
//   PRO_CODES  : 유효한 해제 코드 목록(쉼표 구분). 예) "ASTRO-AB12,ASTRO-CD34"
// 두 값이 모두 설정돼야 서버 검증이 활성화됩니다. 미설정 시 클라이언트가 기존(레거시) 방식으로 폴백합니다.
import crypto from "crypto";
const SECRET = process.env.PRO_SECRET || "";
const CODES = (process.env.PRO_CODES || "").split(",").map((s) => s.trim()).filter(Boolean);

function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function sign(p) { return b64url(crypto.createHmac("sha256", SECRET).update(p).digest()); }
export function makeToken(days) { const exp = Date.now() + days * 86400000; const p = b64url(JSON.stringify({ exp })); return p + "." + sign(p); }
export function verifyToken(tok) {
  try {
    if (!SECRET || !tok) return false;
    const i = String(tok).indexOf("."); if (i < 0) return false;
    const p = String(tok).slice(0, i), sig = String(tok).slice(i + 1);
    if (!p || !sig || sign(p) !== sig) return false;
    const obj = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    return !!obj.exp && Date.now() < obj.exp;
  } catch { return false; }
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용됩니다." });
  if (!SECRET || !CODES.length) return res.status(503).json({ error: "서버 결제 검증이 설정되지 않았어요.", unconfigured: true });
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const code = String((body && body.code) || "").trim();
  if (!code || !CODES.includes(code)) return res.status(200).json({ ok: false });
  return res.status(200).json({ ok: true, token: makeToken(30), exp: Date.now() + 30 * 86400000 });
}
