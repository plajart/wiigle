"use client";

import { useEffect, useState } from "react";

type LogItem = {
  _id: string;
  actorType: string;
  actorId?: string;
  terminalName?: string;
  action: string;
  scope?: string;
  meta?: Record<string, unknown>;
  occurredAt: string;
};

const ACTION_LABEL: Record<string, string> = {
  POS_CARD_LINKED: "POS 카드 연결",
  POS_CARD_RELINKED: "POS 카드 재연결",
  VENDOR_IMPORT: "포인트 최초 이전",
  BULK_VENDOR_IMPORT: "포스 포인트 서버 이전",
  POS_TERMINAL_MOVED: "포스기 매장 이동",
  STORE_RENAME: "매장 이름 변경",
  COMPANY_RENAME: "고객사 이름 변경",
  MANUAL_POINTS_ENABLE: "임의 포인트 변경 켜짐",
  MANUAL_POINTS_DISABLE: "임의 포인트 변경 꺼짐",
  POS_TERMINAL_RENAME: "포스기 이름 변경",
  EARN_CANCEL_SHORTFALL: "적립 취소(잔액 부족)",
  CUSTOMER_PASSWORD_RESET: "고객 비밀번호 초기화",
  VENDOR_USE_SHORTFALL: "포인트 사용(잔액 부족)",
  POS_EARN: "POS 적립",
  POS_CHECKOUT: "POS 결제 차감",
};

export default function AuditLogClient({ storeId }: { storeId: string }) {
  const [logs, setLogs] = useState<LogItem[] | null>(null);

  useEffect(() => {
    fetch(`/api/v1/stores/${storeId}/pos-integration/audit-log`)
      .then((r) => r.json())
      .then((d) => setLogs(d.logs ?? []));
  }, [storeId]);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리자</div>
        <h1>연동 활동 로그</h1>
        <div className="desc">이 매장에서 일어난 POS 연동 관련 활동 기록입니다.</div>
      </div>

      <div className="card">
        {logs === null && <p className="muted">불러오는 중...</p>}
        {logs?.length === 0 && (
          <div className="empty-state">
            <div className="ic">≡</div>
            아직 기록된 활동이 없습니다
          </div>
        )}
        {logs && logs.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>일시</th>
                <th>주체</th>
                <th>포스기</th>
                <th>활동</th>
                <th>상세</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l._id}>
                  <td className="faint">{new Date(l.occurredAt).toLocaleString("ko-KR")}</td>
                  <td>
                    <span className="badge neutral">{l.actorType}</span>
                  </td>
                  <td>{l.terminalName ?? "-"}</td>
                  <td>{ACTION_LABEL[l.action] ?? l.action}</td>
                  <td className="faint">{l.meta ? JSON.stringify(l.meta) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
