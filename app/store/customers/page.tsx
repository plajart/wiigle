import ResetPasswordForm from "../../components/ResetPasswordForm";

export default function StoreCustomersPage() {
  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">매장 관리모드</div>
        <h1>고객 비밀번호 초기화</h1>
        <div className="desc">이 매장에서 이용한 고객이 비밀번호를 잊었을 때 사용합니다.</div>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
