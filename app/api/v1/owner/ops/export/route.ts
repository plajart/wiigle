import { requireOwner } from "@/lib/rbac";
import { exportLedgerCsv } from "@/lib/ops-review";
import { handleApiError } from "@/lib/api-utils";

// 본사: 원장 내보내기(CSV, 엑셀에서 한글이 깨지지 않게 BOM 포함) — kind=accounts(계좌별 잔액) | events(기간 내 모든 내역, days=30). 도입·보정 전후 백업·대조용.
export async function GET(req: Request) {
  try {
    await requireOwner();
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") === "events" ? "events" : "accounts";
    const companyId = url.searchParams.get("companyId") || undefined;
    const days = Number(url.searchParams.get("days")) || 30;
    const body = await exportLedgerCsv({ kind, companyId, days });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ledger-${kind}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
