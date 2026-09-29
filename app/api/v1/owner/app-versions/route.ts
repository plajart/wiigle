import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { dbConnect } from "@/lib/mongodb";
import { requireOwner } from "@/lib/rbac";
import AppVersion from "@/lib/models/AppVersion";
import { handleApiError } from "@/lib/api-utils";

const RELEASES_DIR = path.join(process.cwd(), "uploads", "app-releases");

// 본사 관리자: 안드로이드 앱(TWA 셀) 새 버전 업로드. 앱 내용(웹페이지)은 항상 실시간으로
// 최신인 것과 별개로, 이 업로드는 껍데기(아이콘·패키지 등) 자체가 바뀌었을 때만 필요하다.
export async function POST(req: Request) {
  try {
    await dbConnect();
    const session = await requireOwner();

    const form = await req.formData();
    const file = form.get("apk");
    const versionName = String(form.get("versionName") || "").trim();
    const changelog = String(form.get("changelog") || "");
    if (!(file instanceof File) || !versionName) {
      return NextResponse.json({ error: "APK_AND_VERSION_NAME_REQUIRED" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".apk")) {
      return NextResponse.json({ error: "APK_FILE_REQUIRED" }, { status: 400 });
    }

    const last = await AppVersion.findOne({ platform: "android" }).sort({ versionCode: -1 }).lean();
    const versionCode = (last?.versionCode ?? 0) + 1;
    const filename = `pointmanager-${versionCode}.apk`;

    await fs.mkdir(RELEASES_DIR, { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(RELEASES_DIR, filename), buf);

    const doc = await AppVersion.create({
      platform: "android",
      versionCode,
      versionName,
      filename,
      changelog,
      uploadedBy: session.sub,
    });

    return NextResponse.json({ ok: true, versionCode: doc.versionCode, versionName: doc.versionName });
  } catch (e) {
    return handleApiError(e);
  }
}

// 본사 관리자: 업로드된 버전 목록(최신순).
export async function GET() {
  try {
    await dbConnect();
    await requireOwner();
    const versions = await AppVersion.find({ platform: "android" }).sort({ versionCode: -1 }).limit(20).lean();
    return NextResponse.json({
      versions: versions.map((v) => ({
        versionCode: v.versionCode,
        versionName: v.versionName,
        changelog: v.changelog || "",
        createdAt: v.createdAt,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
