/**
 * 로그인 진단(읽기 전용) — 특정 계정이 왜 "휴대폰번호 또는 비밀번호가 맞지 않습니다"가 나는지 확인한다. DB를 바꾸지 않는다.
 *
 *   MONGODB_URI="mongodb://..." PHONE=01000000000 [TRY_PASSWORD='...'] npx tsx scripts/check-login.ts
 *
 * 출력: 계정 존재 여부, role, 비밀번호 해시가 있는지(해시 값은 출력하지 않음), 해시 형식(bcrypt 여부), firstLogin, 초기 비밀번호 유무,
 * 그리고 TRY_PASSWORD 를 주면 그 비밀번호가 맞는지(true/false 만 출력). 비밀번호는 환경변수로만 받고 로그에 남기지 않는다.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

async function main() {
  const uri = process.env.MONGODB_URI;
  const phone = (process.env.PHONE ?? "").replace(/[^0-9]/g, "");
  if (!uri || !phone) throw new Error("MONGODB_URI 와 PHONE 환경변수가 필요합니다");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB 연결 실패");
  const users = db.collection("users");
  const docs = await users.find({ phone: { $in: [phone, `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`] } }).toArray();
  console.log(`DB: ${mongoose.connection.host}/${db.databaseName}`);
  console.log(`이 번호의 계정 수: ${docs.length}`);
  for (const u of docs) {
    const h: string | undefined = u.passwordHash;
    console.log("----");
    console.log(`phone(저장값 길이)=${String(u.phone).length} name=${u.name} role=${u.role} companyAdminOf=${u.companyAdminOf ?? "-"} storeManagerOf=${u.storeManagerOf ?? "-"}`);
    console.log(`비밀번호 해시 있음=${!!h} 형식(bcrypt $2a/$2b/$2y)=${h ? /^\$2[aby]\$\d{2}\$/.test(h) : false} 길이=${h ? h.length : 0}`);
    console.log(`firstLogin=${u.firstLogin === true} 초기비밀번호 있음=${!!u.initialPassword}`);
    const pw = process.env.TRY_PASSWORD;
    if (pw !== undefined) console.log(`입력한 비밀번호가 맞는지: ${h ? await bcrypt.compare(pw, h) : false}`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
