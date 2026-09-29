import "server-only";
import User from "./models/User";

/**
 * CHAMP POS의 카드번호(MEM_CARD_NO)는 매장이 순차 발급한 숫자열(예: 120100000349)이라,
 * 우리 발급분은 그 범위와 절대 겹치지 않도록 "99" 접두사를 쓴다 — 그 외엔 CHAMP 카드번호란에
 * 그대로 스캔해 넣을 수 있도록 순수 숫자 12자리로 맞춘다.
 */
export async function issueDigitalCardNo(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const rand = Math.floor(Math.random() * 1e10)
      .toString()
      .padStart(10, "0");
    const cardNo = `99${rand}`;
    const exists = await User.exists({ digitalCardNo: cardNo });
    if (!exists) return cardNo;
  }
  throw new Error("CARD_NO_GENERATION_FAILED");
}
