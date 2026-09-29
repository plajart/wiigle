# 비상 복구 전용 — 매장 초기화(일괄 이전) 때 만든 백업 CSV로 포스DB 잔액을 되돌린다.
# 평소에는 실행할 필요 없음. 초기화 이후 문제가 생겨 되돌려야 할 때만 관리자가 직접 실행.
# 사용법: powershell -ExecutionPolicy Bypass -File restore-bulk-import-backup.ps1 "바탕화면\포인트초기화백업_...csv"
param(
    [Parameter(Mandatory=$true)][string]$BackupCsvPath
)

if (-not (Test-Path $BackupCsvPath)) {
    Write-Host "파일을 찾을 수 없습니다: $BackupCsvPath" -ForegroundColor Red
    exit 1
}

$conn = New-Object -ComObject ADODB.Connection
$conn.Open("DSN=CHAMP")
function Champ-Exec($sql) { $conn.Execute($sql) | Out-Null }
function Sql-Str($s) { return "'" + ($s -replace "'", "''") + "'" }

$rows = Import-Csv -Path $BackupCsvPath -Encoding UTF8
Write-Host "백업 파일: $BackupCsvPath"
Write-Host "총 $($rows.Count)명의 포인트를 이 값으로 되돌립니다(현재 포스DB 값은 덮어써집니다)."
$confirm = Read-Host "정말로 진행하시겠습니까? (yes 입력)"
if ($confirm -ne "yes") { Write-Host "취소했습니다."; $conn.Close(); exit 0 }

$done = 0; $failed = 0
foreach ($r in $rows) {
    try {
        Champ-Exec "UPDATE MEMBER SET MEM_USABLE_PNT=$($r.MEM_USABLE_PNT) WHERE MEM_NO=$(Sql-Str $r.MEM_NO)"
        $done++
    } catch {
        Write-Host "실패(MEM_NO=$($r.MEM_NO)): $_" -ForegroundColor Red
        $failed++
    }
}
Write-Host "완료: $done / $($rows.Count)건 복원 (실패 $failed)" -ForegroundColor Green
$conn.Close()
