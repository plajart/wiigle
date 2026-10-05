"use client";

// 포스기 다운로드 — 포스 단말기 목록 관리는 매장 대시보드로 옮겼다.
export default function TerminalsClient({ storeId }: { storeId: string }) {
  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리자</div>
        <h1>포스기 다운로드</h1>
        <div className="desc">
          포스기로 쓸 카운터 PC의 브라우저에서 이 화면을 열어 아래 버튼으로 프로그램을 받고, 압축을 풀어{" "}
          <b>start.bat</b>만 실행하세요. 인증코드 입력 없이 설치와 등록이 자동으로 끝나고, 설치된 프로그램에 이 매장의
          포스기 목록이 바로 표시됩니다.
        </div>
        <div className="desc">
          매장에 처음 설치한 PC는 자동으로 <b>대표 포스기</b>가 됩니다 — 대표 포스기에만 이 관리모드로 바로가는 아이콘이
          생기고, 나머지 단말은 결제 시 적립·사용만 가능합니다. 포스기를 더 추가하려면 그 PC에서 다시 다운로드해
          설치하세요.
        </div>
        <div className="desc">
          받은 압축파일에는 이 매장에 등록할 수 있는 1회용 설치 정보가 들어 있습니다(24시간 유효). 다른 사람에게
          전달하지 마세요.
        </div>
      </div>

      <div className="card">
        <div className="card-title">포스 프로그램</div>
        <button
          type="button"
          onClick={() => window.location.assign(`/api/v1/pos-agent/download?storeId=${encodeURIComponent(storeId)}`)}
        >
          포스기 다운로드
        </button>
      </div>

      <p className="faint">등록된 포스 단말기 목록·이름 변경·대표 지정·해지는 <a href="/store">대시보드</a>에서 합니다.</p>
    </div>
  );
}
