import "server-only";
import webpush from "web-push";

/**
 * 웹 푸시(앱 알림) 발송 어댑터 — 안드로이드 앱(TWA)·크롬·설치형 웹앱으로 알림을 보낸다.
 * 환경변수: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT(예: mailto:관리자@도메인)
 * 키 생성: node -e "const w=require('web-push');console.log(w.generateVAPIDKeys())"
 * 한 번 정한 키는 바꾸면 기존에 등록된 모든 기기의 구독이 무효가 되므로 바꾸지 말 것.
 */
export function isPushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

export function getVapidPublicKey(): string | null {
  return isPushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null;
}

// 클라이언트가 보내온 endpoint로 서버가 요청을 보내므로, 임의 주소로 요청을 유도하는 공격(SSRF)을
// 막기 위해 알려진 푸시 서비스 도메인만 허용한다.
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:") return false;
    return PUSH_HOST_SUFFIXES.some((s) => u.hostname === s || u.hostname.endsWith("." + s));
  } catch {
    return false;
  }
}

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushResult = "ok" | "gone" | "error";

/** 알림 1건 발송. "gone"이면 그 기기 구독이 만료·해지된 것이라 호출한 쪽에서 지우면 된다. */
export async function sendPush(
  target: PushTarget,
  payload: { title: string; body: string; url?: string }
): Promise<PushResult> {
  if (!isPushConfigured()) return "error";
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      {
        TTL: 300,
        urgency: "high",
        vapidDetails: {
          subject: process.env.VAPID_SUBJECT!,
          publicKey: process.env.VAPID_PUBLIC_KEY!,
          privateKey: process.env.VAPID_PRIVATE_KEY!,
        },
      }
    );
    return "ok";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    console.error("[push] 발송 실패", status ?? e);
    return "error";
  }
}
