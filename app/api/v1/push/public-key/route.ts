import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/push";

// 브라우저가 푸시 구독을 만들 때 필요한 공개키. 서버에 푸시 설정이 없으면 503(화면은 조용히 건너뜀).
export async function GET() {
  const publicKey = getVapidPublicKey();
  if (!publicKey) return NextResponse.json({ error: "PUSH_NOT_CONFIGURED" }, { status: 503 });
  return NextResponse.json({ publicKey });
}
