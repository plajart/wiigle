/**
 * 한 계정의 비밀번호를 새로 지정한다(분실 복구용). 기본은 미리보기, --apply 를 붙여야 반영된다.
 *
 *   MONGODB_URI="mongodb://..." PHONE=01000000000 NEW_PASSWORD='새비밀번호(8자 이상)' npx tsx scripts/reset-password.ts          # 미리보기
 *   MONGODB_URI="mongodb://..." PHONE=01000000000 NEW_PASSWORD='새비밀번호(8자 이상)' npx tsx scripts/reset-password.ts --apply  # 반영
 *
 * - 있는 계정만 바꾼다(새로 만들지 않는다). 역할·소속·다른 계정은 건드리지 않는다.
 * - 비밀번호는 환경변수로만 받고 저장소·로그에 남기지 않는다. 반영하면 firstLogin=true 로 두어 첫 로그인 때 변경 안내가 나온다.
 * - 이미 로그인해 있는 세션은 유지된다(비밀번호만 바뀜).
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const APPLY = process.argv.includes("--apply");

async function main() {
  const uri = process.env.MONGODB_URI;
  const phone = (process.env.PHONE ?? "").replace(/[^0-9]/g, "");
  const pw = process.env.NEW_PASSWORD;
  if (!uri || !phone || !pw) throw new Error("MONGODB_URI, PHONE, NEW_PASSWORD 환경변수가 필요합니다");
  if (pw.length < 8) throw new Error("NEW_PASSWORD 는 8자 이상이어야 합니다");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB 연결 실패");
  const users = db.collection("users");
  const matches = await users.find({ phone }).toArray();
  console.log(`DB: ${mongoose.connection.host}/${db.databaseName}`);
  if (matches.length !== 1) throw new Error(`번호 ${phone} 의 계정이 ${matches.length}개입니다(정확히 1개여야 함) — 아무것도 바꾸지 않았습니다`);
  const u = matches[0];
  console.log(`대상: ${u.name} (role=${u.role}) — ${APPLY ? "반영 모드" : "미리보기(dry-run, --apply 를 붙이면 반영)"}`);
  if (APPLY) {
    const hash = await bcrypt.hash(pw, 10);
    await users.updateOne({ _id: u._id }, { $set: { passwordHash: hash, firstLogin: true }, $unset: { initialPassword: "" } });
    console.log("비밀번호를 바꿨습니다. 첫 로그인 후 변경 안내가 나옵니다.");
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
