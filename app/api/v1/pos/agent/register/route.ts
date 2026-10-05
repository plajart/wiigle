import { NextResponse } from "next/server";
import crypto from "crypto";
import { dbConnect } from "@/lib/mongodb";
import PosProvisionToken, { hashProvisionToken } from "@/lib/models/PosProvisionToken";
import PosTerminal from "@/lib/models/PosTerminal";
import Store from "@/lib/models/Store";
import { handleApiError, clientIp, rateLimit } from "@/lib/api-utils";

// 다운로드한 포스 프로그램이 처음 실행될 때, 압축파일에 내장된 1회용 설치 토큰으로 스스로를
// 이 매장의 단말로 등록한다(사람이 입력하는 인증코드 없음). 토큰은 256비트 난수라 추측이
// 불가능하지만, 잘못된 요청을 반복하는 것을 막기 위해 IP당 요청빈도는 제한한다.
export async function POST(req: Request) {
  try {
    rateLimit(`agent-register:${clientIp(req)}`, 20, 10 * 60 * 1000);

    await dbConnect();
    const { token } = await req.json();
    if (!token) {
      return NextResponse.json({ error: "TOKEN_REQUIRED" }, { status: 400 });
    }

    // 조회와 삭제를 한 번에(원자적) — 같은 토큰으로 동시에 두 번 등록되는 것을 막는다.
    const provision = await PosProvisionToken.findOneAndDelete({ tokenHash: hashProvisionToken(String(token)) });
    if (!provision) return NextResponse.json({ error: "INVALID_OR_EXPIRED_TOKEN" }, { status: 404 });

    const store = await Store.findById(provision.storeId).select("name").lean();
    if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

    // 이 매장에 "사용 중인 대표 포스기"가 아직 없으면 자동으로 대표가 된다 — 매장의 첫 단말이거나, 대표를 해지한 뒤
    // 새로 등록하는 경우. 이미 대표가 있으면 나머지 단말은 적립·사용만 한다.
    const hasPrimary = await PosTerminal.exists({ storeId: provision.storeId, status: "ACTIVE", isPrimary: true });
    const isFirstTerminal = !hasPrimary;

    // 단말 이름은 등록 순서대로 POS001, POS002… 로 서버가 정한다(매장 관리모드 대시보드에서 바꿀 수 있다).
    const existingNames = await PosTerminal.find({ storeId: provision.storeId }).select("name").lean();
    let maxNo = 0;
    for (const t of existingNames) {
      const m = /^POS(\d{3,})$/.exec(t.name);
      if (m) maxNo = Math.max(maxNo, Number(m[1]));
    }
    const assignedName = `POS${String(maxNo + 1).padStart(3, "0")}`;

    const apiKey = crypto.randomBytes(24).toString("hex");
    const terminal = await PosTerminal.create({
      storeId: provision.storeId,
      name: assignedName,
      apiKey,
      status: "ACTIVE",
      lastSeenAt: new Date(),
      isPrimary: isFirstTerminal,
    });

    return NextResponse.json({
      ok: true,
      terminalId: terminal._id,
      apiKey,
      isPrimary: isFirstTerminal,
      storeName: store.name,
      terminalName: assignedName,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
