// api/push-daily.js — 매일 아침 "브리핑 준비됐어요" 티저 푸시 (무료)
// 흐름: 서비스계정으로 Google OAuth2 토큰 발급 → Firestore의 모든 devices 토큰 수집
//       → data-only FCM 메시지 발송(서버에서 AI 안 돌림 = 추가 비용 0) → 죽은 토큰 정리
// 보호: CRON_SECRET (Vercel Cron 호출 시 Authorization: Bearer <CRON_SECRET> 자동 첨부)
// 필요한 환경변수(Vercel):
//   FIREBASE_SERVICE_ACCOUNT  = 서비스계정 JSON 전체 문자열 (권장)
//     또는 FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (+ FIREBASE_PROJECT_ID)
//   CRON_SECRET               = 아무 긴 랜덤 문자열 (Cron 보호용)
import crypto from "crypto";

const DEFAULT_PID = "astroiron-46437";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadServiceAccount() {
  let sa = null;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    try { sa = JSON.parse(raw); } catch (e) { /* 아래 개별 필드로 폴백 */ }
  }
  if (!sa) {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key = process.env.FIREBASE_PRIVATE_KEY;
    if (email && key) sa = { client_email: email, private_key: key, project_id: process.env.FIREBASE_PROJECT_ID };
  }
  if (!sa || !sa.client_email || !sa.private_key) return null;
  // Vercel 환경변수에 줄바꿈이 \n 문자로 저장된 경우 복원
  sa.private_key = String(sa.private_key).replace(/\\n/g, "\n");
  sa.project_id = sa.project_id || process.env.FIREBASE_PROJECT_ID || DEFAULT_PID;
  return sa;
}

// 서비스계정 → OAuth2 access_token (firebase.messaging + datastore 스코프)
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(claims));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = b64url(signer.sign(sa.private_key));
  const jwt = signingInput + "." + signature;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + encodeURIComponent(jwt),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw new Error("token_exchange_failed:" + (d.error || res.status));
  return d.access_token;
}

// Firestore collection-group 쿼리로 모든 devices 문서(= FCM 토큰) 수집
async function listDeviceTokens(sa, accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "devices", allDescendants: true }] } }),
  });
  const rows = await res.json().catch(() => []);
  if (!res.ok) throw new Error("firestore_query_failed:" + (rows && rows.error && rows.error.message || res.status));
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const name = r && r.document && r.document.name; // .../users/{uid}/devices/{token}
    if (!name) return;
    const token = name.split("/").pop();
    if (token) out.push({ token, docName: name });
  });
  // 토큰 중복 제거
  const seen = {}; const uniq = [];
  out.forEach((x) => { if (!seen[x.token]) { seen[x.token] = 1; uniq.push(x); } });
  return uniq;
}

async function sendOne(sa, accessToken, token, msg) {
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const body = {
    message: {
      token,
      // data-only: SW의 onBackgroundMessage가 단일 알림을 직접 표시(중복 방지)
      data: { title: msg.title, body: msg.body, url: msg.url, type: "morning_brief" },
      webpush: {
        headers: { Urgency: "normal", TTL: "43200" },
        fcmOptions: { link: msg.url },
      },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  const err = await res.json().catch(() => ({}));
  const status = (err && err.error && (err.error.status || err.error.message)) || res.status;
  // 더 이상 유효하지 않은 토큰 → 정리 대상
  const dead = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/i.test(String(status));
  return { ok: false, dead, status };
}

async function deleteDoc(accessToken, docName) {
  try {
    await fetch("https://firestore.googleapis.com/v1/" + docName, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + accessToken },
    });
  } catch (e) { /* best-effort */ }
}

// 동시성 제한 풀
async function pool(items, size, fn) {
  const results = []; let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

export default async function handler(req, res) {
  // ── 인증 ──
  if (process.env.CRON_SECRET) {
    const h = String(req.headers.authorization || "");
    const bearer = h.replace(/^Bearer\s+/i, "");
    const q = (req.query && (req.query.key || req.query.secret)) || "";
    if (bearer !== process.env.CRON_SECRET && q !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const sa = loadServiceAccount();
  if (!sa) {
    return res.status(503).json({
      error: "not_configured",
      hint: "Vercel 환경변수에 FIREBASE_SERVICE_ACCOUNT(JSON 전체) 또는 FIREBASE_CLIENT_EMAIL+FIREBASE_PRIVATE_KEY 를 등록하세요.",
    });
  }

  try {
    const accessToken = await getAccessToken(sa);
    let devices = await listDeviceTokens(sa, accessToken);
    // 1회 실행 토큰 상한(함수 타임아웃 보호)
    const CAP = 1000;
    if (devices.length > CAP) devices = devices.slice(0, CAP);

    const msg = {
      title: "☀️ ASTRO IRON 아침 브리핑",
      body: "밤사이 내 관심종목이 어떻게 움직였는지 3줄로 확인해 보세요 →",
      url: "https://astroiron.com/?src=morning_push",
    };

    if (!devices.length) return res.status(200).json({ ok: true, total: 0, sent: 0, failed: 0, note: "등록된 기기 토큰 없음" });

    let sent = 0, failed = 0, cleaned = 0;
    await pool(devices, 10, async (d) => {
      const r = await sendOne(sa, accessToken, d.token, msg);
      if (r.ok) { sent++; }
      else { failed++; if (r.dead) { cleaned++; await deleteDoc(accessToken, d.docName); } }
    });

    return res.status(200).json({ ok: true, total: devices.length, sent, failed, cleaned });
  } catch (e) {
    return res.status(500).json({ error: "send_failed", detail: String(e && e.message || e) });
  }
}
