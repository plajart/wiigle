/**
 * 통합포인트를 고객사 단위로 나누기 위한 1회성 DB 마이그레이션.
 *
 * 배경: 예전에는 통합포인트(HQ) 계좌가 고객 1명당 전역 1개였고 매장 잔액도 고객사와 무관하게 합쳐 썼다. 이제 통합포인트는
 * 고객사별로 따로 쌓이고, 잔액 합산·차감은 같은 고객사 안에서만 한다(코드: lib/points.ts). 그래서 기존 데이터에
 * 고객사 소속을 채우고, 사용자당 통합포인트를 1개로 묶던 옛 유니크 인덱스를 지운다.
 *
 * ⚠ 반드시 새 앱을 시작하기 **전에** 실행한다(옛 유니크 인덱스가 남아 있으면 두 번째 고객사의 통합포인트 계좌를 만들 수 없다).
 *    scripts/migrate-to-multitenant.ts(고객사·매장 소속 생성)를 먼저 실행한 뒤에 돌릴 것.
 *
 *   MONGODB_URI="mongodb://..." npx tsx scripts/migrate-company-points.ts                              # 미리보기
 *   MONGODB_URI="mongodb://..." npx tsx scripts/migrate-company-points.ts --assign-hq-to="더파티" --apply   # 반영
 *
 * 하는 일(여러 번 실행해도 결과가 같다):
 *  1. 매장 계좌(STORE)·매장이 있는 내역에 그 매장의 고객사(companyId)를 채운다.
 *  2. 기존 통합포인트 계좌(HQ)는 어느 고객사 것인지 알 수 없다. **잔액이 0이 아닌 계좌가 있으면 --assign-hq-to="고객사 이름"이
 *     반드시 필요**하며(미리보기가 대상 수·합계를 알려준다), 그 고객사로 귀속시킨다. 잔액이 0인 옛 계좌는 지운다(필요할 때
 *     앱이 다시 만든다). 통합포인트 지급·조정 내역(매장 없음)도 같은 고객사로 귀속시킨다.
 *  3. 옛 유니크 인덱스(userId_1_storeId_1_type_1)를 지우고 새 인덱스를 만든다.
 * 기본은 미리보기(dry-run)이고 --apply를 붙여야 반영된다. DB 백업 후 실행할 것.
 */
import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");
const assignArg = process.argv.find((a) => a.startsWith("--assign-hq-to="));
const ASSIGN_HQ_TO = assignArg ? assignArg.slice("--assign-hq-to=".length).replace(/^["']|["']$/g, "") : "";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI 환경변수가 필요합니다");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB 연결 실패");
  const accounts = db.collection("pointaccounts");
  const events = db.collection("pointevents");
  const stores = db.collection("stores");
  const companies = db.collection("companies");

  console.log(APPLY ? "== 반영 모드 ==" : "== 미리보기(dry-run) — 반영하려면 --apply ==");

  // 사전 확인: 모든 매장에 고객사가 있어야 한다
  const orphanStores = await stores.countDocuments({ companyId: { $exists: false } });
  if (orphanStores > 0) throw new Error(`고객사가 없는 매장 ${orphanStores}개 — scripts/migrate-to-multitenant.ts를 먼저 실행하세요`);
  const storeCompany = new Map<string, unknown>();
  for (const s of await stores.find({}).project({ companyId: 1 }).toArray()) storeCompany.set(String(s._id), s.companyId);

  // ── 1. 매장 계좌·내역
  const acctNeed = await accounts.find({ type: "STORE", companyId: { $exists: false } }).toArray();
  console.log(`[1] 고객사가 없는 매장 계좌 ${acctNeed.length}개`);
  const evNeed = await events.countDocuments({ storeId: { $ne: null }, companyId: { $exists: false } });
  console.log(`[1] 고객사가 없는 매장 내역 ${evNeed}건`);

  // ── 2. 통합포인트(HQ)
  const hqAll = await accounts.find({ type: "HQ", companyId: { $exists: false } }).toArray();
  const hqNonZero = hqAll.filter((a) => a.balance !== 0);
  const hqSum = hqNonZero.reduce((s, a) => s + a.balance, 0);
  const hqEvents = await events.countDocuments({ storeId: null, companyId: { $exists: false } });
  console.log(`[2] 고객사가 없는 통합포인트 계좌 ${hqAll.length}개(잔액이 0이 아닌 것 ${hqNonZero.length}개, 합계 ${hqSum}P), 통합포인트 내역 ${hqEvents}건`);

  let assignTo: { _id: unknown; name: string } | null = null;
  if (hqNonZero.length > 0 || hqEvents > 0) {
    if (!ASSIGN_HQ_TO) {
      console.log('     → 귀속할 고객사를 알 수 없습니다. --assign-hq-to="고객사 이름" 을 지정해야 반영할 수 있습니다.');
    } else {
      const c = await companies.findOne({ name: ASSIGN_HQ_TO });
      if (!c) throw new Error(`고객사 '${ASSIGN_HQ_TO}'가 없습니다`);
      assignTo = { _id: c._id, name: c.name };
      console.log(`     → '${c.name}' 고객사로 귀속`);
    }
  }

  // ── 3. 인덱스
  const idx = await accounts.indexes();
  const hasOld = idx.some((i) => i.name === "userId_1_storeId_1_type_1");
  console.log(`[3] 옛 유니크 인덱스(userId_1_storeId_1_type_1): ${hasOld ? "있음 → 삭제 예정" : "없음"}`);

  if (!APPLY) {
    if ((hqNonZero.length > 0 || hqEvents > 0) && !assignTo) console.log("미리보기 끝 — 통합포인트 귀속 고객사를 정한 뒤 --assign-hq-to 와 --apply 로 다시 실행하세요");
    else console.log("미리보기 끝 — 내용이 맞으면 --apply 로 다시 실행하세요");
    await mongoose.disconnect();
    return;
  }
  if ((hqNonZero.length > 0 || hqEvents > 0) && !assignTo) {
    throw new Error("통합포인트 귀속 고객사(--assign-hq-to)가 필요합니다 — 아무것도 변경하지 않았습니다");
  }

  // ── 반영
  for (const a of acctNeed) {
    await accounts.updateOne({ _id: a._id }, { $set: { companyId: storeCompany.get(String(a.storeId)) } });
  }
  for (const [sid, cid] of storeCompany) {
    await events.updateMany({ storeId: new mongoose.Types.ObjectId(sid), companyId: { $exists: false } }, { $set: { companyId: cid } });
  }
  if (assignTo) {
    for (const a of hqNonZero) await accounts.updateOne({ _id: a._id }, { $set: { companyId: assignTo._id } });
    await events.updateMany({ storeId: null, companyId: { $exists: false } }, { $set: { companyId: assignTo._id } });
  }
  const del = await accounts.deleteMany({ type: "HQ", companyId: { $exists: false }, balance: 0 });
  console.log(`잔액 0인 옛 통합포인트 계좌 삭제: ${del.deletedCount}개`);

  if (hasOld) await accounts.dropIndex("userId_1_storeId_1_type_1");
  await accounts.createIndex({ userId: 1, storeId: 1, type: 1, companyId: 1 }, { unique: true });
  await accounts.createIndex({ companyId: 1, userId: 1 });
  await events.createIndex({ userId: 1, companyId: 1, occurredAt: -1 });

  const left = await accounts.countDocuments({ companyId: { $exists: false } });
  console.log(left === 0 ? "완료 — 모든 계좌에 고객사가 채워졌습니다." : `⚠ 아직 고객사가 없는 계좌 ${left}개 — 확인 필요`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
