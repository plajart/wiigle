# 포인트 관리 프로그램 제거 (uninstall.bat 으로 실행)
# 이 PC에서 프로그램을 끄고 자동시작·바탕화면 바로가기·포스DB에 만든 연동 장치(트리거/큐 테이블)를 지운다.
# 예전 방식(포스 자체 포인트)으로 돌아가려면 마지막에 "포인트 복구"까지 진행하면 된다.
$ErrorActionPreference = "Continue"

Write-Host "=== 포인트 관리 프로그램 제거 ===" -ForegroundColor Cyan
Write-Host "이 PC에서 프로그램을 끄고, 자동시작과 바탕화면 바로가기, 포스DB에 만든 연동 장치를 지웁니다."
$ans = Read-Host "제거하시겠습니까? (yes 입력)"
if ($ans -ne "yes") { Write-Host "취소했습니다."; exit 0 }

# 1) 프로그램 종료
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*point-terminal-agent.ps1*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "프로그램을 종료했습니다."

# 2) 자동시작 제거(작업 스케줄러 + 시작프로그램 바로가기)
try { Unregister-ScheduledTask -TaskName "PointManagerAgent" -Confirm:$false -ErrorAction SilentlyContinue } catch { }
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) "포인트 관리 프로그램.lnk") -Force -ErrorAction SilentlyContinue
Write-Host "자동시작을 제거했습니다."

# 3) 바탕화면 바로가기 제거
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) "포인트 관리모드.lnk") -Force -ErrorAction SilentlyContinue
Write-Host "바탕화면 바로가기를 제거했습니다."

# 4) 포스DB 연동 장치(결제 감지 트리거 + 대기열 테이블) 제거 — 실패해도 프로그램은 이미 제거된 상태이고 남은 장치는 무해하다.
try {
    $conn = New-Object -ComObject ADODB.Connection
    $conn.Open("DSN=CHAMP")
    $hasTable = $conn.Execute("SELECT count(*) AS C FROM SYSTABLE WHERE table_name='CRAB_EVENT_QUEUE'").Fields.Item("C").Value
    $go = $true
    if ($hasTable -gt 0) {
        $pending = $conn.Execute("SELECT count(*) AS C FROM CRAB_EVENT_QUEUE WHERE PROCESSED='N'").Fields.Item("C").Value
        if ($pending -gt 0) {
            Write-Host "서버에 아직 반영되지 않은 적립·사용 기록이 $pending 건 있습니다. 지우면 그 기록은 사라집니다." -ForegroundColor Yellow
            $go = ((Read-Host "그래도 지울까요? (yes 입력)") -eq "yes")
        }
    }
    if ($go) {
        try { $conn.Execute("DROP TRIGGER MEMBER_POINT.CRAB_MEMBER_POINT_AI") | Out-Null } catch { Write-Host "트리거 제거 실패(무해함): $_" -ForegroundColor Yellow }
        if ($hasTable -gt 0) { try { $conn.Execute("DROP TABLE CRAB_EVENT_QUEUE") | Out-Null } catch { Write-Host "큐 테이블 제거 실패(무해함): $_" -ForegroundColor Yellow } }
        Write-Host "포스DB 연동 장치를 정리했습니다."
    } else {
        Write-Host "포스DB 연동 장치는 그대로 두었습니다(다시 설치하면 이어서 쓰입니다)."
    }
    $conn.Close()
} catch {
    Write-Host "포스DB에 연결하지 못해 연동 장치는 정리하지 못했습니다(무해함): $_" -ForegroundColor Yellow
}

# 5) 이 PC의 설정 파일 삭제(다시 설치하면 새로 등록된다). 백업 CSV(바탕화면)와 실행 기록(agent.log)은 남긴다.
foreach ($f in @("terminal-config.json", "bulk-import-done.json", "provision.json", "transfer-pending-batch.txt", "transfer-last.json", "bundle-version.txt")) {
    Remove-Item (Join-Path $PSScriptRoot $f) -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "제거가 끝났습니다." -ForegroundColor Green
Write-Host "※ 홈페이지 매장 관리모드 > '포스기 다운로드' 화면의 포스기 목록에서 이 PC를 '해지'해 주세요."
Write-Host "※ 이 폴더는 직접 삭제하셔도 됩니다."

# 6) 예전 방식으로 돌아가려면 포인트 복구
$backup = @(Get-ChildItem -Path ([Environment]::GetFolderPath('Desktop')) -Filter "포인트서버이전백업_*.csv" -ErrorAction SilentlyContinue) + @(Get-ChildItem -Path ([Environment]::GetFolderPath('Desktop')) -Filter "포인트초기화백업_*.csv" -ErrorAction SilentlyContinue) | Select-Object -First 1
if ($backup) {
    Write-Host ""
    Write-Host "바탕화면에 포인트 이전 전 백업 파일이 있습니다." -ForegroundColor Cyan
    Write-Host "예전 방식(포스 자체 포인트)으로 돌아가려면 지금 복구하세요. 복구하면 예전 포인트가 포스에 다시 생기며, 백업 이후의 적립·사용은 반영되지 않습니다."
    if ((Read-Host "포스 포인트를 이전 전 값으로 복구할까요? (yes 입력, 아니면 그냥 Enter)") -eq "yes") {
        & (Join-Path $PSScriptRoot "restore-bulk-import-backup.ps1")
    } else {
        Write-Host "복구하지 않았습니다. 나중에 필요하면 restore.bat 을 실행하세요."
    }
}
