import "server-only";
import PosTerminal from "./models/PosTerminal";

/** 이 매장의 다음 포스기 이름 POS001, POS002… (해지된 포스기 번호도 건너뛰어 번호를 재사용하지 않는다). */
export async function nextTerminalName(storeId: unknown, skip = 0): Promise<string> {
  const all = await PosTerminal.find({ storeId }).select("name").lean();
  let max = 0;
  for (const t of all) {
    const m = /^POS(\d{3,})$/.exec(t.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `POS${String(max + 1 + skip).padStart(3, "0")}`;
}

export function isDuplicateKey(e: unknown): boolean {
  return (e as { code?: number })?.code === 11000;
}
