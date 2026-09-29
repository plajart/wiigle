import "server-only";
import crypto from "crypto";

/**
 * 실제 SMS 발송 연동 전까지의 임시 구현 — 코드 자체는 항상 crypto로 안전하게 생성한다.
 * 발급된 코드를 화면/응답으로 돌려주지 않는다(2026-09-29 보안점검: 예전엔 응답에 그대로
 * 내려줘서 아무나 남의 전화번호로 인증을 완료시킬 수 있었음) — 실제 SMS 연동 전까지는
 * 개발자가 DB(pendingcustomersignups.otpCode)를 직접 확인해서 검증한다.
 * 운영 배포 전 실제 SMS 프로바이더(예: NHN Cloud, Twilio 등) 연동으로 교체 필요.
 */
export function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}
