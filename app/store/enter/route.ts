import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getSession } from "@/lib/session";
import { dbConnect } from "@/lib/mongodb";
import { STORE_CONTEXT_COOKIE } from "@/lib/store-context";
import Store from "@/lib/models/Store";

function redirectTo(path: string, cookie?: string) {
  // 상대 경로 리다이렉트 — 프록시 뒤에서도 공개 주소를 그대로 따른다.
  const res = new NextResponse(null, { status: 302, headers: { Location: path } });
  if (cookie) {
    res.cookies.set(STORE_CONTEXT_COOKIE, cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  }
  return res;
}

// 운영자(자기 고객사 매장) / 소유자(모든 매장)가 매장을 골라 "매장 관리자 권한"으로 관리모드에 들어간다.
// 현재 매장을 쿠키에 저장하고 /store 로 보낸다. 링크는 <a>로 걸 것(Link 미리읽기가 쿠키를 바꾸지 않게).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return redirectTo("/login");
  if (session.role === "manager") return redirectTo("/store");
  if (session.role !== "owner" && session.role !== "admin") return redirectTo("/me");

  const home = session.role === "owner" ? "/owner" : "/hq";
  const storeId = new URL(req.url).searchParams.get("storeId") ?? "";
  if (!mongoose.isValidObjectId(storeId)) return redirectTo(home);

  await dbConnect();
  const store = await Store.findById(storeId).select("companyId").lean();
  if (!store) return redirectTo(home);
  if (session.role === "admin" && String(store.companyId) !== session.companyAdminOf) return redirectTo(home);

  return redirectTo("/store", storeId);
}
