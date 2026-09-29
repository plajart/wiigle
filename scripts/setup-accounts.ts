/**
 * 운영 계정 정리(1회성) — 본사(소유자)·고객사 운영자·매장 관리자 계정을 정해진 상태로 맞춘다.
 *
 * 실행은 운영 서버에서 사람이 직접 한다(자동 실행 안 됨). 기본은 미리보기(dry-run)이고 --apply를 붙여야 반영된다.
 * 반드시 scripts/migrate-to-multitenant.ts(고객사·매장 소속 생성)를 먼저 실행한 뒤에 돌릴 것.
 *
 *   MONGODB_URI="mongodb://..." FIXED_PASSWORD="..." npx tsx scripts/setup-accounts.ts           # 미리보기
 *   MONGODB_URI="mongodb://..." FIXED_PASSWORD="..." npx tsx scripts/setup-accounts.ts --apply   # 반영
 *
 * 비밀번호는 저장소에 넣지 않는다 — FIXED_PASSWORD 환경변수로만 받는다. 아래 4개 계정에 모두 같은 값이 설정된다.
 * (그 외 모든 계정은 앱이 임의 비밀번호를 부여한다 — scripts/issue-initial-passwords.ts 참고)
 *
 * 하는 일(여러 번 실행해도 결과가 같다):
 *  1. 01035587496 — 이름이 "배병철"인지 확인한 뒤 본사(owner, 소유자)로 바꾸고 FIXED_PASSWORD로 설정.
 *       이름이 다르면 아무것도 바꾸지 않고 중단한다(사람이 확인하기 전까지 변경 없음).
 *  2. 01000000000 — 소유자(owner)로 생성(이미 있으면 소유자로 바꾸고 비밀번호 재설정).
 *  3. 01000000001 — "반들한식뷔페" 고객사의 운영자(admin)로 변경, 비밀번호 설정(없으면 만들지 않고 알림).
 *  4. 01000000002 — "반들한식뷔페" 매장의 매장 관리자(manager)로 변경, 비밀번호 설정(없으면 만들지 않고 알림).
 *  5. "더파티" 고객사·"더파티 시청점" 매장에 묶인 계정이 있는지 **확인만 한다**(수정 안 함) — 이 매장은 계정 없이
 *     정보만 있으면 되므로, 나오는 계정은 사람이 보고 처리 방침을 정한다.
 *
 * 위 4개 계정은 firstLogin=true로 두어, 처음 로그인하면 "비밀번호를 변경하세요" 안내가 한 번 나온다(같은 비밀번호를
 * 여러 계정에 쓰고 예측하기 쉬운 값일 수 있으므로 로그인 후 바로 바꾸길 권한다).
 *
 * 컬렉션에 직접 접근한다(모델의 옛 필드 정리와 독립적으로 동작하게).
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const APPLY = process.argv.includes("--apply");

const BAE = { phone: "01035587496", name: "배병철" };
const OWNER2 = { phone: "01000000000", name: "소유자" };
const HQ_ADMIN_PHONE = "01000000001";
const STORE_MANAGER_PHONE = "01000000002";
const COMPANY_BANDL = "반들한식뷔페";
const STORE_BANDL = "반들한식뷔페";
const COMPANY_PARTY = "더파티";
const STORE_PARTY = "더파티 시청점";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI 환경변수가 필요합니다");
  const fixedPassword = process.env.FIXED_PASSWORD;
  if (!fixedPassword) throw new Error("FIXED_PASSWORD 환경변수가 필요합니다(4개 계정에 설정할 비밀번호)");
  if (fixedPassword.length < 8) throw new Error("FIXED_PASSWORD는 8자 이상이어야 합니다");

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB 연결 실패");
  const users = db.collection("users");
  const companies = db.collection("companies");
  const stores = db.collection("stores");

  console.log(APPLY ? "== 반영 모드 ==" : "== 미리보기(dry-run) — 반영하려면 --apply ==");

  // ── 사전 확인: 고객사·매장이 있어야 한다(migrate-to-multitenant 선행)
  const bandlCompany = await companies.findOne({ name: COMPANY_BANDL });
  const bandlStores = await stores.find({ name: STORE_BANDL, ...(bandlCompany ? { companyId: bandlCompany._id } : {}) }).toArray();
  if (!bandlCompany) throw new Error(`고객사 '${COMPANY_BANDL}'가 없습니다 — scripts/migrate-to-multitenant.ts를 먼저 실행하세요`);
  if (bandlStores.length !== 1) throw new Error(`'${COMPANY_BANDL}' 고객사에서 매장 '${STORE_BANDL}'이(가) ${bandlStores.length}개입니다(정확히 1개여야 함) — 확인 필요`);
  const bandlStore = bandlStores[0];

  // ── 1. 배병철 → 소유자
  const bae = await users.findOne({ phone: BAE.phone });
  if (!bae) throw new Error(`계정 ${BAE.phone}이(가) 없습니다 — 아무것도 변경하지 않았습니다(번호를 사용자에게 확인하세요)`);
  if (bae.name !== BAE.name) {
    throw new Error(`계정 ${BAE.phone}의 이름이 '${bae.name}'입니다('${BAE.name}'이(가) 아님) — 사람이 확인하기 전까지 아무것도 변경하지 않았습니다`);
  }
  console.log(`[1] ${BAE.phone} ${bae.name}: 현재 role=${bae.role} → owner, 비밀번호 설정`);

  // ── 3·4. 대상 계정 존재 확인(없으면 만들지 않음)
  const hq = await users.findOne({ phone: HQ_ADMIN_PHONE });
  const sm = await users.findOne({ phone: STORE_MANAGER_PHONE });
  if (!hq) console.log(`[3] ${HQ_ADMIN_PHONE} 계정이 없습니다 — 건너뜀(만들지 않음)`);
  else console.log(`[3] ${HQ_ADMIN_PHONE} ${hq.name}: 현재 role=${hq.role} → admin(${COMPANY_BANDL})`);
  if (!sm) console.log(`[4] ${STORE_MANAGER_PHONE} 계정이 없습니다 — 건너뜀(만들지 않음)`);
  else console.log(`[4] ${STORE_MANAGER_PHONE} ${sm.name}: 현재 role=${sm.role} → manager(${STORE_BANDL})`);

  const owner2 = await users.findOne({ phone: OWNER2.phone });
  console.log(`[2] ${OWNER2.phone}: ${owner2 ? `이미 있음(role=${owner2.role}) → owner로 바꾸고 비밀번호 재설정` : "없음 → 소유자로 생성"}`);

  // ── 5. 더파티: 확인만
  const partyCompany = await companies.findOne({ name: COMPANY_PARTY });
  const partyStores = await stores.find({ name: STORE_PARTY }).toArray();
  const tied = await users
    .find({
      $or: [
        ...(partyCompany ? [{ companyAdminOf: partyCompany._id }] : []),
        ...partyStores.map((s) => ({ storeManagerOf: s._id })),
        ...partyStores.map((s) => ({ storeAdminOf: s._id })),
      ],
    })
    .project({ phone: 1, name: 1, role: 1 })
    .toArray();
  if (tied.length === 0) console.log(`[5] '${COMPANY_PARTY}'/'${STORE_PARTY}'에 묶인 계정 없음 — 이대로 정보만 존재`);
  else {
    console.log(`[5] ⚠ '${COMPANY_PARTY}'/'${STORE_PARTY}'에 묶인 계정 ${tied.length}개 — 수정하지 않았습니다. 처리 방침을 정하세요:`);
    for (const u of tied) console.log(`     - ${u.phone} ${u.name} (role=${u.role})`);
  }

  if (!APPLY) {
    await mongoose.disconnect();
    console.log("미리보기 끝 — 위 내용이 맞으면 --apply로 다시 실행하세요");
    return;
  }

  // ── 반영 (4개 계정 모두 같은 비밀번호, 첫 로그인 때 변경 안내)
  const passwordHash = await bcrypt.hash(fixedPassword, 10);
  const common = { passwordHash, phoneVerified: true, firstLogin: true };
  const clear = { initialPassword: "" };

  await users.updateOne(
    { _id: bae._id },
    { $set: { role: "owner", ...common }, $unset: { companyAdminOf: "", storeManagerOf: "", ...clear } }
  );
  console.log(`[1] 완료: ${BAE.phone} → owner`);

  if (owner2) {
    await users.updateOne(
      { _id: owner2._id },
      { $set: { role: "owner", ...common }, $unset: { companyAdminOf: "", storeManagerOf: "", ...clear } }
    );
  } else {
    let digitalCardNo = "";
    for (let i = 0; i < 10 && !digitalCardNo; i++) {
      const cand = `99${Math.floor(Math.random() * 1e10).toString().padStart(10, "0")}`;
      if (!(await users.findOne({ digitalCardNo: cand }))) digitalCardNo = cand;
    }
    if (!digitalCardNo) throw new Error("카드번호 발급 실패");
    await users.insertOne({
      phone: OWNER2.phone,
      name: OWNER2.name,
      role: "owner",
      ...common,
      digitalCardNo,
      posLinks: [],
      createdAt: new Date(),
    });
  }
  console.log(`[2] 완료: ${OWNER2.phone} 소유자`);

  if (hq) {
    await users.updateOne(
      { _id: hq._id },
      { $set: { role: "admin", companyAdminOf: bandlCompany._id, ...common }, $unset: { storeManagerOf: "", ...clear } }
    );
    console.log(`[3] 완료: ${HQ_ADMIN_PHONE} → 고객사 운영자(${COMPANY_BANDL})`);
  }
  if (sm) {
    await users.updateOne(
      { _id: sm._id },
      { $set: { role: "manager", storeManagerOf: bandlStore._id, ...common }, $unset: { companyAdminOf: "", ...clear } }
    );
    console.log(`[4] 완료: ${STORE_MANAGER_PHONE} → 매장 관리자(${STORE_BANDL})`);
  }

  await mongoose.disconnect();
  console.log("완료. 변경된 계정은 다시 로그인해야 새 권한이 적용됩니다.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
