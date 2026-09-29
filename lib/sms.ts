import "server-only";

/**
 * 문자(SMS) 발송 어댑터 — 실제 발송 업체(NHN Cloud, Solapi, 알리고 등)는 아직 정해지지 않아서
 * 업체별 코드는 넣지 않고, 환경변수로 가리키는 "발송 게이트웨이"에 JSON을 POST하는 방식만 둔다.
 *
 *   SMS_WEBHOOK_URL    발송 게이트웨이 주소 — 여기에 { to, text }를 POST한다
 *   SMS_WEBHOOK_TOKEN  (선택) 있으면 Authorization: Bearer <값> 으로 보낸다
 *
 * 업체 API가 이 형식과 다르면 이 파일의 sendSms만 그 업체에 맞게 바꾸면 된다(호출하는 쪽은 그대로).
 * 환경변수가 없으면 발송하지 않고 false를 돌려준다 — 인증번호를 로그나 응답에 남기지 않는다.
 */
export async function sendSms(to: string, text: string): Promise<boolean> {
  const url = process.env.SMS_WEBHOOK_URL;
  if (!url) {
    console.warn("[sms] SMS_WEBHOOK_URL이 설정되지 않아 문자를 보내지 못했습니다.");
    return false;
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.SMS_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.SMS_WEBHOOK_TOKEN}`;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ to, text }) });
    if (!res.ok) console.error(`[sms] 발송 게이트웨이 응답 오류: ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error("[sms] 발송 실패", e);
    return false;
  }
}
