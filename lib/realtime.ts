import "server-only";

// 브라우저 실시간 반영(SSE) — 서버 한 프로세스 안의 가입자 목록. 포인트가 적립·사용·이동될 때 publishPointChange를 부르면
// 그 변화를 볼 수 있는 브라우저(해당 고객, 그 매장 관리자, 그 고객사 운영자, 본사)에 "바뀌었다"는 신호만 보낸다.
// 화면은 신호를 받으면 자기 데이터를 다시 불러온다(내용을 신호에 싣지 않아 권한 노출이 없다).
// 서버를 여러 프로세스로 늘리면 프로세스 사이에는 전달되지 않는다 — 그 경우 화면의 주기적 새로고침이 보완한다.

export type RealtimeScope = { companyId?: string | null; storeId?: string | null; userId?: string | null };
export type RealtimeViewer = { role: string; userId: string; companyId?: string | null; storeId?: string | null };
type Subscriber = { viewer: RealtimeViewer; send: (data: string) => void };

const g = globalThis as unknown as { __pmRealtime?: Set<Subscriber> };
const subscribers: Set<Subscriber> = (g.__pmRealtime ??= new Set());

export function subscribe(viewer: RealtimeViewer, send: (data: string) => void): () => void {
  const sub: Subscriber = { viewer, send };
  subscribers.add(sub);
  return () => subscribers.delete(sub);
}

function canSee(v: RealtimeViewer, s: RealtimeScope): boolean {
  if (v.role === "owner") return true;
  if (v.userId && s.userId && v.userId === String(s.userId)) return true; // 고객 본인(운영 계정이 본인 포인트를 볼 때도)
  if (v.role === "admin") return !!v.companyId && !!s.companyId && v.companyId === String(s.companyId);
  if (v.role === "manager") return !!v.storeId && !!s.storeId && v.storeId === String(s.storeId);
  return false;
}

export function publishPointChange(scope: RealtimeScope, kind: string) {
  try {
    const payload = JSON.stringify({ kind, at: Date.now() });
    for (const sub of subscribers) {
      if (!canSee(sub.viewer, scope)) continue;
      try {
        sub.send(payload);
      } catch {
        subscribers.delete(sub);
      }
    }
  } catch {
    // 실시간 알림 실패가 포인트 처리를 막으면 안 된다
  }
}
