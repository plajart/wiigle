/**
 * 일괄 이전·POS 적립으로 이미 만들어져 있는 "손님 계정"의 비밀번호를 비운다.
 *
 * 배경: 예전에는 매장에서 만들어진 계정에 무작위 비밀번호를 넣어 로그인이 불가능했다. 이제는 비밀번호를
 * 비워 두고(passwordHash=""), 손님이 전화번호만 넣고(비밀번호 비움) 로그인해 고객 관리모드에서 정한다.
 * 이미 DB에 있는 계정은 예전 무작위 값이 들어 있으므로 이 스크립트로 비워야 새 방식이 적용된다.
 *
 * 대상(모두 만족하는 계정만):
 *   - role === "user"
 *   - name === "포인트 손님"           (POS가 자동으로 만든 계정의 이름 — getOrCreateUserByPhone)
 *   - phoneVerified !== true            (본인이 가입·비밀번호 찾기로 인증한 적 없음)
 *   - passwordHash가 비어 있지 않음     (이미 비워진 계정은 건너뜀)
 * 소유자·운영자·매장 관리자와, 본인이 가입했거나 비밀번호를 재설정한 계정은 절대 건드리지 않는다.
 *
 * 실행은 운영 서버에서 사람이 직접 한다. 기본은 미리보기(dry-run)이고 --apply를 붙여야 반영된다.
 *
 *   MONGODB_URI="mongodb://..." npx tsx scripts/blank-imported-passwords.ts           # 미리보기(대상 수 확인)
 *   MONGODB_URI="mongodb://..." npx tsx scripts/blank-imported-passwords.ts --apply   # 반영
 *
 * ⚠ 비운 계정은 "그 전화번호를 아는 사람이 먼저 로그인해 비밀번호를 정하는" 방식이 된다.
 */
import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI 환경변수가 필요합니다");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB 연결 실패");
  const users = db.collection("users");

  const filter = {
    role: "user",
    name: "포인트 손님",
    phoneVerified: { $ne: true },
    passwordHash: { $exists: true, $nin: ["", null] },
  };
  const total = await users.countDocuments({ role: "user" });
  const targets = await users.countDocuments(filter);
  console.log(APPLY ? "== 반영 모드 ==" : "== 미리보기(dry-run) — 반영하려면 --apply ==");
  console.log(`전체 고객 계정 ${total}개 중 비울 대상: ${targets}개`);

  if (APPLY && targets > 0) {
    const r = await users.updateMany(filter, { $set: { passwordHash: "" } });
    console.log(`비밀번호를 비운 계정: ${r.modifiedCount}개`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
