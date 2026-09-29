import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect } from "@/lib/mongodb";
import PosPairingCode from "@/lib/models/PosPairingCode";
import { handleApiError, requireAgentTerminal } from "@/lib/api-utils";
import { ApiError } from "@/lib/rbac";

function randomCode(): string {
  return String(crypto.randomInt(100000, 1000000)); // 추측 방지(2026-09-29)
}

// 대표 포스기의 에이전트가 "같은 매장의 다른 단말을 자기가 대신 등록시켜주기" 위해 호출한다
// (LAN에서 발견한 미등록 단말에게 곧바로 전달할 코드를 받아오는 용도, 2026-09-27 설계).
// 매장 관리자가 웹에서 발급하는 것과 같은 코드를 발급하되, 대표 단말만 호출할 수 있다
// (일반 단말이 마음대로 다른 단말을 등록시키지 못하게).
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { terminal, storeId } = await requireAgentTerminal(req);
    if (terminal.isPrimary !== true) throw new ApiError(403, "ONLY_PRIMARY_TERMINAL_CAN_ISSUE_CODE");

    let code = randomCode();
    for (let i = 0; i < 5 && (await PosPairingCode.exists({ code })); i++) {
      code = randomCode();
    }
    await PosPairingCode.create({ code, storeId });

    return NextResponse.json({ ok: true, code, expiresInSec: 600 });
  } catch (e) {
    return handleApiError(e);
  }
}
