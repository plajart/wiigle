"use client";

// 포스기 다운로드 — 포스 단말기 목록 관리는 매장 대시보드로 옮겼다.
export default function TerminalsClient({ storeId }: { storeId: string }) {
  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리자</div>
        <h1>포스기 다운로드</h1>
        <div className="desc">
          <b>화면 위쪽에 표시된 고객사 › 매장</b>에 등록되는 설치 파일을 받습니다. 매장을 잘못 골랐다면 받은 뒤에 고객사 운영자·본사가 대시보드에서
          포스기를 다른 매장으로 옮길 수 있습니다(매장 관리자는 옮길 수 없습니다).
        </div>
        <div className="desc">
          포스기로 쓸 카운터 PC의 브라우저에서 이 화면을 열어 아래 버튼으로 설치 파일을 받아 <b>실행</b>하세요(압축파일이 받아지면 풀어서
          <b>start.bat</b> 실행). 설치 때 "○○ 고객사 › △△ 매장에 등록합니다" 확인창이 뜨고, 확인하면 인증코드 입력 없이 설치와 등록이
          끝납니다. 설치가 끝나면 프로그램 트레이 메뉴의 <b>포인트 서버로 이전</b>으로 기존 회원 포인트를 서버로 옮깁니다(여러 번 해도 안전).
        </div>
        <div className="desc">
          매장에 처음 설치한 PC는 자동으로 <b>대표 포스기</b>가 됩니다. 설치 파일에는 이 매장에 등록할 수 있는 1회용 설치 정보가 들어 있습니다(24시간
          유효). 다른 사람에게 전달하지 마세요. 새 버전은 프로그램 트레이 메뉴의 <b>업데이트</b>로 받습니다.
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
