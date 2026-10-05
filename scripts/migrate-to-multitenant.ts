/**
 * 다단계 권한(owner/admin/manager/user) + 고객사(Company) 도입에 따른 1회성 DB 마이그레이션.
 *
 * 실행은 반드시 운영 서버에서 사람이 직접 한다(이 스크립트는 작성만 되어 있고 어디서도 자동
 * 실행되지 않는다). 기본은 미리보기(dry-run)이고, 실제로 반영하려면 --apply를 붙인다.
 *
 *   MONGODB_URI="mongodb://..." npx tsx scripts/migrate-to-multitenant.ts           # 미리보기
 *   MONGODB_URI="mongodb://..." npx tsx scripts/migrate-to-multitenant.ts --apply    # 반영
 *
 * 하는 일(여러 번 실행해도 결과가 같도록 멱등):
 *  1. Company 문서 생성: "더파티", "반들한식뷔페" (같은 이름이 이미 있으면 재사용)
 *  2. 기존 매장 "더파티 시청점" → 더파티, "반들한식뷔페" → 반들한식뷔페 (companyId가 아직 없을 때만)
 *  3. 기존 isHqAdmin:true 유저 → role:"owner"
 *  4. 기존 storeAdminOf 유저 → role:"manager", storeManagerOf: 같은 값
 *
 * 옛 필드(isHqAdmin, storeAdminOf)는 지우지 않는다 — 문제가 생겨 되돌려야 할 때 근거가 되도록
 * 남겨두고, 새 코드는 이 필드를 읽지 않으므로 무해하다. 정리는 안정화 후 별도로 한다.
 *
 * 컬렉션에 직접 접근한다(모델 스키마에서 옛 필드가 빠졌기 때문).
 */
import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");

const COMPANIES = ["더파티", "반들한식뷔페"];
// 매장 이름 → 소속시킬 고객사 이름
const STORE_TO_COMPANY: Record<string, string> = {
  "더파티 시청점": "더파티",
  "반들한식뷔페": "반들한식뷔페",
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI 환경변수가 필요합니다");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB 연결 실패");
  const companies = db.collection("companies");
  const stores = db.collection("stores");
  const users = db.collection("users");

  console.log(APPLY ? "== 반영 모드 ==" : "== 미리보기(dry-run) — 반영하려면 --apply ==");

  // 1. 고객사
  const companyIds = new Map<string, mongoose.Types.ObjectId>();
  for (const name of COMPANIES) {
    const existing = await companies.findOne({ name });
    if (existing) {
      companyIds.set(name, existing._id as mongoose.Types.ObjectId);
      console.log(`고객사 '${name}' 이미 있음 (${existing._id})`);
    } else if (APPLY) {
      const r = await companies.insertOne({ name, createdAt: new Date() });
      companyIds.set(name, r.insertedId as unknown as mongoose.Types.ObjectId);
      console.log(`고객사 '${name}' 생성 (${r.insertedId})`);
    } else {
      console.log(`고객사 '${name}' 생성 예정`);
    }
  }

  // 2. 매장 → 고객사
  for (const [storeName, companyName] of Object.entries(STORE_TO_COMPANY)) {
    const matched = await stores.find({ name: storeName }).toArray();
    if (matched.length === 0) console.log(`매장 '${storeName}' 없음 — 건너뜀`);
    if (matched.length > 1) console.log(`경고: 매장 '${storeName}'이 ${matched.length}개 — 모두 같은 고객사로 처리`);
    for (const s of matched) {
      if (s.companyId) {
        console.log(`매장 '${storeName}'(${s._id}) 이미 고객사 지정됨 — 건너뜀`);
        continue;
      }
      const companyId = companyIds.get(companyName);
      if (APPLY && companyId) {
        await stores.updateOne({ _id: s._id, companyId: { $exists: false } }, { $set: { companyId } });
        console.log(`매장 '${storeName}'(${s._id}) → 고객사 '${companyName}'`);
      } else {
        console.log(`매장 '${storeName}'(${s._id}) → 고객사 '${companyName}' 예정`);
      }
    }
  }
  const orphan = await stores.countDocuments({ companyId: { $exists: false } });
  if (orphan > 0) console.log(`주의: 위 처리 후에도 고객사가 없는 매장 ${orphan}개 (companyId는 필수 필드) — 수동 지정 필요`);

  // 3. 옛 플랫폼 관리자(isHqAdmin) → owner(본사)
  // 이미 고객사 운영자(companyAdminOf)나 매장 관리자(storeManagerOf)로 지정된 계정은 옛 isHqAdmin 표시가 남아 있어도 소유자로 올리지 않는다
  // (최상위 권한이므로, 소유자는 setup-accounts.ts 가 정한 계정으로만 둔다).
  const hqFilter = { isHqAdmin: true, role: { $nin: ["owner", "admin", "manager"] }, companyAdminOf: { $in: [null] }, storeManagerOf: { $in: [null] } };
  const hqCount = await users.countDocuments(hqFilter);
  console.log(`isHqAdmin 유저 → owner: ${hqCount}명`);
  if (APPLY && hqCount > 0) await users.updateMany(hqFilter, { $set: { role: "owner" } });

  // 4. 옛 매장 관리자 → manager
  const storeAdminFilter = { storeAdminOf: { $exists: true, $ne: null }, role: { $nin: ["owner", "manager"] } };
  const saCount = await users.countDocuments(storeAdminFilter);
  console.log(`storeAdminOf 유저 → manager: ${saCount}명`);
  if (APPLY && saCount > 0) {
    await users.updateMany(storeAdminFilter, [{ $set: { role: "manager", storeManagerOf: "$storeAdminOf" } }]);
  }

  // 5. 포스 연동 기본 동의 — 새 매장은 이제 처음부터 켜진 채 만들어진다(lib/models/Store.ts DEFAULT_POS_SCOPES). 이미 만들어진 매장 중
  //    동의 항목이 하나도 없는(=한 번도 켠 적 없는) 매장만 같은 기본값으로 켠다. 일부라도 켜 둔 매장은 매장의 선택이므로 건드리지 않는다.
  const DEFAULT_SCOPES = ["read_balance", "read_history", "write_redeem", "write_earn", "accept_transfer"];
  const scopeFilter = { $or: [{ "posIntegration.scopes": { $exists: false } }, { "posIntegration.scopes": { $size: 0 } }] };
  const scopeCount = await stores.countDocuments(scopeFilter);
  console.log(`포스 연동 동의가 비어 있는 매장 → 기본값으로 켬: ${scopeCount}개`);
  if (APPLY && scopeCount > 0) {
    await stores.updateMany(scopeFilter, { $set: { "posIntegration.scopes": DEFAULT_SCOPES } });
  }

  // 6. 포스 단말기 이름 — 예전엔 전부 "POS"였다. 매장별로 등록 순서대로 POS001, POS002…로 바꾼다(이미 POS+숫자 3자리 이상인 이름은 그대로).
  const terminals = mongoose.connection.collection("posterminals");
  const named = /^POS\d{3,}$/;
  const storeIds = await terminals.distinct("storeId");
  let renamed = 0;
  for (const sid of storeIds) {
    const list = await terminals.find({ storeId: sid }).sort({ registeredAt: 1, _id: 1 }).toArray();
    let max = 0;
    for (const t of list) {
      const m = /^POS(\d{3,})$/.exec(String(t.name));
      if (m) max = Math.max(max, Number(m[1]));
    }
    for (const t of list) {
      if (named.test(String(t.name))) continue;
      max += 1;
      const newName = `POS${String(max).padStart(3, "0")}`;
      renamed++;
      console.log(`포스 단말기 ${t._id} '${t.name}' → '${newName}'`);
      if (APPLY) await terminals.updateOne({ _id: t._id }, { $set: { name: newName } });
    }
  }
  console.log(`이름을 바꿀 포스 단말기: ${renamed}대`);

  await mongoose.disconnect();
  console.log("완료");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
