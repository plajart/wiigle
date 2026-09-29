// 지금 "어느 고객사 / 어느 매장"을 보고 있는지 화면 맨 위에 항상 보여주는 표시줄.
// 고객사·매장을 오가며 일하는 소유자·운영자가 다른 매장을 잘못 건드리지 않게 하려는 것이다.
export default function ContextBar({
  companyName,
  storeName,
  note,
  backHref,
  backLabel,
  warn,
}: {
  companyName: string;
  storeName?: string;
  note?: string;
  backHref?: string;
  backLabel?: string;
  warn?: boolean;
}) {
  return (
    <div className={"context-bar" + (warn ? " warn" : "")} role="status">
      <div className="context-path">
        <span className="context-chip">
          <span className="k">고객사</span>
          <span className="v">{companyName}</span>
        </span>
        {storeName && (
          <>
            <span className="context-sep">›</span>
            <span className="context-chip store">
              <span className="k">매장</span>
              <span className="v">{storeName}</span>
            </span>
          </>
        )}
      </div>
      {note && <span className="context-note">{note}</span>}
      {backHref && (
        <a className="context-back" href={backHref}>
          {backLabel ?? "돌아가기"}
        </a>
      )}
    </div>
  );
}
