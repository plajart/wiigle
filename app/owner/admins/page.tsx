import AdminsClient from "./AdminsClient";

// ?companyId= 로 들어오면(고객사 목록의 "운영자 지정") 그 고객사가 미리 선택된다.
export default async function OwnerAdminsPage({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  const { companyId } = await searchParams;
  return <AdminsClient initialCompanyId={companyId ?? ""} />;
}
