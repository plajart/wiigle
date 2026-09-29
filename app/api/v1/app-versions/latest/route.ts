import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import AppVersion from "@/lib/models/AppVersion";
import { handleApiError } from "@/lib/api-utils";

// 공개 — 안드로이드 앱(TWA 셀)이 실행될 때 "새 껍데기 버전이 있는지" 확인하는 용도.
// 앱 내용(웹페이지)은 항상 최신이라 이건 껍데기 자체가 바뀌었을 때만 의미가 있다.
export async function GET() {
  try {
    await dbConnect();
    const latest = await AppVersion.findOne({ platform: "android" }).sort({ versionCode: -1 }).lean();
    if (!latest) return NextResponse.json({ exists: false });
    return NextResponse.json({
      exists: true,
      versionCode: latest.versionCode,
      versionName: latest.versionName,
      changelog: latest.changelog || "",
      downloadUrl: `/api/v1/app-versions/${latest.versionCode}/download`,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
