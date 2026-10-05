import { getFreshSession } from "@/lib/session";
import { subscribe } from "@/lib/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 브라우저 실시간 반영용 SSE — 로그인한 사용자가 자기가 볼 수 있는 범위의 포인트 변화 신호를 받는다.
export async function GET(req: Request) {
  const session = await getFreshSession();
  if (!session) return new Response("UNAUTHENTICATED", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(`event: point\ndata: ${data}\n\n`));
      unsubscribe = subscribe(
        { role: session.role, userId: session.sub, companyId: session.companyAdminOf ?? null, storeId: session.storeManagerOf ?? null },
        send
      );
      controller.enqueue(encoder.encode(`retry: 5000\n: connected\n\n`));
      // 프록시가 조용한 연결을 끊지 않도록 주기적으로 신호를 보낸다.
      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 25000);
      const cleanup = () => {
        if (ping) clearInterval(ping);
        ping = null;
        unsubscribe?.();
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          // 이미 닫힘
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (ping) clearInterval(ping);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
