/**
 * 일괄 이전·POS 적립으로 이미 만들어져 있는 "손님 계정"에 임의 초기 비밀번호를 부여한다.
 *
 * 배경: 예전에는 매장에서 만들어진 계정에 본인이 알 수 없는 무작위 비밀번호가 들어 있어 손님이 로그인할 수 없었다.
 * 이제는 계정마다 임의 초기 비밀번호를 부여하고(원문을 initialPassword에 저장), 손님이 웹 로그인 화면의
 * "처음 로그인하시나요? 초기 비밀번호 확인"에서 그 비밀번호를 확인해 로그인한 뒤 변경한다. 첫 로그인이 성공하면 앱이
 * initialPassword를 지운다(그 뒤로는 어디에도 안내되지 않는다). 새로 생기는 손님 계정은 앱이 알아서 같은 방식으로 만든다.
 *
 * 대상(모두 만족하는 계정만):
 *   - role === "user"
 *   - name === "포인트 손님"           (POS가 자동으로 만든 계정의 이름 — getOrCreateUserByPhone)
 *   - phoneVerified !== true            (본인이 가입·비밀번호 찾기로 인증한 적 없음)
 *   - initialPassword가 아직 없음       (이미 발급된 계정은 건너뜀 — 여러 번 실행해도 안전)
 * 소유자·운영자·매장 관리자와, 본인이 가입했거나 비밀번호를 재설정한 계정은 절대 건드리지 않는다.
 *
 * 실행은 운영 서버에서 사람이 직접 한다. 기본은 미리보기(dry-run)이고 --apply를 붙여야 반영된다.
 *
 *   MONGODB_URI="mongodb://..." npx tsx scripts/issue-initial-passwords.ts           # 미리보기(대상 수 확인)
 *   MONGODB_URI="mongodb://..." npx tsx scripts/issue-initial-passwords.ts --apply   # 반영
 *
 * ⚠ 신원 근거가 전화번호뿐이라, 그 번호를 아는 사람은 누구나 로그인 화면에서 초기 비밀번호를 볼 수 있다(먼저 로그인해
 *   바꾸면 그 사람이 계정을 차지). 이는 요청된 설계이며 요청 횟수 제한으로만 완화한다.
 */
import crypto from "crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const APPLY = process.argv.includes("--apply");
// 앱(lib/initial-password.ts)과 같은 글자 집합·길이
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generate(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

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
    $or: [{ initialPassword: { $exists: false } }, { initialPassword: null }, { initialPassword: "" }],
  };
  const total = await users.countDocuments({ role: "user" });
  const targets = await users.countDocuments(filter);
  console.log(APPLY ? "== 반영 모드 ==" : "== 미리보기(dry-run) — 반영하려면 --apply ==");
  console.log(`전체 고객 계정 ${total}개 중 초기 비밀번호를 부여할 대상: ${targets}개`);

  if (APPLY && targets > 0) {
    const cursor = users.find(filter).project({ _id: 1 });
    let done = 0;
    let batch: { updateOne: { filter: { _id: unknown }; update: { $set: Record<string, unknown> } } }[] = [];
    for await (const u of cursor) {
      const plain = generate();
      batch.push({
        updateOne: {
          filter: { _id: u._id },
          update: { $set: { passwordHash: await bcrypt.hash(plain, 10), initialPassword: plain, firstLogin: true } },
        },
      });
      if (batch.length >= 200) {
        await users.bulkWrite(batch);
        done += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await users.bulkWrite(batch);
      done += batch.length;
    }
    console.log(`초기 비밀번호를 부여한 계정: ${done}개`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
