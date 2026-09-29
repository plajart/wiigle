import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect } from "@/lib/mongodb";
import { requireSession, assertStoreScope } from "@/lib/rbac";
import PosPairingCode from "@/lib/models/PosPairingCode";
import { handleApiError } from "@/lib/api-utils";

function randomCode() {
  return String(crypto.randomInt(100000, 1000000)); // 6자리 숫자, 추측 방지(2026-09-29)
}

// 매장 관리자: 새 POS 터미널을 등록하기 위한 1회용 6자리 코드 발급(10분 유효).
// 카운터 단말에 설치한 프로그램에 이 코드를 입력하면 자동으로 이 매장에 연결된다.
export async function POST(_req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    await dbConnect();
    const session = await requireSession();
    const { storeId } = await params;
    await assertStoreScope(session, storeId);

    let code = randomCode();
    // 극히 드문 충돌 방지
    for (let i = 0; i < 5 && (await PosPairingCode.exists({ code })); i++) {
      code = randomCode();
    }

    await PosPairingCode.create({ code, storeId });
    return NextResponse.json({ code, expiresInSec: 600 });
  } catch (e) {
    return handleApiError(e);
  }
}
