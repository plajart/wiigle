import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireSession } from "@/lib/rbac";
import User from "@/lib/models/User";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { checkNewPassword } from "@/lib/password";
import { handleApiError, rateLimit } from "@/lib/api-utils";

// 로그인한 회원이 비밀번호를 바꾼다 — 현재 비밀번호를 한 번 더 확인한다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireSession();
    rateLimit(`pw-change:${session.sub}`, 10, 10 * 60 * 1000);

    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword) return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    const pwError = checkNewPassword(newPassword);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });
    if (currentPassword === newPassword) return NextResponse.json({ error: "SAME_PASSWORD" }, { status: 400 });

    const user = await User.findById(session.sub);
    if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    if (!(await verifyPassword(String(currentPassword), user.passwordHash))) {
      return NextResponse.json({ error: "WRONG_CURRENT_PASSWORD" }, { status: 403 });
    }

    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
