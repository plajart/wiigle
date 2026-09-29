# 포인트 복구 (restore.bat 으로 실행) — 매장 초기화(일괄 이전) 때 바탕화면에 만들어 둔 백업 CSV로
# 포스DB의 회원 포인트를 "초기화 이전" 값으로 되돌린다.
#
# ※ 이 프로그램을 더 이상 쓰지 않고 예전 포스 방식으로 돌아갈 때만 사용하세요(먼저 uninstall.bat).
#    복구하면 예전 포인트가 포스에 다시 생기므로, 이 프로그램을 계속 쓰면 포인트가 서버와 포스에 이중으로 남습니다.
#    백업 이후에 적립·사용된 포인트는 반영되지 않습니다(백업 시점 값으로 되돌림).
# 사용법: restore.bat 더블클릭(가장 최근 백업 파일을 자동으로 사용). 다른 파일을 쓰려면
#         powershell -ExecutionPolicy Bypass -File restore-bulk-import-backup.ps1 "파일경로.csv"
param(
    [string]$BackupCsvPath
)

# 프로그램이 켜져 있으면 복구하지 않는다 — 켜져 있는 동안 포스 잔액을 다시 옮기려 하기 때문.
$running = $false
try { $m = [System.Threading.Mutex]::OpenExisting("Global\PointManagerAgent"); $m.Dispose(); $running = $true }
catch [System.Threading.WaitHandleCannotBeOpenedException] { $running = $false }
catch { $running = $true }
if ($running) {
    Write-Host "포인트 관리 프로그램이 실행 중입니다. 먼저 uninstall.bat 으로 프로그램을 제거(종료)한 뒤 복구해주세요." -ForegroundColor Red
    exit 1
}

if (-not $BackupCsvPath) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $latest = Get-ChildItem -Path $desktop -Filter "포인트초기화백업_*.csv" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) {
        Write-Host "바탕화면에서 백업 파일(포인트초기화백업_*.csv)을 찾을 수 없습니다." -ForegroundColor Red
        exit 1
    }
    $BackupCsvPath = $latest.FullName
}

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
Write-Host "총 $($rows.Count)명의 포인트를 백업 시점 값으로 되돌립니다(현재 포스DB 값은 덮어써집니다)."
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
