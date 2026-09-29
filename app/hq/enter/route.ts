import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getFreshSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import { COMPANY_CONTEXT_COOKIE } from "@/lib/company-context";
import Company from "@/lib/models/Company";

function redirectTo(path: string, companyId?: string) {
  // 상대 경로 리다이렉트 — 프록시 뒤에서도 공개 주소를 그대로 따른다.
  const res = new NextResponse(null, { status: 302, headers: { Location: path } });
  if (companyId) {
    res.cookies.set(COMPANY_CONTEXT_COOKIE, companyId, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  }
  return res;
}

// 본사(소유자)가 고객사를 골라 "고객사 운영자 권한"으로 그 고객사의 관리모드에 들어간다.
// 현재 고객사를 쿠키에 저장하고 /hq 로 보낸다. 링크는 <a>로 걸 것(Link 미리읽기가 쿠키를 바꾸지 않게).
export async function GET(req: Request) {
  const session = await getFreshSession();
  if (!session) return redirectTo("/login");
  if (session.role === "admin") return redirectTo("/hq");
  if (session.role !== "owner") return redirectTo("/me");

  const companyId = new URL(req.url).searchParams.get("companyId") ?? "";
  if (!mongoose.isValidObjectId(companyId)) return redirectTo("/owner");
  await dbConnect();
  if (!(await Company.exists({ _id: companyId }))) return redirectTo("/owner");

  return redirectTo("/hq", companyId);
}
