import "server-only";
import crypto from "crypto";
import { hashPassword } from "./auth";

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 32자 — 손님이 화면을 보고 그대로 입력하기 쉽게.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 임의 초기 비밀번호 8자(대문자+숫자). 비밀번호 최소 길이(8자) 규칙을 채운다. */
export function generateInitialPassword(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/**
 * 계정을 자동으로 만들 때 쓰는 임의 비밀번호 한 벌. plain은 안내용(손님이 첫 로그인에서 볼 수 있게 저장),
 * hash는 로그인 검증용. 첫 로그인이 성공하면 plain은 DB에서 지운다.
 */
export async function newInitialCredentials(): Promise<{ plain: string; hash: string }> {
  const plain = generateInitialPassword();
  return { plain, hash: await hashPassword(plain) };
}
