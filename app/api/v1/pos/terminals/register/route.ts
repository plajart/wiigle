import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect } from "@/lib/mongodb";
import PosPairingCode from "@/lib/models/PosPairingCode";
import PosTerminal from "@/lib/models/PosTerminal";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// POS 단말에 설치한 프로그램이 매장 관리자에게서 받은 6자리 코드로 스스로를 등록한다.
// 인증은 그 코드 자체(1회용·10분 유효)로 하며, 성공 시 앞으로 계속 쓸 apiKey를 발급한다.
// 코드가 6자리(100만 가지)라 무차별 대입 방어로 IP당 요청빈도를 제한한다(2026-09-29).
export async function POST(req: Request) {
  try {
    // 성공이든 실패든(코드가 틀려도) 먼저 카운트 — 실패만 세면 코드를 나눠서 시도하는
    // 우회가 통하므로, 정상적인 설치도 몇 번이면 끝나는 점을 고려해 넉넉히 잡는다.
    rateLimit(`register:${clientIp(req)}`, 10, 10 * 60 * 1000);

    await dbConnect();
    const { code, terminalName } = await req.json();
    if (!code || !terminalName) {
      return NextResponse.json({ error: "CODE_AND_NAME_REQUIRED" }, { status: 400 });
    }

    const pairing = await PosPairingCode.findOne({ code: String(code) });
    if (!pairing) return NextResponse.json({ error: "INVALID_OR_EXPIRED_CODE" }, { status: 404 });

    // 이 매장에 등록되는 첫 단말이면 자동으로 대표 포스기로 지정한다(설계 2026-09-27) —
    // 관리자가 매번 따로 지정할 필요 없이, 매장을 처음 꾸릴 때 바로 관리모드 바로가기가 생긴다.
    const isFirstTerminal = (await PosTerminal.countDocuments({ storeId: pairing.storeId })) === 0;

    const apiKey = crypto.randomBytes(24).toString("hex");
    const terminal = await PosTerminal.create({
      storeId: pairing.storeId,
      name: terminalName,
      apiKey,
      status: "ACTIVE",
      lastSeenAt: new Date(),
      isPrimary: isFirstTerminal,
    });

    await PosPairingCode.deleteOne({ _id: pairing._id }); // 1회용 소모

    return NextResponse.json({ ok: true, terminalId: terminal._id, apiKey, isPrimary: isFirstTerminal });
  } catch (e) {
    return handleApiError(e);
  }
}
