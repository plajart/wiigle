import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { dbConnect } from "@/lib/mongodb";
import AppVersion from "@/lib/models/AppVersion";
import { handleApiError } from "@/lib/api-utils";

const RELEASES_DIR = path.join(process.cwd(), "uploads", "app-releases");

// 공개 — 고객이 다운로드 페이지에서 누르는 .apk 파일 그 자체.
export async function GET(_req: Request, { params }: { params: Promise<{ versionCode: string }> }) {
  try {
    await dbConnect();
    const { versionCode } = await params;
    const doc = await AppVersion.findOne({ platform: "android", versionCode: Number(versionCode) }).lean();
    if (!doc) return NextResponse.json({ error: "VERSION_NOT_FOUND" }, { status: 404 });

    const buf = await fs.readFile(path.join(RELEASES_DIR, doc.filename));
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": `attachment; filename="pointmanager-${doc.versionName}.apk"`,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
