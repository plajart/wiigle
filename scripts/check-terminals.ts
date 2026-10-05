/**
 * 포스 단말기 점검(읽기 전용) — 매장별 포스기 목록과 이름 중복, 오래 응답이 없는 단말을 보여준다. DB를 바꾸지 않는다.
 *
 *   MONGODB_URI="mongodb://..." npx tsx scripts/check-terminals.ts
 *
 * 같은 PC에 설치 파일을 여러 번 받아 설치하면 단말이 여러 개 등록된다(예전 것은 해지 전까지 남음). 응답이 오래 없는 단말은
 * 대시보드에서 "해지"하면 된다.
 */
import mongoose from "mongoose";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI 환경변수가 필요합니다");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB 연결 실패");
  const terminals = await db.collection("posterminals").find().sort({ storeId: 1, registeredAt: 1 }).toArray();
  const stores = new Map((await db.collection("stores").find().project({ name: 1, companyId: 1 }).toArray()).map((s) => [String(s._id), s]));
  const companies = new Map((await db.collection("companies").find().project({ name: 1 }).toArray()).map((c) => [String(c._id), c.name]));

  const byStore = new Map<string, typeof terminals>();
  for (const t of terminals) {
    const k = String(t.storeId);
    byStore.set(k, [...(byStore.get(k) ?? []), t]);
  }
  const now = Date.now();
  for (const [sid, list] of byStore) {
    const s = stores.get(sid);
    console.log(`\n■ ${companies.get(String(s?.companyId)) ?? "(고객사 없음)"} › ${s?.name ?? "(없는 매장)"}  [${sid}]`);
    const names = new Map<string, number>();
    for (const t of list.filter((x) => x.status === "ACTIVE")) names.set(String(t.name), (names.get(String(t.name)) ?? 0) + 1);
    for (const t of list) {
      const seen = t.lastSeenAt ? Math.round((now - new Date(t.lastSeenAt).getTime()) / 60000) : null;
      const flags = [
        t.status !== "ACTIVE" ? "해지됨" : "",
        t.isPrimary ? "대표" : "",
        t.status === "ACTIVE" && (names.get(String(t.name)) ?? 0) > 1 ? "⚠이름중복" : "",
        t.status === "ACTIVE" && (seen === null || seen > 60 * 24) ? "⚠오래 응답 없음" : "",
      ].filter(Boolean);
      console.log(`  ${String(t.name).padEnd(10)} id=${t._id} 등록=${new Date(t.registeredAt).toISOString().slice(0, 16)} 최근응답=${seen === null ? "없음" : seen + "분 전"} ${flags.join(" ")}`);
    }
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
